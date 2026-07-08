const MODULE_ID = "cpr-combat-automatism";
const SYSTEM_ID = "cyberpunk-red-core";
const SOCKET = `module.${MODULE_ID}`;
const TEMPLATES = {
  dialog: `modules/${MODULE_ID}/templates/attack-dialog.hbs`,
  card: `modules/${MODULE_ID}/templates/attack-card.hbs`,
  declaration: `modules/${MODULE_ID}/templates/declaration-card.hbs`,
};

let CPRChatClass = null;
const processedActions = new Set();
const claimedPrompts = new Set();
const shownPrompts = new Set();
const routedPrompts = new Set();
const pendingAttackGroups = new Map();
const resolvingAttackGroups = new Set();

Hooks.once("ready", async () => {
  if (game.system.id !== SYSTEM_ID) {
    ui.notifications.warn("CPR Combat Automatism only works with Cyberpunk RED - CORE.");
    return;
  }

  try {
    CPRChatClass = (await import(`/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`)).default;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not import Cyberpunk RED chat adapter`, error);
    ui.notifications.error("CPR Combat Automatism could not load the Cyberpunk RED native roll adapter. See console.");
  }

  game.cprCombatAutomatism = {
    open: openAttackDialog,
  };
  game.cprAttackFlow = game.cprCombatAutomatism;
  game.socket.on(SOCKET, onSocket);
  console.log(`${MODULE_ID} | ready`);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = Array.isArray(controls)
    ? controls.find((control) => control.name === "token")
    : controls.tokens;
  if (!tokenControls) return;

  const tool = {
    name: "cpr-combat-automatism",
    title: "CPR Combat Automatism",
    icon: "fas fa-crosshairs",
    button: true,
    onClick: () => openAttackDialog(),
  };

  if (Array.isArray(tokenControls.tools)) {
    if (!tokenControls.tools.some((existing) => existing.name === tool.name)) {
      tokenControls.tools.push(tool);
    }
    return;
  }

  tokenControls.tools ??= {};
  tokenControls.tools[tool.name] = tool;
});

Hooks.on("createChatMessage", async (message) => {
  const declaration = message.getFlag(MODULE_ID, "attackDeclaration");
  if (!declaration || !game.user.isGM) return;
  await routeDefenderPrompt(declaration);
});

async function openAttackDialog() {
  const selection = getSelection();
  if (!selection) return;

  const { attacker, targets } = selection;
  const weapons = getWeapons(attacker.actor);
  if (weapons.length === 0) {
    ui.notifications.warn("The selected attacker has no weapons.");
    return;
  }

  const selected = await buildDialogWeaponView(weapons[0], attacker, targets);
  const content = await renderTemplate(TEMPLATES.dialog, {
    attackerName: attacker.name,
    targetName: formatTargetList(targets),
    targetCount: targets.length,
    isMultiTarget: targets.length > 1,
    weapons: weapons.map((weapon, index) => ({
      id: weapon.id,
      name: weapon.name,
      selected: index === 0,
    })),
    selected,
    distanceLabel: selected.distanceLabel ?? formatDistance(selected.distance),
    dvLabel: selected.dvLabel ?? selected.dv ?? "-",
    reason: selected.reason,
  });

  const dialog = new Dialog({
    title: "CPR Combat Automatism",
    content,
    buttons: {
      create: {
        label: "Crear ataque",
        callback: async (html) => {
          const weaponId = html.find("[name='weaponId']").val();
          await createAttackCards(attacker, targets, weaponId);
        },
      },
      cancel: {
        label: "Cancel",
      },
    },
    default: "create",
    render: (html) => {
      html.find("[name='weaponId']").on("change", async (event) => {
        const weapon = weapons.find((item) => item.id === event.currentTarget.value);
        const view = await buildDialogWeaponView(weapon, attacker, targets);
        html.find("[data-cpr-af-field='damage']").text(view.damage);
        html.find("[data-cpr-af-field='skill']").text(view.skill);
        html.find("[data-cpr-af-field='table']").text(view.tableName);
        html.find("[data-cpr-af-field='dv']").text(view.dvLabel ?? view.dv ?? "-");
      });
    },
  });

  dialog.render(true);
}

function getSelection() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1) {
    ui.notifications.warn("Select exactly one attacker token.");
    return null;
  }

  const targets = Array.from(game.user.targets ?? []);
  if (targets.length < 1) {
    ui.notifications.warn("Target at least one defender token.");
    return null;
  }

  const [attacker] = controlled;
  if (!attacker.actor) {
    ui.notifications.warn("The selected attacker token has no actor.");
    return null;
  }
  if (targets.some((target) => !target.actor)) {
    ui.notifications.warn("All targeted tokens must have actors.");
    return null;
  }
  return { attacker, targets };
}

function getWeapons(actor) {
  const weapons = actor.items.filter((item) => item.type === "weapon");
  return weapons.length ? weapons : actor.system?.weapons?.available ?? [];
}

function formatTargetList(targets) {
  if (targets.length === 1) return targets[0].name;
  return targets.map((target) => target.name).join(", ");
}

async function buildWeaponView(weapon, attacker, target) {
  const dv = await calculateDv(weapon, attacker, target);
  return {
    damage: getWeaponDamage(weapon),
    skill: weapon.system?.weaponSkill || "-",
    tableName: dv.tableName || weapon.system?.dvTable || "-",
    distance: dv.distance,
    dv: dv.dv,
    bandLabel: dv.bandLabel || "-",
    reason: dv.reason,
  };
}

async function buildDialogWeaponView(weapon, attacker, targets) {
  const first = await buildWeaponView(weapon, attacker, targets[0]);
  if (targets.length === 1) return first;

  return {
    ...first,
    distance: null,
    dv: null,
    bandLabel: "-",
    distanceLabel: "Varies by target",
    dvLabel: "Varies by target",
    reason: "",
  };
}

async function createAttackCards(attacker, targets, weaponId) {
  const weapon = attacker.actor.items.get(weaponId);
  if (!weapon) {
    ui.notifications.warn("Selected weapon was not found on the attacker.");
    return;
  }

  const groupAttackId = foundry.utils.randomID();
  const groupTargetIds = targets.map((target) => target.document.id);
  for (const [index, target] of targets.entries()) {
    await createAttackCard(attacker, target, weapon, {
      groupAttackId,
      groupTargetIds,
      groupIndex: index,
      groupTotalTargets: targets.length,
    });
  }
}

async function createAttackCard(attacker, target, weapon, group) {
  const view = await buildWeaponView(weapon, attacker, target);
  if (!view.dv) {
    ui.notifications.warn(view.reason || "Could not calculate DV for this weapon.");
  }

  const data = {
    attackId: foundry.utils.randomID(),
    groupAttackId: group.groupAttackId,
    groupTargetIds: group.groupTargetIds,
    groupIndex: group.groupIndex,
    groupTotalTargets: group.groupTotalTargets,
    groupLabel: group.groupTotalTargets > 1 ? `${group.groupIndex + 1}/${group.groupTotalTargets}` : "",
    attackerSceneId: canvas.scene.id,
    attackerTokenId: attacker.document.id,
    attackerActorId: attacker.actor.id,
    attackerName: attacker.name,
    targetSceneId: canvas.scene.id,
    targetTokenId: target.document.id,
    targetActorId: target.actor.id,
    targetBaseActorId: target.document.actorId,
    targetName: target.name,
    weaponId: weapon.id,
    weaponName: weapon.name,
    damage: view.damage,
    skill: view.skill,
    distance: view.distance,
    distanceLabel: formatDistance(view.distance),
    dv: view.dv ?? "",
    dvLabel: view.dv ?? "-",
    tableName: view.tableName,
    bandLabel: view.bandLabel,
    reason: view.reason,
  };

  const content = await renderTemplate(TEMPLATES.declaration, data);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content,
    flags: {
      [MODULE_ID]: {
        attackDeclaration: data,
      },
    },
  });

  await dispatchDefenderPrompt(data);
}

function pickDefenderUser(actor, { includeGm = true, tokenDocument = null, data = null } = {}) {
  const docs = getDefenderOwnershipDocs(data ?? {}, { actor, document: tokenDocument });
  const activeOwners = game.users
    .filter((user) => user.active && !user.isGM && userOwnsAny(user, docs, data, tokenDocument))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (activeOwners.length > 0) return activeOwners[0];
  return includeGm ? game.users.find((user) => user.isGM && user.active) ?? game.user : null;
}

async function showDefenderPrompt(data) {
  if (shownPrompts.has(data.attackId)) return;
  claimPrompt(data.attackId);
  shownPrompts.add(data.attackId);

  const content = await renderTemplate(TEMPLATES.card, data);
  new Dialog({
    title: `${data.weaponName}: ${data.targetName}`,
    content,
    buttons: {},
    render: (html) => {
      html.find("[data-cpr-af-action]").on("click", async (event) => {
        event.preventDefault();
        const action = event.currentTarget.dataset.cprAfAction;
        const key = data.attackId;
        if (processedActions.has(key)) return;
        processedActions.add(key);
        html.find("[data-cpr-af-action]").prop("disabled", true);
        html.closest(".app").find(".close").trigger("click");
        await submitDefenderChoice(data, action);
      });
    },
  }).render(true);
}

function claimPrompt(attackId) {
  if (claimedPrompts.has(attackId)) return;
  claimedPrompts.add(attackId);
  game.socket.emit(SOCKET, { type: "promptClaimed", attackId });
}

async function dispatchDefenderPrompt(data) {
  const gm = game.users.find((user) => user.isGM && user.active);
  if (game.user.isGM || !gm) {
    await routeDefenderPrompt(data);
  } else {
    emitTo(gm.id, "routePrompt", data);
  }

  game.socket.emit(SOCKET, { type: "maybeShowPrompt", data });
  await maybeShowDefenderPrompt(data);
}

async function routeDefenderPrompt(data) {
  if (routedPrompts.has(data.attackId)) return;
  routedPrompts.add(data.attackId);

  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const docs = getDefenderOwnershipDocs(data, defender);
  const ownerIds = game.users
    .filter((user) => user.active && !user.isGM && userOwnsAny(user, docs, data, defender?.document))
    .map((user) => user.id);

  console.log(`${MODULE_ID} | defender owner route`, {
    attackId: data.attackId,
    target: data.targetName,
    ownerIds,
    actorIds: docs.map((doc) => doc.id),
  });

  if (ownerIds.length > 0) {
    for (const ownerId of ownerIds) emitTo(ownerId, "showPrompt", data);
    return;
  }

  await showDefenderPrompt(data);
}

async function maybeShowDefenderPrompt(data) {
  if (shownPrompts.has(data.attackId)) return;

  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const docs = getDefenderOwnershipDocs(data, defender);
  const actor = docs[0];

  if (!game.user.isGM) {
    const isTargetOwner = userOwnsAny(game.user, docs, data, defender?.document);
    if (!isTargetOwner) return;
    const owner = pickDefenderUser(actor, { includeGm: false, tokenDocument: defender?.document, data });
    if (owner?.id !== game.user.id) return;
    claimPrompt(data.attackId);
    await showDefenderPrompt(data);
    return;
  }

  window.setTimeout(async () => {
    if (claimedPrompts.has(data.attackId) || shownPrompts.has(data.attackId)) return;
    claimPrompt(data.attackId);
    await showDefenderPrompt(data);
  }, 800);
}

async function requestNoEvade(data) {
  const resolver = pickAttackResolver(data);
  if (resolver === game.user.id) {
    await resolveNoEvade(data);
    return;
  }
  emitTo(resolver, "resolveNoEvade", data);
}

async function requestEvade(data) {
  await resolveEvadeChoice(data);
}

async function submitDefenderChoice(data, action) {
  if ((data.groupTotalTargets ?? 1) <= 1) {
    if (action === "no-evade") await requestNoEvade(data);
    if (action === "evade") await requestEvade(data);
    return;
  }

  const resolver = pickAttackResolver(data);
  const payload = { ...data, defenderAction: action };
  if (resolver === game.user.id) {
    await recordDefenderChoice(payload);
    return;
  }
  emitTo(resolver, "recordChoice", payload);
}

async function recordDefenderChoice(data) {
  const groupId = data.groupAttackId ?? data.attackId;
  const expected = Number(data.groupTotalTargets ?? 1);
  const entry = pendingAttackGroups.get(groupId) ?? {
    expected,
    choices: new Map(),
    evasions: new Map(),
  };

  entry.expected = Math.max(entry.expected, expected);
  entry.choices.set(data.attackId, data);
  pendingAttackGroups.set(groupId, entry);

  await simpleMessage(`${data.targetName} selected ${formatDefenderAction(data.defenderAction)} (${entry.choices.size}/${entry.expected}).`);
  if (entry.choices.size < entry.expected || resolvingAttackGroups.has(groupId)) return;

  resolvingAttackGroups.add(groupId);
  await collectGroupEvasionsOrResolve(groupId, entry);
}

async function collectGroupEvasionsOrResolve(groupId, entry) {
  const choices = Array.from(entry.choices.values()).sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
  const evaders = choices.filter((choice) => choice.defenderAction === "evade");
  if (evaders.length === 0) {
    await resolveAttackGroup(groupId, entry);
    return;
  }

  await simpleMessage("All defenders selected an action. Rolling evasions.");
  const resolverUserId = game.user.id;
  for (const choice of evaders) {
    const recipient = await pickEvasionRoller(choice);
    const payload = { ...choice, resolverUserId };
    if (recipient === game.user.id) {
      await rollGroupEvasion(payload);
    } else {
      emitTo(recipient, "rollGroupEvasion", payload);
    }
  }
}

async function rollGroupEvasion(data) {
  const evasionTotal = await rollEvasionForData(data);
  if (!Number.isFinite(evasionTotal)) return;

  const payload = { ...data, evasionTotal };
  if (data.resolverUserId === game.user.id) {
    await recordGroupEvasion(payload);
    return;
  }
  emitTo(data.resolverUserId, "recordGroupEvasion", payload);
}

async function recordGroupEvasion(data) {
  const groupId = data.groupAttackId ?? data.attackId;
  const entry = pendingAttackGroups.get(groupId);
  if (!entry) return;

  entry.evasions ??= new Map();
  entry.evasions.set(data.attackId, data.evasionTotal);
  const evaders = Array.from(entry.choices.values()).filter((choice) => choice.defenderAction === "evade");
  await simpleMessage(`${data.targetName} Evasion ${data.evasionTotal} (${entry.evasions.size}/${evaders.length}).`);

  if (entry.evasions.size >= evaders.length) {
    if (entry.resolvingFinal) return;
    entry.resolvingFinal = true;
    await resolveAttackGroup(groupId, entry);
  }
}

async function resolveAttackGroup(groupId, entry) {
  const choices = Array.from(entry.choices.values()).sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
  await simpleMessage("Resolving attack group with one attack roll.");

  try {
    const context = await getRollContext(choices[0]);
    if (!context) return;

    const attackRoll = await rollNative(context.actor, context.weapon, "attack");
    if (!attackRoll) return;

    const hits = [];
    for (const choice of choices) {
      const comparison = getGroupComparison(choice, entry);
      if (!comparison) continue;

      const hit = comparison.mode === "dv"
        ? attackRoll.resultTotal >= comparison.target
        : attackRoll.resultTotal > comparison.target;
      if (hit) {
        hits.push(choice);
      } else if (comparison.mode === "dv") {
        await simpleMessage(`${context.actor.name} misses ${choice.targetName} with ${context.weapon.name} (${attackRoll.resultTotal} vs DV ${comparison.target}).`);
      } else {
        await simpleMessage(`${choice.targetName} evades ${context.weapon.name} (${attackRoll.resultTotal} vs Evasion ${comparison.target}).`);
      }
    }

    if (hits.length === 0) {
      await simpleMessage(`${context.weapon.name} hits no targets.`);
      return;
    }

    await simpleMessage(`${context.weapon.name} hits: ${hits.map((hit) => hit.targetName).join(", ")}. Rolling damage once.`);
    await rollNative(context.actor, context.weapon, "damage", {
      tokens: await getDamageTokensForHits(hits),
    });
  } finally {
    pendingAttackGroups.delete(groupId);
    resolvingAttackGroups.delete(groupId);
  }
}

function getGroupComparison(choice, entry) {
  if (choice.defenderAction === "evade") {
    const evasionTotal = Number(entry.evasions?.get(choice.attackId));
    if (!Number.isFinite(evasionTotal)) {
      ui.notifications.warn(`No valid Evasion total for ${choice.targetName}.`);
      return null;
    }
    return { mode: "evasion", target: evasionTotal };
  }

  const dv = Number(choice.dv);
  if (!Number.isFinite(dv)) {
    ui.notifications.warn(`No valid DV for ${choice.targetName}.`);
    return null;
  }
  return { mode: "dv", target: dv };
}

function formatDefenderAction(action) {
  if (action === "no-evade") return "No evade";
  if (action === "evade") return "Si evade";
  return action ?? "-";
}

async function resolveEvadeChoice(data) {
  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const [defenderActor] = getDefenderOwnershipDocs(data, defender);
  if (!game.user.isGM && userOwnsAny(game.user, getDefenderOwnershipDocs(data, defender), data, defender?.document)) {
    await rollEvasionAndContinue(data);
    return;
  }

  const evasionUser = defenderActor
    ? pickDefenderUser(defenderActor, { tokenDocument: defender?.document, data })
    : null;
  const recipient = evasionUser?.id ?? pickAttackResolver(data);
  if (recipient === game.user.id) {
    await rollEvasionAndContinue(data);
    return;
  }
  emitTo(recipient, "rollEvasion", data);
}

async function pickEvasionRoller(data) {
  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const [defenderActor] = getDefenderOwnershipDocs(data, defender);
  const evasionUser = defenderActor
    ? pickDefenderUser(defenderActor, { tokenDocument: defender?.document, data })
    : null;
  return evasionUser?.id ?? pickAttackResolver(data);
}

function pickAttackResolver(data) {
  const attacker = getActorById(data.attackerActorId);
  const activeOwner = attacker
    ? game.users.find((user) => user.active && !user.isGM && attacker.testUserPermission(user, "OWNER"))
    : null;
  return activeOwner?.id ?? game.users.find((user) => user.isGM && user.active)?.id ?? game.user.id;
}

async function resolveNoEvade(data) {
  const context = await getRollContext(data);
  if (!context) return;
  const attackRoll = await rollNative(context.actor, context.weapon, "attack");
  if (!attackRoll) return;

  const dv = Number(data.dv);
  if (!Number.isFinite(dv)) {
    ui.notifications.warn("Attack was rolled, but no valid DV was available for comparison.");
    return;
  }

  if (attackRoll.resultTotal >= dv) {
    await rollNative(context.actor, context.weapon, "damage", {
      tokens: await getDamageTokensForHits([data]),
    });
  } else {
    await simpleMessage(`${context.actor.name} misses ${data.targetName} with ${context.weapon.name} (${attackRoll.resultTotal} vs DV ${dv}).`);
  }
}

async function rollEvasionAndContinue(data) {
  const evasionTotal = await rollEvasionForData(data);
  if (!Number.isFinite(evasionTotal)) return;

  const resolver = pickAttackResolver(data);
  const payload = { ...data, evasionTotal };
  if (resolver === game.user.id) {
    await resolveAgainstEvasion(payload);
    return;
  }
  emitTo(resolver, "resolveAgainstEvasion", payload);
}

async function rollEvasionForData(data) {
  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const actor = defender?.actor ?? getActorById(data.targetBaseActorId) ?? getActorById(data.targetActorId);
  if (!actor) {
    ui.notifications.warn("Could not find the defender actor for Evasion.");
    return null;
  }

  const evasion = findEvasionSkill(actor);
  if (!evasion) {
    ui.notifications.warn(`${actor.name} has no Evasion skill item.`);
    return null;
  }

  const evasionRoll = await rollNative(actor, evasion, "skill");
  return evasionRoll?.resultTotal ?? null;
}

async function resolveAgainstEvasion(data) {
  const context = await getRollContext(data);
  if (!context) return;
  const attackRoll = await rollNative(context.actor, context.weapon, "attack");
  if (!attackRoll) return;

  const evasionTotal = Number(data.evasionTotal);
  if (attackRoll.resultTotal > evasionTotal) {
    await rollNative(context.actor, context.weapon, "damage", {
      tokens: await getDamageTokensForHits([data]),
    });
  } else {
    await simpleMessage(`${data.targetName} evades ${context.weapon.name} (${attackRoll.resultTotal} vs Evasion ${evasionTotal}).`);
  }
}

async function rollNative(actor, item, rollType, { tokens = [] } = {}) {
  if (!CPRChatClass) {
    ui.notifications.error("CPR Combat Automatism native roll adapter is not available.");
    return null;
  }

  const extraData = {};
  const savedFireType = actor.getFlag(game.system.id, `firetype-${item.id}`);
  if (rollType === "damage" && savedFireType) extraData.damageType = savedFireType;

  let cprRoll = item.createRoll(rollType, actor, extraData);
  if (!cprRoll) {
    ui.notifications.warn(`Could not create native ${rollType} roll for ${item.name}.`);
    return null;
  }

  const keepRolling = await cprRoll.handleRollDialog({ ctrlKey: false, type: MODULE_ID }, actor, item);
  if (!keepRolling) return null;

  cprRoll = await item.confirmRoll(cprRoll);
  await cprRoll.roll();
  cprRoll.entityData = ChatMessage.getSpeaker({ actor });
  cprRoll.entityData.item = item.id;
  cprRoll.entityData.tokens = rollType === "damage" ? tokens : [];
  await CPRChatClass.RenderRollCard(cprRoll);
  return cprRoll;
}

async function getDamageTokensForHits(hits) {
  const tokens = [];
  for (const hit of hits) {
    const resolved = await resolveToken(hit.targetSceneId, hit.targetTokenId, hit.targetActorId);
    const token = normalizeDamageToken(resolved);
    if (token) tokens.push(token);
  }
  return tokens;
}

function normalizeDamageToken(resolved) {
  const token = resolved?.document ? resolved.document : resolved;
  const actor = resolved?.actor ?? token?.actor;
  const id = token?.id ?? token?._id;
  if (!id || !actor) return null;

  return {
    id,
    name: token.name ?? actor.name,
    actor,
  };
}

async function getRollContext(data) {
  const token = await resolveToken(data.attackerSceneId, data.attackerTokenId, data.attackerActorId);
  const actor = token?.actor ?? getActorById(data.attackerActorId);
  const weapon = actor?.items?.get(data.weaponId);
  if (!actor || !weapon) {
    ui.notifications.warn("Could not resolve attacker or weapon for CPR Combat Automatism.");
    return null;
  }
  return { actor, weapon, token };
}

async function resolveToken(sceneId, tokenId, actorId) {
  if (canvas.scene?.id === sceneId) {
    const placeable = canvas.tokens?.get(tokenId);
    if (placeable) return placeable;
  }

  const scene = game.scenes.get(sceneId);
  const tokenDocument = scene?.tokens.get(tokenId);
  if (!tokenDocument) return actorId ? { actor: getActorById(actorId) } : null;
  return { document: tokenDocument, actor: tokenDocument.actor };
}

function getActorById(actorId) {
  return game.actors.get(actorId) ?? Object.values(game.actors.tokens).find((actor) => actor.id === actorId);
}

function getDefenderOwnershipDocs(data, defender) {
  const docs = [
    defender?.actor,
    defender?.document?.actor,
    getActorById(data.targetActorId),
    getActorById(data.targetBaseActorId),
    getActorById(defender?.document?.actorId),
  ].filter(Boolean);

  return docs.filter((doc, index) => docs.findIndex((candidate) => candidate.id === doc.id) === index);
}

function userOwnsAny(user, docs, data, tokenDocument) {
  const actorIds = new Set([
    data?.targetActorId,
    data?.targetBaseActorId,
    tokenDocument?.actorId,
    ...docs.map((doc) => doc.id),
  ].filter(Boolean));

  const characterIds = getUserCharacterIds(user);
  if (characterIds.some((id) => actorIds.has(id))) return true;
  return docs.some((doc) => isOwner(doc, user));
}

function getUserCharacterIds(user) {
  const character = user?.character;
  return [
    typeof character === "string" ? character : null,
    character?.id,
    character?._id,
    user?.characterId,
    user?._source?.character,
  ].filter(Boolean);
}

function isOwner(document, user) {
  if (!document || !user) return false;
  const characterIds = getUserCharacterIds(user);
  if (characterIds.includes(document.id) || characterIds.includes(document._id)) return true;

  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  try {
    if (document.testUserPermission?.(user, ownerLevel)) return true;
    if (document.testUserPermission?.(user, "OWNER")) return true;
  } catch (_error) {
    // Fall through to direct ownership data checks.
  }

  const ownership = document.ownership ?? document._source?.ownership ?? document.permission ?? document._source?.permission ?? {};
  const userLevel = Number(ownership[user.id] ?? 0);
  const defaultLevel = Number(ownership.default ?? ownership.DEFAULT ?? 0);
  return Math.max(userLevel, defaultLevel) >= ownerLevel;
}

function findEvasionSkill(actor) {
  const normalize = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return actor.items.find((item) => {
    if (item.type !== "skill") return false;
    const name = normalize(item.name);
    return name === "evasion";
  });
}

async function calculateDv(weapon, attacker, target) {
  const distance = measureDistance(attacker, target);
  const tableName = weapon.system?.dvTable || inferDvTableName(weapon);
  if (!tableName) {
    return { distance, reason: "Weapon has no DV table." };
  }

  const table = await findDvTable(tableName);
  if (!table) {
    return { distance, tableName, reason: `DV table not found: ${tableName}` };
  }

  for (const result of table.results) {
    const range = result.range ?? [];
    if (range.length < 2) continue;
    if (distance >= Number(range[0]) && distance <= Number(range[1])) {
      const dv = Number(String(result.text).match(/\d+/)?.[0]);
      return {
        dv: Number.isFinite(dv) ? dv : null,
        distance,
        tableName: table.name,
        bandLabel: `${range[0]}-${range[1]} ${canvas.scene.grid.units}`,
        reason: Number.isFinite(dv) ? "" : `DV entry is not numeric: ${result.text}`,
      };
    }
  }

  return { distance, tableName: table.name, reason: "Distance is outside this DV table." };
}

async function findDvTable(tableName) {
  const normalizedName = normalizeTableName(tableName);
  const packs = game.packs.filter((pack) => pack.documentName === "RollTable");
  const preferred = [
    game.packs.get(`${SYSTEM_ID}.internal_dv-tables`),
    ...packs,
  ].filter(Boolean);

  for (const pack of preferred) {
    const index = await pack.getIndex();
    const match = index.find((entry) => normalizeTableName(entry.name) === normalizedName);
    if (match) return pack.getDocument(match._id);
  }

  return game.tables.find((table) => normalizeTableName(table.name) === normalizedName) ?? null;
}

function inferDvTableName(weapon) {
  const source = `${weapon.name} ${weapon.system?.weaponType ?? ""} ${weapon.system?.ammoVariety ?? ""}`;
  const value = normalizeTableName(source);
  if (value.includes("sniper")) return "DV Sniper Rifle";
  if (value.includes("assault")) return "DV Assault Rifle";
  if (value.includes("shotgun")) return "DV Shotgun (Slug)";
  if (value.includes("rocket")) return "DV Rocket Launcher";
  if (value.includes("grenade")) return "DV Grenade Launcher";
  if (value.includes("crossbow") || value.includes("bow")) return "DV Bows & Crossbows";
  if (value.includes("smg")) return "DV SMG";
  if (value.includes("pistol")) return "DV Pistol";
  return "";
}

function normalizeTableName(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function measureDistance(a, b) {
  if (canvas.grid?.measurePath) {
    const path = [{ x: a.center.x, y: a.center.y, elevation: getElevation(a) }, { x: b.center.x, y: b.center.y, elevation: getElevation(b) }];
    const result = canvas.grid.measurePath(path);
    if (Number.isFinite(result.distance)) return result.distance;
  }

  const gridDistance = canvas.scene.grid.distance || 1;
  const size = canvas.scene.grid.size || 100;
  const dx = (a.center.x - b.center.x) / size * gridDistance;
  const dy = (a.center.y - b.center.y) / size * gridDistance;
  const dz = getElevation(a) - getElevation(b);
  return Math.hypot(dx, dy, dz);
}

function getElevation(token) {
  return Number(token.document?.elevation ?? token.elevation ?? 0);
}

function getWeaponDamage(weapon) {
  try {
    return weapon.getWeaponDamage?.() ?? weapon.system?.damage ?? "-";
  } catch (_error) {
    return weapon.system?.damage ?? "-";
  }
}

function formatDistance(distance) {
  if (!Number.isFinite(distance)) return "-";
  const units = canvas.scene?.grid?.units || "m";
  return `${Math.round(distance * 10) / 10} ${units}`;
}

async function simpleMessage(content) {
  await ChatMessage.create({
    user: game.user.id,
    content: `
      <div class="rollcard cpr-af-message">
        <div class="rollcard-bottom">
          <div class="cpr-block text-normal">
            <div class="cpr-af-message-content">${content}</div>
          </div>
        </div>
      </div>
    `,
  });
}

function emitTo(userId, type, data) {
  game.socket.emit(SOCKET, { userId, type, data });
}

async function onSocket(message) {
  if (message.type === "promptClaimed") {
    claimedPrompts.add(message.attackId);
    return;
  }

  if (message.userId && message.userId !== game.user.id) return;
  if (message.type === "routePrompt") await routeDefenderPrompt(message.data);
  if (message.type === "maybeShowPrompt") await maybeShowDefenderPrompt(message.data);
  if (message.type === "showPrompt") await showDefenderPrompt(message.data);
  if (message.type === "recordChoice") await recordDefenderChoice(message.data);
  if (message.type === "rollGroupEvasion") await rollGroupEvasion(message.data);
  if (message.type === "recordGroupEvasion") await recordGroupEvasion(message.data);
  if (message.type === "resolveNoEvade") await resolveNoEvade(message.data);
  if (message.type === "rollEvasion") await rollEvasionAndContinue(message.data);
  if (message.type === "resolveAgainstEvasion") await resolveAgainstEvasion(message.data);
}
