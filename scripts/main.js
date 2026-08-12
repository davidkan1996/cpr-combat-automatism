const MODULE_ID = "cpr-combat-automatism";
const SYSTEM_ID = "cyberpunk-red-core";
const DIWAKO_CPRED_ADDITIONS_ID = "diwako-cpred-additions";
const SOCKET = `module.${MODULE_ID}`;
const TEMPLATES = {
  dialog: `modules/${MODULE_ID}/templates/attack-dialog.hbs`,
  programTargetDialog: `modules/${MODULE_ID}/templates/program-target-dialog.hbs`,
  card: `modules/${MODULE_ID}/templates/attack-card.hbs`,
  declaration: `modules/${MODULE_ID}/templates/declaration-card.hbs`,
};

let CPRChatClass = null;
let CPRInterfaceRollClass = null;
const processedActions = new Set();
const claimedPrompts = new Set();
const shownPrompts = new Set();
const renderingPrompts = new Set();
const routedPrompts = new Set();
const knownAttackDeclarations = new Map();
const pendingAttackGroups = new Map();
const resolvingAttackGroups = new Set();
const pendingNativeResultSuppressions = new Map();
const SOCKET_MESSAGE_TYPES = new Set([
  "promptClaimed",
  "routePrompt",
  "maybeShowPrompt",
  "showPrompt",
  "recordChoice",
  "rollGroupEvasion",
  "recordGroupEvasion",
  "resolveNoEvade",
  "rollEvasion",
  "resolveAgainstEvasion",
]);
const FIRE_MODE_ROLL_TYPES = new Set(["aimed", "autofire", "suppressive"]);
const AIMED_LOCATIONS = new Set(["head", "heldItem", "leg"]);
const CONTESTED_DEFENDER_ACTIONS = new Set(["evade", "concentration", "net-defense"]);
const NETRUNNING_ATTACKER_PROGRAM_CLASSES = new Set(["antipersonnelattacker", "antiprogramattacker"]);
const CHAT_STYLE_CLASSES = ["cpr-chat--combat", "cpr-chat--neutral", "cpr-chat--netrunning"];
const COMBAT_SKILL_SLUGS = new Set([
  "archery",
  "arqueria",
  "arma-cuerpo-a-cuerpo",
  "armas-de-hombro",
  "armas-pesadas",
  "artes-marciales",
  "autofire",
  "brawling",
  "disparo-automatico",
  "evasion",
  "handgun",
  "heavy-weapons",
  "martial-arts",
  "melee-weapon",
  "pelear",
  "pistola-de-mano",
  "shoulder-arms",
]);
const NETRUNNING_ROLL_TITLE_KEYS = [
  "CPR.global.role.netrunner.ability.interface",
  "CPR.global.role.netrunner.interfaceAbility.backdoor",
  "CPR.global.role.netrunner.interfaceAbility.cloak",
  "CPR.global.role.netrunner.interfaceAbility.control",
  "CPR.global.role.netrunner.interfaceAbility.eyedee",
  "CPR.global.role.netrunner.interfaceAbility.pathfinder",
  "CPR.global.role.netrunner.interfaceAbility.scanner",
  "CPR.global.role.netrunner.interfaceAbility.slide",
  "CPR.global.role.netrunner.interfaceAbility.virus",
  "CPR.global.role.netrunner.interfaceAbility.zap",
];
const NETRUNNING_PROGRAM_CLASS_KEYS = [
  "CPR.global.programClass.antiPersonnelAttacker",
  "CPR.global.programClass.antiProgramAttacker",
  "CPR.global.programClass.blackice",
  "CPR.global.programClass.booster",
  "CPR.global.programClass.defender",
  "CPR.global.programClass.quickhack",
];
const SHOTGUN_DV_TABLES = {
  shell: "DV Shotgun (Shell)",
  slug: "DV Shotgun (Slug)",
};
const STATIC_DV_TABLES = new Map([
  [normalizeTableName(SHOTGUN_DV_TABLES.shell), 13],
]);
const STANDARD_DV_TABLES = new Set([
  "DV Assault Rifle",
  "DV Bows & Crossbows",
  "DV Grenade Launcher",
  "DV Pistol",
  "DV Rocket Launcher",
  "DV Shotgun (Shell)",
  "DV Shotgun (Slug)",
  "DV SMG",
  "DV Sniper Rifle",
]);
const WEAPON_TYPE_LABELS = {
  assaultRifle: "Assault Rifle",
  bow: "Bows & Crossbows",
  grenadeLauncher: "Grenade Launcher",
  heavyMelee: "Heavy Melee Weapon",
  heavyPistol: "Heavy Pistol",
  heavySmg: "Heavy SMG",
  lightMelee: "Light Melee Weapon",
  martialArts: "Martial Arts",
  medMelee: "Medium Melee Weapon",
  medPistol: "Medium Pistol",
  rocketLauncher: "Rocket Launcher",
  shotgun: "Shotgun",
  smg: "SMG",
  sniperRifle: "Sniper Rifle",
  thrownWeapon: "Thrown Weapon",
  unarmed: "Unarmed",
  vHeavyMelee: "Very Heavy Melee Weapon",
  vHeavyPistol: "Very Heavy Pistol",
};

Hooks.once("ready", async () => {
  if (game.system.id !== SYSTEM_ID) {
    ui.notifications.warn("CPR Combat Automatism only works with Cyberpunk RED - CORE.");
    return;
  }

  try {
    CPRChatClass = (await import(`/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`)).default;
    CPRInterfaceRollClass = (await import(`/systems/${SYSTEM_ID}/modules/rolls/cpr-rolls.js`)).CPRInterfaceRoll;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not import Cyberpunk RED chat adapter`, error);
    ui.notifications.error("CPR Combat Automatism could not load the Cyberpunk RED native roll adapter. See console.");
  }

  game.cprCombatAutomatism = createPublicApi();
  game.cprAttackFlow = game.cprCombatAutomatism;
  game.socket.on(SOCKET, onSocket);
});

function createPublicApi() {
  return Object.freeze({
    open: openAttackDialog,
    prepareAttack: prepareAttackApi,
    declareAttack: declareAttackApi,
    resolveAttack: resolveAttackApi,
    chooseDefense: chooseDefenseApi,
    getWeapons,
    getAttackOptions,
  });
}

async function prepareAttackApi(input = {}) {
  const request = normalizePublicAttackRequest(input ?? {});
  if (!request) return [];
  return prepareAttackDeclarations(request.attacker, request.targets, request.weapon, {
    targetPrograms: request.targetPrograms,
  });
}

async function declareAttackApi(input = {}) {
  const request = normalizePublicAttackRequest(input ?? {});
  if (!request) return [];
  let { targetPrograms } = request;
  if (needsProgramTargetPrompt(request.attacker, request.targets, request.weapon, targetPrograms)) {
    targetPrograms = await promptForTargetPrograms(request.attacker, request.targets, request.weapon);
    if (targetPrograms === null) return [];
  }
  return createAttackCards(request.attacker, request.targets, request.weapon, {
    dispatchPrompts: input?.dispatchPrompts !== false,
    targetPrograms,
  });
}

async function resolveAttackApi(data, options = {}) {
  const { defenderAction = "no-evade", defenseTotal = null, evasionTotal = null } = options ?? {};
  const action = normalizeDefenderAction(defenderAction);
  if (!action) {
    ui.notifications.warn("Unsupported CPR Combat Automatism defender action.");
    return null;
  }

  const total = Number(defenseTotal ?? evasionTotal);
  if (CONTESTED_DEFENDER_ACTIONS.has(action) && Number.isFinite(total)) {
    return resolveAgainstEvasion({ ...data, defenderAction: action, evasionTotal: total });
  }
  if (action === "concentration") return rollEvasionAndContinue({ ...data, defenderAction: action });
  return submitDefenderChoice(data, action);
}

async function chooseDefenseApi(data, defenderAction) {
  const action = normalizeDefenderAction(defenderAction);
  if (!action) {
    ui.notifications.warn("Unsupported CPR Combat Automatism defender action.");
    return null;
  }
  return submitDefenderChoice(data, action);
}

function normalizePublicAttackRequest(input = {}) {
  input ??= {};
  const selection = (!input.attacker || !input.targets) ? getSelection() : null;
  const attacker = input.attacker ?? selection?.attacker;
  const targets = normalizeTargetList(input.targets ?? selection?.targets);
  const weapon = input.weapon ?? (attacker?.actor ? getWeapons(attacker.actor)[0] : null);

  if (!attacker?.actor || !attacker?.document) {
    ui.notifications.warn("A public CPR Combat Automatism attack needs an attacker token.");
    return null;
  }
  if (targets.length === 0 || targets.some((target) => !target?.actor || !target?.document)) {
    ui.notifications.warn("A public CPR Combat Automatism attack needs one or more target tokens.");
    return null;
  }
  if (!weapon) {
    ui.notifications.warn("A public CPR Combat Automatism attack needs a weapon.");
    return null;
  }
  return {
    attacker,
    targets,
    weapon,
    targetPrograms: normalizeTargetProgramSelections(input.targetPrograms),
  };
}

function normalizeTargetList(targets) {
  if (!targets) return [];
  if (Array.isArray(targets)) return targets;
  if (typeof targets[Symbol.iterator] === "function") return Array.from(targets);
  return [targets];
}

function normalizeTargetProgramSelections(selections) {
  if (!selections) return new Map();
  if (selections instanceof Map) return new Map(selections);
  if (Array.isArray(selections)) return new Map(selections);
  if (typeof selections === "object") return new Map(Object.entries(selections));
  return new Map();
}

function needsProgramTargetPrompt(attacker, targets, weapon, targetPrograms) {
  if (!isAntiProgramAttack(attacker?.actor, weapon)) return false;
  const selections = normalizeTargetProgramSelections(targetPrograms);
  return targets.some((target) => {
    if (!isNetrunnerActor(target.actor)) return false;
    const selection = selections.get(target.document.id) ?? selections.get(target.actor.id);
    return !findRezzedProgramOption(target.actor, selection);
  });
}

function normalizeDefenderAction(action) {
  if (action === true || action === "evade") return "evade";
  if (action === false || action === "noEvade" || action === "no-evade") return "no-evade";
  if (action === "concentration" || action === "suppressive") return "concentration";
  if (action === "net-defense" || action === "netDefense" || action === "netrunning") return "net-defense";
  return null;
}

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
  if (await maybeSuppressNativeResultMessage(message)) return;

  const declarations = message.getFlag(MODULE_ID, "attackDeclarations")
    ?? [message.getFlag(MODULE_ID, "attackDeclaration")].filter(Boolean);
  if (declarations.length === 0) return;
  for (const declaration of declarations) rememberAttackDeclaration(declaration);
  const declaration = declarations[0];
  if (declarations.every(shouldSkipDefenderPrompt)) return;
  if (!game.user.isGM) return;
  for (const entry of declarations) {
    if (!shouldSkipDefenderPrompt(entry)) await routeDefenderPrompt(entry);
  }
});

Hooks.on("renderChatMessage", (message, html) => {
  applyChatMessageStyle(message, html);
  const root = html.find?.(".cpr-af-declaration")?.first?.();
  if (!root?.length) return;
  root.find("[data-cpr-af-roll-detail]").on("click", (event) => {
    event.preventDefault();
    const detailId = event.currentTarget.dataset.cprAfRollDetail;
    const panels = root.find("[data-cpr-af-detail-panel]");
    const selected = panels.filter(`[data-cpr-af-detail-panel='${detailId}']`);
    const wasVisible = !selected.hasClass("cpr-af-roll-detail-collapsed");
    panels.prop("hidden", true).addClass("cpr-af-roll-detail-collapsed");
    root.find("[data-cpr-af-roll-detail]").attr("aria-expanded", "false");
    if (!wasVisible) {
      selected.prop("hidden", false).removeClass("cpr-af-roll-detail-collapsed");
      event.currentTarget.setAttribute("aria-expanded", "true");
    }
  });

  root.find("[data-cpr-af-apply-damage]").on("click", async (event) => {
    event.preventDefault();
    const index = Number(event.currentTarget.dataset.cprAfApplyDamage);
    const application = root.parent()
      .find(".cpr-af-native-rolls [data-action='applyDamage'][data-scope='local']")
      .get(index);
    if (!application || !CPRChatClass) return;
    await CPRChatClass.damageApplication({
      currentTarget: application,
      target: application,
      ctrlKey: false,
    });
  });

  root.find("[data-cpr-af-apply-program-damage]").on("click", async (event) => {
    event.preventDefault();
    await applyProgramDamageFromElement(event.currentTarget);
  });

  const applyAllButton = root.parent().find("[data-cpr-af-apply-all]");
  if (!game.user.isGM) {
    applyAllButton.remove();
    return;
  }
  applyAllButton.on("click", async (event) => {
    event.preventDefault();
    if (!game.user.isGM) return;
    const button = event.currentTarget;
    if (button.dataset.cprAfApplying === "true") return;
    button.dataset.cprAfApplying = "true";
    button.classList.add("cpr-af-applying");
    try {
      const programApplications = root
        .find("[data-cpr-af-apply-program-damage]")
        .toArray();
      for (const application of programApplications) {
        await applyProgramDamageFromElement(application);
      }

      const applications = root.parent()
        .find(".cpr-af-native-damage-data [data-action='applyDamage'][data-scope='local']")
        .toArray();
      for (const application of applications) {
        if (!CPRChatClass) break;
        await CPRChatClass.damageApplication({
          currentTarget: application,
          target: application,
          ctrlKey: true,
        });
      }
    } finally {
      button.dataset.cprAfApplying = "false";
      button.classList.remove("cpr-af-applying");
    }
  });
});

function applyChatMessageStyle(message, html) {
  const category = classifyChatMessage(message, html);
  if (!category) return;
  const elements = new Set();
  collectChatStyleElements(elements, html);
  collectChatStyleElements(elements, html.closest?.(".chat-message"));
  collectChatStyleElements(elements, html.find?.([
    ".chat-message",
    ".message-content",
    ".rollcard",
    ".cpr-block",
    ".cpr-uplink-request",
    ".cpr-uplink-tracker",
    ".cpr-qh-card",
  ].join(", ")));

  for (const element of elements) {
    element.classList.remove(...CHAT_STYLE_CLASSES);
    element.classList.add(`cpr-chat--${category}`);
    element.dataset.cprChatCategory = category;
  }
}

function collectChatStyleElements(elements, source) {
  if (!source) return;
  if (source.nodeType === 1) elements.add(source);
  if (typeof source.toArray === "function") {
    for (const element of source.toArray()) {
      if (element?.nodeType === 1) elements.add(element);
    }
    return;
  }
  const element = source[0];
  if (element?.nodeType === 1) elements.add(element);
}

function classifyChatMessage(message, html) {
  const declarations = getChatAttackDeclarations(message);
  if (declarations.length > 0) {
    return declarations.some((entry) => entry?.weapon?.netAction || entry?.netAction)
      ? "netrunning"
      : "combat";
  }

  const uplinkTracker = message.getFlag?.("cpr-dice-uplink", "tracker");
  if (uplinkTracker) return isCombatUplinkTracker(uplinkTracker) ? "combat" : "neutral";

  if (isNetrunningChatMessage(message, html)) return "netrunning";
  if (isCombatChatMessage(message, html)) return "combat";
  if (isNeutralChatMessage(message, html)) return "neutral";
  return null;
}

function getChatAttackDeclarations(message) {
  const declarations = message.getFlag?.(MODULE_ID, "attackDeclarations");
  if (Array.isArray(declarations) && declarations.length > 0) return declarations.filter(Boolean);
  const declaration = message.getFlag?.(MODULE_ID, "attackDeclaration");
  return declaration ? [declaration] : [];
}

function isNetrunningChatMessage(_message, html) {
  if (hasChatElement(html, [
    ".cpr-qh-card",
    "[data-program-id]",
    "[data-cpr-af-apply-program-damage]",
    "[data-action='applyDamage'][data-damage-location='brain'][data-ablation='0']:not([data-damage-lethal])",
  ])) return true;
  if (hasNetrunningProgramClass(html)) return true;
  const rollTitle = getNativeRollTitle(html);
  return Boolean(rollTitle) && getLocalizedSlugs(NETRUNNING_ROLL_TITLE_KEYS)
    .has(slugifyChatLabel(rollTitle));
}

function isCombatChatMessage(_message, html) {
  if (hasChatElement(html, [
    ".cpr-af-card",
    ".cpr-af-declaration",
    "[data-action='rollDamage']",
    "[data-action='applyDamage']",
  ])) return true;
  const skillTitle = getNativeSkillTitle(html);
  return skillTitle ? isCombatSkillTitle(skillTitle) : false;
}

function isNeutralChatMessage(_message, html) {
  if (hasChatElement(html, [".cpr-uplink-card", ".cpr-uplink-tracker"])) return true;
  return Boolean(getNativeSkillTitle(html)) || hasLocalizedRollSubtitle(html, [
    "CPR.global.itemTypes.skill",
    "CPR.rolls.roleAbility",
  ]);
}

function getNativeSkillTitle(html) {
  if (!hasLocalizedRollSubtitle(html, ["CPR.global.itemTypes.skill"])) return "";
  return getNativeRollTitle(html);
}

function getNativeRollTitle(html) {
  return html.find?.(".rollcard .chat-rollTitle-stat > .text-normal")?.first?.().text?.().trim?.() ?? "";
}

function hasLocalizedRollSubtitle(html, keys) {
  const labels = keys.map((key) => game.i18n.localize(key)).filter(Boolean);
  return html.find?.(".rollcard .text-small")?.toArray?.()
    ?.some((element) => labels.includes(element.textContent?.trim())) ?? false;
}

function hasNetrunningProgramClass(html) {
  const classSlugs = getLocalizedSlugs(NETRUNNING_PROGRAM_CLASS_KEYS);
  return html.find?.(".rollcard .rollcard-subtitle-2-center")?.toArray?.()
    ?.some((element) => {
      const subtitle = slugifyChatLabel(element.textContent);
      return [...classSlugs].some((classSlug) => (
        subtitle === classSlug || subtitle.endsWith(`-${classSlug}`)
      ));
    }) ?? false;
}

function hasChatElement(html, selectors) {
  return selectors.some((selector) => Boolean(html.find?.(selector)?.length));
}

function slugifyChatLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getLocalizedSlugs(keys) {
  return new Set(keys.flatMap((key) => {
    const localized = game.i18n.localize(key);
    return [key.split(".").at(-1), localized === key ? "" : localized]
      .map(slugifyChatLabel)
      .filter(Boolean);
  }));
}

function isCombatSkillTitle(title) {
  const slug = slugifyChatLabel(title);
  return [...COMBAT_SKILL_SLUGS].some((combatSlug) => (
    slug === combatSlug || slug.startsWith(`${combatSlug}-`)
  ));
}

function isCombatUplinkTracker(tracker) {
  if (!tracker) return false;
  const descriptors = (tracker.rows ?? [])
    .map((row) => row?.request?.roll)
    .filter(Boolean);
  if (descriptors.some((roll) => roll.category === "combat" || roll.kind === "combat-roll")) {
    return true;
  }
  const requestedSkills = descriptors
    .filter((roll) => roll.kind === "skill-roll" || roll.category === "skills")
    .map((roll) => roll.skillName ?? roll.label);
  if (requestedSkills.some(isCombatSkillTitle)) return true;
  return descriptors.length === 0 && isCombatSkillTitle(tracker.rollLabel);
}

async function applyProgramDamageFromElement(element) {
  if (!element || element.dataset.cprAfApplying === "true" || element.disabled) return false;
  element.dataset.cprAfApplying = "true";
  element.disabled = true;
  try {
    const applied = await applyProgramDamage({
      targetSceneId: element.dataset.cprAfTargetSceneId,
      targetTokenId: element.dataset.cprAfTargetTokenId,
      targetActorId: element.dataset.cprAfTargetActorId,
      targetProgramId: element.dataset.cprAfTargetProgramId,
      targetCyberdeckId: element.dataset.cprAfTargetCyberdeckId,
      damage: Number(element.dataset.cprAfProgramDamage),
    });
    if (!applied) element.disabled = false;
    return applied;
  } finally {
    element.dataset.cprAfApplying = "false";
  }
}

async function applyProgramDamage({
  targetSceneId,
  targetTokenId,
  targetActorId,
  targetProgramId,
  targetCyberdeckId,
  damage,
}) {
  const amount = Math.max(0, Math.floor(Number(damage)));
  if (!Number.isFinite(amount)) return false;

  const target = await resolveToken(targetSceneId, targetTokenId, targetActorId);
  const actor = target?.actor ?? getActorById(targetActorId);
  const cyberdeck = getOwnedItem(actor, targetCyberdeckId);
  const program = getOwnedItem(actor, targetProgramId);
  const installedIds = getInstalledItemIds(cyberdeck);
  if (
    !actor
    || cyberdeck?.type !== "cyberdeck"
    || program?.type !== "program"
    || (installedIds.size > 0 && !installedIds.has(getItemId(program)))
  ) {
    ui.notifications.warn("No se pudo resolver el programa objetivo para aplicar el dano.");
    return false;
  }
  if (typeof cyberdeck.reduceRezProgram !== "function") {
    ui.notifications.warn("El cyberdeck objetivo no permite reducir el REZ del programa.");
    return false;
  }

  try {
    await cyberdeck.reduceRezProgram(program, amount);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not apply program REZ damage`, error);
    ui.notifications.warn("No se pudo aplicar el dano al programa objetivo.");
    return false;
  }
}

async function openAttackDialog() {
  const selection = getSelection();
  if (!selection) return;

  const { attacker, targets } = selection;
  const weapons = getAttackOptions(attacker.actor);
  if (weapons.length === 0) {
    ui.notifications.warn("The selected attacker has no available attacks.");
    return;
  }

  const selected = await buildDialogWeaponView(weapons[0], attacker, targets);
  const programTargets = getProgramTargetPromptData(targets);
  const content = await renderTemplate(TEMPLATES.dialog, {
    attackerName: attacker.name,
    targetName: formatTargetList(targets),
    targetCount: targets.length,
    isMultiTarget: targets.length > 1,
    weapons: weapons.map((weapon, index) => ({
      id: String(index),
      name: weapon.name,
      selected: index === 0,
    })),
    selected,
    programTargets,
    showProgramTargets: isAntiProgramAttack(attacker.actor, weapons[0]),
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
          const weapon = findWeaponBySelection(weapons, getSelectedWeaponId(html));
          const targetPrograms = getSelectedTargetPrograms(html);
          await createAttackCards(attacker, targets, weapon, { targetPrograms });
        },
      },
      cancel: {
        label: "Cancel",
      },
    },
    default: "create",
    render: (html) => {
      let weaponViewRequest = 0;
      syncProgramTargetControls(html, attacker.actor, weapons[0], programTargets);
      html.find("[name='weaponId']").on("change", async (event) => {
        const request = ++weaponViewRequest;
        const weapon = findWeaponBySelection(weapons, event.currentTarget.value);
        if (!weapon) return;
        const view = await buildDialogWeaponView(weapon, attacker, targets);
        if (request !== weaponViewRequest) return;
        html.find("[data-cpr-af-field='damage']").text(view.damage);
        html.find("[data-cpr-af-field='skill']").text(view.skill);
        html.find("[data-cpr-af-field='table']").text(view.tableName);
        html.find("[data-cpr-af-field='dv']").text(view.dvLabel ?? view.dv ?? "-");
        syncProgramTargetControls(html, attacker.actor, weapon, programTargets);
      });
    },
  });

  dialog.render(true);
}

async function promptForTargetPrograms(attacker, targets, weapon) {
  const programTargets = getProgramTargetPromptData(targets);
  if (programTargets.length === 0) return new Map();

  const content = await renderTemplate(TEMPLATES.programTargetDialog, {
    attackerName: attacker.name,
    attackName: weapon.program?.name ?? weapon.name,
    programTargets,
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new Dialog({
      title: `${weapon.program?.name ?? weapon.name}: Programa objetivo`,
      content,
      buttons: {
        create: {
          label: "Crear ataque",
          callback: (html) => finish(getSelectedTargetPrograms(html)),
        },
        cancel: {
          label: "Cancelar",
          callback: () => finish(null),
        },
      },
      default: "create",
      render: (html) => syncProgramTargetControls(
        html,
        attacker.actor,
        weapon,
        programTargets,
      ),
      close: () => finish(null),
    });
    dialog.render(true);
  });
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
  const weapons = getCollectionValues(actor.items).filter((item) => item.type === "weapon");
  return weapons.length ? weapons : actor.system?.weapons?.available ?? [];
}

function getAttackOptions(actor) {
  return [
    ...getWeapons(actor),
    ...getNetrunningAttackOptions(actor),
  ];
}

function getNetrunningAttackOptions(actor) {
  if (!actor) return [];
  if (actor.type === "blackIce") {
    return [{
      id: `net-blackice-${actor.id}`,
      name: `${actor.name} ATK`,
      type: "netrunning",
      netAction: "blackice",
      actor,
    }];
  }

  const options = [];
  for (const cyberdeck of getCyberdecks(actor)) {
    options.push({
      id: `net-zap-${cyberdeck.id}`,
      name: `Zap (${cyberdeck.name})`,
      type: "netrunning",
      netAction: "zap",
      cyberdeck,
    });

    for (const program of getInstalledPrograms(cyberdeck)) {
      if (!isNetrunningAttackerProgram(program)) continue;
      options.push({
        id: `net-program-${cyberdeck.id}-${program.id}`,
        name: `${program.name} (${cyberdeck.name})`,
        type: "netrunning",
        netAction: "program",
        cyberdeck,
        program,
      });
    }
  }
  return options;
}

function getCyberdecks(actor) {
  const typedCyberdecks = getCollectionValues(actor?.itemTypes?.cyberdeck);
  if (typedCyberdecks.length > 0) return typedCyberdecks;
  return getCollectionValues(actor?.items).filter((item) => item.type === "cyberdeck");
}

function getActorPrograms(actor) {
  const typedPrograms = getCollectionValues(actor?.itemTypes?.program);
  if (typedPrograms.length > 0) return typedPrograms;
  return getCollectionValues(actor?.items).filter((item) => item.type === "program");
}

function getInstalledItemIds(cyberdeck) {
  return new Set(
    getCollectionValues(cyberdeck?.system?.installedItems?.list)
      .map((entry) => typeof entry === "string" ? entry : getItemId(entry))
      .filter(Boolean),
  );
}

function getInstalledPrograms(cyberdeck, actor = cyberdeck?.actor) {
  if (!cyberdeck) return [];
  const installedIds = getInstalledItemIds(cyberdeck);
  if (installedIds.size > 0 && actor) {
    const actorPrograms = getActorPrograms(actor)
      .filter((program) => installedIds.has(getItemId(program)));
    if (actorPrograms.length > 0) return actorPrograms;
  }

  const installedPrograms = getCollectionValues(cyberdeck.system?.installedPrograms);
  if (installedPrograms.length > 0) return installedPrograms;

  if (typeof cyberdeck.getInstalledItems === "function") {
    const installedItems = getCollectionValues(cyberdeck.getInstalledItems("program"));
    if (installedItems.length > 0) return installedItems;
  }

  return getCollectionValues(cyberdeck.system?.installedItems?.list)
    .map((itemId) => getOwnedItem(actor, itemId))
    .filter((item) => item?.type === "program");
}

function getRezzedPrograms(cyberdeck, actor = cyberdeck?.actor) {
  if (!cyberdeck) return [];
  const rezzedPrograms = getCollectionValues(cyberdeck.system?.rezzedPrograms);
  if (rezzedPrograms.length > 0) return rezzedPrograms;
  return getInstalledPrograms(cyberdeck, actor).filter((program) => program.system?.isRezzed === true);
}

function getRezzedProgramOptions(actor) {
  const options = [];
  const seen = new Set();
  const actorPrograms = getActorPrograms(actor);
  for (const cyberdeck of getCyberdecks(actor)) {
    const installedIds = getInstalledItemIds(cyberdeck);
    const programs = installedIds.size > 0
      ? actorPrograms.filter((program) => installedIds.has(getItemId(program)))
      : getRezzedPrograms(cyberdeck, actor);

    for (const program of programs) {
      const programId = getItemId(program);
      if (!programId || seen.has(programId) || program.system?.isRezzed !== true) continue;
      seen.add(programId);
      options.push({
        id: programId,
        name: program.name,
        uuid: program.uuid ?? "",
        cyberdeckId: getItemId(cyberdeck),
        cyberdeckName: cyberdeck.name,
        program,
        cyberdeck,
      });
    }
  }
  return options;
}

function isNetrunnerActor(actor) {
  if (!actor || ["blackIce", "demon"].includes(actor.type)) return false;
  if (getCyberdecks(actor).length > 0) return true;
  const roles = actor.itemTypes?.role ?? getCollectionValues(actor.items).filter((item) => item.type === "role");
  return roles.some((role) => role.system?.mainRoleAbility?.toLocaleLowerCase?.() === "interface");
}

function isAntiProgramAttack(actor, option) {
  if (!isNetrunningAttack(option)) return false;
  if (option.netAction === "blackice") return actor?.system?.class === "antiprogram";
  return option.netAction === "program"
    && option.program?.system?.class === "antiprogramattacker";
}

function getProgramTargetPromptData(targets) {
  return targets
    .filter((target) => isNetrunnerActor(target.actor))
    .map((target) => {
      const programs = getRezzedProgramOptions(target.actor);
      return {
        targetTokenId: target.document.id,
        targetName: target.name,
        hasPrograms: programs.length > 0,
        programs: programs.map((entry, index) => ({
          value: entry.id,
          label: entry.cyberdeckName ? `${entry.name} (${entry.cyberdeckName})` : entry.name,
          selected: index === 0,
        })),
      };
    });
}

function findRezzedProgramOption(actor, selection) {
  const selectedId = typeof selection === "object"
    ? getItemId(selection.program ?? selection)
    : String(selection ?? "");
  return getRezzedProgramOptions(actor)
    .find((entry) => [entry.id, entry.uuid].includes(selectedId)) ?? null;
}

function isNetrunningAttackerProgram(program) {
  return program?.type === "program" && NETRUNNING_ATTACKER_PROGRAM_CLASSES.has(program.system?.class);
}

function isNetrunningAttack(option) {
  return option?.type === "netrunning";
}

function findWeaponBySelection(weapons, selection) {
  const index = Number(selection);
  if (Number.isInteger(index) && index >= 0 && index < weapons.length) return weapons[index];

  const id = String(selection ?? "");
  return weapons.find((weapon) => [weapon.id, weapon._id].includes(id)) ?? null;
}

function getSelectedWeaponId(html) {
  const value = html.find("[name='weaponId']").val();
  return Array.isArray(value) ? value[0] : value;
}

function getItemId(item) {
  return item?.id ?? item?._id ?? "";
}

function formatTargetList(targets) {
  if (targets.length === 1) return targets[0].name;
  return targets.map((target) => target.name).join(", ");
}

async function buildWeaponView(weapon, attacker, target, { targetProgram = null } = {}) {
  if (isNetrunningAttack(weapon)) {
    return buildNetrunningAttackView(weapon, attacker, target, targetProgram);
  }

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

function buildNetrunningAttackView(option, _attacker, target, targetProgram = null) {
  const targetDefenseLabel = getNetrunningDefenseLabel(target?.actor, targetProgram);
  return {
    damage: getNetrunningDamageLabel(
      option,
      target?.actor,
      targetProgram?.program?.system?.class,
    ),
    skill: getNetrunningAttackSkillLabel(option),
    tableName: "Netrunning opposed defense",
    distance: null,
    dv: null,
    dvLabel: targetDefenseLabel,
    bandLabel: "-",
    distanceLabel: "-",
    reason: "",
  };
}

function getNetrunningAttackSkillLabel(option) {
  return option?.netAction === "blackice" ? "Atk" : "Interface";
}

function getSelectedTargetPrograms(html) {
  const selections = new Map();
  html.find("[data-cpr-af-target-program]").each((_index, element) => {
    if (element.disabled || !element.value) return;
    selections.set(element.dataset.cprAfTargetToken, element.value);
  });
  return selections;
}

function syncProgramTargetControls(html, actor, weapon, programTargets) {
  const required = isAntiProgramAttack(actor, weapon);
  const section = html.find("[data-cpr-af-program-targets]");
  section.prop("hidden", !required);
  section.find("[data-cpr-af-target-program]").each((_index, element) => {
    const hasPrograms = element.dataset.cprAfHasPrograms === "true";
    element.disabled = !required || !hasPrograms;
  });

  const missingProgram = required && programTargets.some((target) => !target.hasPrograms);
  html.closest(".app").find("[data-button='create']").prop("disabled", missingProgram);
}

function getAttackActionLabel(actor, option) {
  if (isNetrunningAttack(option)) {
    if (option.netAction === "zap") {
      return localizeSystemLabel("CPR.global.role.netrunner.interfaceAbility.zap", "Zap");
    }
    return localizeSystemLabel("CPR.rolls.attack", "Attack");
  }

  const fireMode = getNativeRollType(actor, option, "attack");
  const fireModeLabels = {
    aimed: ["CPR.rolls.aimedShot", "Aimed Shot"],
    autofire: ["CPR.global.itemType.skill.autofire", "Autofire"],
    suppressive: ["CPR.rolls.suppressiveFire", "Suppressive Fire"],
  };
  if (fireModeLabels[fireMode]) {
    return localizeSystemLabel(...fireModeLabels[fireMode]);
  }

  if (option.system?.weaponType === "thrownWeapon") {
    return localizeSystemLabel("CPR.effectSheet.combat.stats.ranged", "Ranged Attack");
  }
  if (!option.system?.isRanged) {
    return localizeSystemLabel("CPR.effectSheet.combat.stats.melee", "Melee Attack");
  }
  return localizeSystemLabel("CPR.effectSheet.combat.stats.singleShot", "Single Shot");
}

function localizeSystemLabel(key, fallback) {
  const localized = game.i18n?.localize?.(key);
  return localized && localized !== key ? localized : fallback;
}

function getNetrunningDefenseLabel(actor, targetProgram = null) {
  if (targetProgram?.name) return `${targetProgram.name} DEF`;
  if (actor?.type === "blackIce") return "Black ICE DEF";
  if (actor?.type === "demon") return "Interface";
  return "Interface Defense";
}

function getNetrunningDamageLabel(option, targetActor = null, targetProgramClass = "") {
  if (option?.netAction === "zap") return "1d6";
  if (option?.netAction === "blackice") return "Program damage";
  const damage = getProgramDamageFormula(option?.program, targetActor, targetProgramClass);
  return damage || "-";
}

function getProgramDamageFormula(program, targetActor = null, targetProgramClass = "") {
  if (!program) return "";
  if (targetActor?.type === "blackIce" || targetProgramClass === "blackice") {
    return program.system?.damage?.blackIce || program.system?.damage?.standard || "";
  }
  return program.system?.damage?.standard || program.system?.damage?.blackIce || "";
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

async function createAttackCards(attacker, targets, weapon, {
  dispatchPrompts = true,
  targetPrograms = new Map(),
} = {}) {
  if (!weapon) {
    ui.notifications.warn("Selected weapon was not found on the attacker.");
    return [];
  }

  const isSuppressive = isSuppressiveFire(attacker.actor, weapon);
  const isNetAttack = isNetrunningAttack(weapon);
  const attacks = [];
  const declarations = await prepareAttackDeclarations(attacker, targets, weapon, {
    skipDefenderPrompt: isSuppressive || isNetAttack,
    targetPrograms,
  });
  if (declarations.length === 0) return [];

  const message = await createAttackDeclarationMessage(attacker, declarations);
  for (const data of declarations) {
    data.chatMessageId = message.id;
    rememberAttackDeclaration(data);
    attacks.push(data);
    if (dispatchPrompts && !isSuppressive && !isNetAttack) await dispatchDefenderPrompt(data);
  }

  await message.update({
    [`flags.${MODULE_ID}.attackDeclarations`]: declarations,
  });

  if (dispatchPrompts && isSuppressive) {
    await startSuppressiveFireResolution(attacks);
  }
  if (dispatchPrompts && isNetAttack) {
    await startNetrunningAttackResolution(attacks);
  }
  return attacks;
}

async function prepareAttackDeclarations(attacker, targets, weapon, {
  skipDefenderPrompt = false,
  targetPrograms = new Map(),
} = {}) {
  const groupAttackId = foundry.utils.randomID();
  const groupTargetIds = targets.map((target) => target.document.id);
  const declarations = [];
  const selections = normalizeTargetProgramSelections(targetPrograms);
  const requiresProgramTarget = isAntiProgramAttack(attacker.actor, weapon);

  for (const [index, target] of targets.entries()) {
    let targetProgram = null;
    if (requiresProgramTarget && isNetrunnerActor(target.actor)) {
      targetProgram = findRezzedProgramOption(
        target.actor,
        selections.get(target.document.id) ?? selections.get(target.actor.id),
      );
      if (!targetProgram) {
        ui.notifications.warn(`${target.name} has no valid rezzed program selected.`);
        return [];
      }
    }

    declarations.push(await buildAttackDeclaration(attacker, target, weapon, {
      groupAttackId,
      groupTargetIds,
      groupIndex: index,
      groupTotalTargets: targets.length,
    }, { skipDefenderPrompt, targetProgram }));
  }

  return declarations;
}

async function buildAttackDeclaration(attacker, target, weapon, group, {
  skipDefenderPrompt = false,
  targetProgram = null,
} = {}) {
  const view = await buildWeaponView(weapon, attacker, target, { targetProgram });
  if (!view.dv && !isNetrunningAttack(weapon)) {
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
    declaringUserId: game.user.id,
    targetSceneId: canvas.scene.id,
    targetTokenId: target.document.id,
    targetActorId: target.actor.id,
    targetBaseActorId: target.document.actorId,
    targetName: target.name,
    targetDisplayName: targetProgram ? `${target.name}: ${targetProgram.name}` : target.name,
    targetProgramId: targetProgram?.id ?? "",
    targetProgramUuid: targetProgram?.uuid ?? "",
    targetProgramName: targetProgram?.name ?? "",
    targetProgramClass: targetProgram?.program?.system?.class ?? "",
    targetCyberdeckId: targetProgram?.cyberdeckId ?? "",
    weaponId: getItemId(weapon),
    weaponName: weapon.program?.name ?? (weapon.netAction === "zap" ? "Zap" : weapon.name),
    weaponTypeLabel: getWeaponTypeLabel(weapon),
    attackKind: isNetrunningAttack(weapon) ? "netrunning" : "weapon",
    netAction: weapon.netAction ?? "",
    cyberdeckId: weapon.cyberdeck?.id ?? "",
    programId: weapon.program?.id ?? "",
    programUuid: weapon.program?.uuid ?? "",
    damage: view.damage,
    skill: view.skill,
    action: getAttackActionLabel(attacker.actor, weapon),
    distance: view.distance,
    distanceLabel: view.distanceLabel ?? formatDistance(view.distance),
    dv: view.dv ?? "",
    dvLabel: view.dvLabel ?? view.dv ?? "-",
    tableName: view.tableName,
    bandLabel: view.bandLabel,
    reason: view.reason,
    skipDefenderPrompt,
  };

  return data;
}

async function createAttackDeclarationMessage(attacker, declarations) {
  const content = await renderAttackFlowContent(declarations, {});
  const message = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content,
    flags: {
      [MODULE_ID]: {
        attackDeclarations: declarations,
        flowState: {},
      },
    },
  });
  return message;
}

async function renderAttackFlowContent(declarations, state = {}) {
  const rows = (state.rows ?? declarations.map((entry) => ({
    targetName: entry.targetDisplayName || entry.targetName,
    dv: entry.dvLabel,
  })))
    .map((row, index) => ({ ...row, defenseDetailId: `defense-${index}` }));
  const declarationContent = await renderTemplate(TEMPLATES.declaration, {
    declarations,
    isMultiTarget: declarations.length > 1,
    rows,
    resolved: Boolean(state.resolved),
    allMissed: Boolean(state.resolved && !state.hitTargets?.length),
    hitTargets: state.hitTargets ?? [],
    attackDetails: state.attackDetails,
    damageRows: state.damageRows ?? [],
    damageDetails: state.damageDetails,
  });
  return `${declarationContent}${state.damageHtml ? `<div class="cpr-af-damage cpr-af-native-damage-data" aria-hidden="true"><div class="cpr-af-native-rolls">${state.damageHtml}</div></div>` : ""}`;
}

function getRollDetails(roll) {
  if (!roll) return null;
  const initialRoll = Number(roll.initialRoll);
  const criticalRoll = Number(roll.criticalRoll);
  const total = Number(roll.resultTotal);
  const modifierTotal = typeof roll.totalMods === "function" ? Number(roll.totalMods()) : null;
  const components = [];
  const addComponent = (label, value, { includeZero = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number) || (!includeZero && number === 0)) return;
    components.push({ label, value: number, signedValue: number >= 0 ? `+${number}` : String(number) });
  };
  if (Object.hasOwn(roll, "statValue")) addComponent(roll.statName || "Característica", roll.statValue, { includeZero: true });
  if (Object.hasOwn(roll, "skillValue")) addComponent(roll.skillName || "Habilidad", roll.skillValue, { includeZero: true });
  if (Object.hasOwn(roll, "roleValue") && roll.includeInterface !== false) {
    addComponent(roll.roleName || "Interface", roll.roleValue, { includeZero: true });
  }
  addComponent("Suerte", roll.luck);
  for (const mod of roll.mods ?? []) {
    const source = game.i18n?.localize?.(mod.source) ?? mod.source ?? "Modificador";
    addComponent(source, mod.value);
  }
  for (const mod of roll.additionalMods ?? []) addComponent("Modificador adicional", mod);
  if (Number.isFinite(criticalRoll) && criticalRoll !== 0) {
    addComponent(initialRoll === 1 ? "Pifia" : "Crítico", initialRoll === 1 ? -criticalRoll : criticalRoll);
  }
  return {
    initialRoll: Number.isFinite(initialRoll) ? initialRoll : null,
    criticalRoll: Number.isFinite(criticalRoll) && criticalRoll !== 0 ? criticalRoll : null,
    modifierTotal: Number.isFinite(modifierTotal) ? modifierTotal : null,
    total: Number.isFinite(total) ? total : null,
    isCritical: initialRoll === 10,
    isFumble: initialRoll === 1,
    components,
  };
}

function getDamageRollDetails(roll) {
  if (!roll) return null;
  const total = Number(roll.resultTotal);
  const modifierTotal = typeof roll.totalMods === "function" ? Number(roll.totalMods()) : 0;
  const bonusDamage = roll.wasCritical?.() ? Number(roll.bonusDamage ?? 0) : 0;
  return {
    formula: String(roll.formula ?? ""),
    faces: Array.isArray(roll.faces) ? roll.faces.map(Number).filter(Number.isFinite) : [],
    modifierTotal: Number.isFinite(modifierTotal) ? modifierTotal : 0,
    bonusDamage: Number.isFinite(bonusDamage) ? bonusDamage : 0,
    total: Number.isFinite(total) ? total : null,
    isCritical: roll.wasCritical?.() === true,
  };
}

function createOutcomeRows(outcomes, attackRoll, defenseDetails = new Map()) {
  return outcomes.map(({ choice, comparison, hit }) => ({
    targetName: choice.targetDisplayName || choice.targetName,
    dv: choice.dv || "-",
    evasion: comparison.mode === "evasion" ? comparison.target : "-",
    attack: attackRoll.resultTotal,
    dvWins: !hit && comparison.mode === "dv",
    evasionWins: !hit && comparison.mode === "evasion",
    attackWins: hit,
    attackDetails: getRollDetails(attackRoll),
    defenseDetails: defenseDetails.get(choice.attackId) ?? null,
    defenseLabel: comparison.label ?? "Defense",
  }));
}

function createDamageRows(hits, damage) {
  let nativeApplicationIndex = 0;
  return hits.map((hit) => {
    const programDamage = Boolean(hit.targetProgramId);
    const row = {
      targetName: hit.targetDisplayName || hit.targetName,
      damage,
      programDamage,
      targetSceneId: hit.targetSceneId ?? "",
      targetTokenId: hit.targetTokenId ?? "",
      targetActorId: hit.targetActorId ?? "",
      targetProgramId: hit.targetProgramId ?? "",
      targetCyberdeckId: hit.targetCyberdeckId ?? "",
    };
    if (!programDamage) {
      row.nativeApplicationIndex = nativeApplicationIndex;
      nativeApplicationIndex += 1;
    }
    return row;
  });
}

async function updateAttackFlowMessage(data, patch = {}) {
  const message = getAttackFlowMessage(data);
  if (!message) return null;
  const declarations = message.getFlag(MODULE_ID, "attackDeclarations") ?? [data];
  const previous = message.getFlag(MODULE_ID, "flowState") ?? {};
  const state = { ...previous, ...patch };
  await message.update({
    content: await renderAttackFlowContent(declarations, state),
    [`flags.${MODULE_ID}.flowState`]: state,
  });
  return message;
}

function getAttackFlowMessage(data) {
  if (data?.chatMessageId) return game.messages?.get?.(data.chatMessageId) ?? null;
  return getCollectionValues(game.messages).find((message) => {
    const declarations = message.getFlag?.(MODULE_ID, "attackDeclarations") ?? [];
    return declarations.some((entry) => entry.attackId === data?.attackId);
  }) ?? null;
}

async function startSuppressiveFireResolution(attacks) {
  if (attacks.length === 0) return;

  const groupId = attacks[0].groupAttackId ?? attacks[0].attackId;
  const entry = {
    expected: attacks.length,
    choices: new Map(),
    evasions: new Map(),
    skipDamage: true,
  };

  for (const attack of attacks) {
    entry.choices.set(attack.attackId, { ...attack, defenderAction: "concentration" });
  }
  pendingAttackGroups.set(groupId, entry);
  resolvingAttackGroups.add(groupId);

  await collectGroupEvasionsOrResolve(groupId, entry);
}

async function startNetrunningAttackResolution(attacks) {
  if (attacks.length === 0) return;

  const groupId = attacks[0].groupAttackId ?? attacks[0].attackId;
  const entry = {
    expected: attacks.length,
    choices: new Map(),
    evasions: new Map(),
  };

  for (const attack of attacks) {
    entry.choices.set(attack.attackId, { ...attack, defenderAction: "net-defense" });
  }
  pendingAttackGroups.set(groupId, entry);
  resolvingAttackGroups.add(groupId);

  await collectGroupEvasionsOrResolve(groupId, entry);
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
  if (shownPrompts.has(data.attackId) || renderingPrompts.has(data.attackId)) return;
  renderingPrompts.add(data.attackId);

  try {
    const content = await renderTemplate(TEMPLATES.card, data);
    const dialog = new Dialog({
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
          await dialog.close();
          await submitDefenderChoice(data, action);
        });
      },
      close: async () => {
        const key = data.attackId;
        if (processedActions.has(key)) return;
        processedActions.add(key);
        await submitDefenderChoice(data, "no-evade");
      },
    });
    dialog.render(true);
    shownPrompts.add(data.attackId);
    claimPrompt(data.attackId);
  } catch (_error) {
    ui.notifications.error("CPR Combat Automatism could not render the defender prompt.");
  } finally {
    renderingPrompts.delete(data.attackId);
  }
}

function claimPrompt(attackId) {
  if (claimedPrompts.has(attackId)) return;
  claimedPrompts.add(attackId);
  emitSocket({ type: "promptClaimed", attackId, ownerUserId: game.user.id });
}

function shouldSkipDefenderPrompt(data) {
  return Boolean(data?.skipDefenderPrompt);
}

function isNetrunningDeclaration(data) {
  return data?.attackKind === "netrunning";
}

async function dispatchDefenderPrompt(data) {
  if (shouldSkipDefenderPrompt(data)) return;
  const gm = game.users.find((user) => user.isGM && user.active);
  if (game.user.isGM || !gm) {
    await routeDefenderPrompt(data);
  } else {
    emitTo(gm.id, "routePrompt", data);
  }

  emitSocket({ type: "maybeShowPrompt", data });
  await maybeShowDefenderPrompt(data);
}

async function routeDefenderPrompt(data) {
  if (shouldSkipDefenderPrompt(data)) return;
  if (routedPrompts.has(data.attackId)) return;
  routedPrompts.add(data.attackId);

  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const docs = getDefenderOwnershipDocs(data, defender);
  const ownerIds = game.users
    .filter((user) => user.active && !user.isGM && userOwnsAny(user, docs, data, defender?.document))
    .map((user) => user.id);

  if (ownerIds.length > 0) {
    for (const ownerId of ownerIds) emitTo(ownerId, "showPrompt", data);
    return;
  }

  await showDefenderPrompt(data);
}

async function maybeShowDefenderPrompt(data) {
  if (shouldSkipDefenderPrompt(data)) return;
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
  await resolveEvadeChoice({ ...data, defenderAction: "evade" });
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

  if (entry.choices.size < entry.expected || resolvingAttackGroups.has(groupId)) return;

  resolvingAttackGroups.add(groupId);
  await collectGroupEvasionsOrResolve(groupId, entry);
}

async function collectGroupEvasionsOrResolve(groupId, entry) {
  const choices = Array.from(entry.choices.values()).sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
  const contestedDefenders = choices.filter((choice) => CONTESTED_DEFENDER_ACTIONS.has(choice.defenderAction));
  if (contestedDefenders.length === 0) {
    await resolveAttackGroup(groupId, entry);
    return;
  }

  const resolverUserId = game.user.id;
  for (const choice of contestedDefenders) {
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
  const defense = await rollDefenseForData(data);
  const evasionTotal = defense?.total;

  const payload = {
    ...data,
    evasionTotal: Number.isFinite(evasionTotal) ? evasionTotal : null,
    evasionFailed: !Number.isFinite(evasionTotal),
    defenseDetails: defense?.details ?? null,
  };
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
  entry.defenseDetails ??= new Map();
  entry.defenseDetails.set(data.attackId, data.defenseDetails ?? null);
  const contestedDefenders = Array.from(entry.choices.values()).filter((choice) => CONTESTED_DEFENDER_ACTIONS.has(choice.defenderAction));
  if (entry.evasions.size >= contestedDefenders.length) {
    if (entry.resolvingFinal) return;
    entry.resolvingFinal = true;
    await resolveAttackGroup(groupId, entry);
  }
}

async function resolveAttackGroup(groupId, entry) {
  const choices = Array.from(entry.choices.values()).sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
  try {
    const context = await getRollContext(choices[0]);
    if (!context) return;

    if (!isNetrunningDeclaration(choices[0])) markNativeResultSuppressions(choices, context.actor?.name);
    const attackRoll = await rollAttackForData(context, choices[0]);
    if (!attackRoll) return;

    const hits = [];
    const outcomes = [];
    for (const choice of choices) {
      const comparison = getGroupComparison(choice, entry);
      if (!comparison) continue;

      const hit = isAttackHit(attackRoll.resultTotal, comparison.target);
      outcomes.push({ choice, comparison, hit });
      if (hit) {
        hits.push({
          ...choice,
          autofireMultiplier: getAutofireHitMultiplier(context.actor, context.weapon, attackRoll.resultTotal, comparison.target),
        });
      }
    }

    await updateAttackFlowMessage(choices[0], {
      resolved: true,
      rows: createOutcomeRows(outcomes, attackRoll, entry.defenseDetails),
      hitTargets: hits.map((hit) => hit.targetName),
      attackDetails: getRollDetails(attackRoll),
    });

    if (hits.length === 0 || entry.skipDamage) return;

    const damageRoll = await rollDamageForHits(context, hits, attackRoll);
    if (damageRoll) await updateAttackFlowMessage(choices[0], {
      damageHtml: damageRoll.cprAutomatismHtml,
      damageRows: createDamageRows(hits, damageRoll.resultTotal),
      damageDetails: getDamageRollDetails(damageRoll),
    });
  } finally {
    pendingAttackGroups.delete(groupId);
    resolvingAttackGroups.delete(groupId);
  }
}

function formatAttackOutcomeMessage(attacker, targetName, attackTotal, comparison, hit, entry = {}) {
  const attackerName = attacker?.name ?? "Attacker";
  const threshold = Number(comparison?.target);
  const label = comparison?.label ?? (comparison?.mode === "dv" ? "DV" : "Defense");
  const margin = Math.abs(Number(attackTotal) - threshold);
  if (hit) {
    const verb = entry.skipDamage ? "affects" : "hits";
    const damagePrompt = entry.skipDamage ? "" : " Roll Damage!";
    return `${attackerName} ${verb} ${targetName} (${label}: ${threshold}, ${margin} over)!${damagePrompt}`;
  }
  return `${attackerName} missed ${targetName} by ${margin} (${label}: ${threshold}).`;
}

function getGroupComparison(choice, entry) {
  if (CONTESTED_DEFENDER_ACTIONS.has(choice.defenderAction)) {
    const evasionTotal = Number(entry.evasions?.get(choice.attackId));
    if (!Number.isFinite(evasionTotal)) {
      ui.notifications.warn(`No valid ${getDefenseLabel(choice)} total for ${choice.targetName}.`);
      return null;
    }
    return { mode: "evasion", target: evasionTotal, label: getDefenseLabel(choice) };
  }

  const dv = Number(choice.dv);
  if (!Number.isFinite(dv)) {
    ui.notifications.warn(`No valid DV for ${choice.targetName}.`);
    return null;
  }
  return { mode: "dv", target: dv };
}

function isAttackHit(attackTotal, defenseTotal) {
  const attack = Number(attackTotal);
  const defense = Number(defenseTotal);
  return Number.isFinite(attack) && Number.isFinite(defense) && attack > defense;
}

async function resolveEvadeChoice(data) {
  const payload = { ...data, defenderAction: "evade" };
  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const [defenderActor] = getDefenderOwnershipDocs(data, defender);
  if (!game.user.isGM && userOwnsAny(game.user, getDefenderOwnershipDocs(data, defender), data, defender?.document)) {
    await rollEvasionAndContinue(payload);
    return;
  }

  const evasionUser = defenderActor
    ? pickDefenderUser(defenderActor, { tokenDocument: defender?.document, data })
    : null;
  const recipient = evasionUser?.id ?? pickAttackResolver(data);
  if (recipient === game.user.id) {
    await rollEvasionAndContinue(payload);
    return;
  }
  emitTo(recipient, "rollEvasion", payload);
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
  const declaringUser = getUserById(data.declaringUserId);
  if (declaringUser?.active && (declaringUser.isGM || attacker?.testUserPermission(declaringUser, "OWNER"))) {
    return declaringUser.id;
  }
  const activeOwner = attacker
    ? game.users.find((user) => user.active && !user.isGM && attacker.testUserPermission(user, "OWNER"))
    : null;
  return activeOwner?.id ?? game.users.find((user) => user.isGM && user.active)?.id ?? game.user.id;
}

async function resolveNoEvade(data) {
  const context = await getRollContext(data);
  if (!context) return;
  if (!isNetrunningDeclaration(data)) markNativeResultSuppressions([data], context.actor?.name);
  const attackRoll = await rollAttackForData(context, data);
  if (!attackRoll) return;

  const dv = Number(data.dv);
  if (!Number.isFinite(dv)) {
    ui.notifications.warn("Attack was rolled, but no valid DV was available for comparison.");
    return;
  }

  const comparison = { mode: "dv", target: dv, label: "DV" };
  const hit = isAttackHit(attackRoll.resultTotal, dv);
  await updateAttackFlowMessage(data, {
    resolved: true,
    rows: createOutcomeRows([{ choice: data, comparison, hit }], attackRoll),
    hitTargets: hit ? [data.targetName] : [],
    attackDetails: getRollDetails(attackRoll),
  });
  if (hit) {
    const damageRoll = await rollDamageForHits(context, [{
      ...data,
      autofireMultiplier: getAutofireHitMultiplier(context.actor, context.weapon, attackRoll.resultTotal, dv),
    }], attackRoll);
    if (damageRoll) await updateAttackFlowMessage(data, {
      damageHtml: damageRoll.cprAutomatismHtml,
      damageRows: createDamageRows([data], damageRoll.resultTotal),
      damageDetails: getDamageRollDetails(damageRoll),
    });
  }
}

async function rollEvasionAndContinue(data) {
  const defendedData = { ...data, defenderAction: data.defenderAction ?? "evade" };
  const defense = await rollDefenseForData(defendedData);
  const evasionTotal = defense?.total;
  if (!Number.isFinite(evasionTotal)) return;

  const resolver = pickAttackResolver(defendedData);
  const payload = { ...defendedData, evasionTotal, defenseDetails: defense?.details ?? null };
  if (resolver === game.user.id) {
    await resolveAgainstEvasion(payload);
    return;
  }
  emitTo(resolver, "resolveAgainstEvasion", payload);
}

async function rollDefenseForData(data) {
  const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
  const actor = defender?.actor ?? getActorById(data.targetBaseActorId) ?? getActorById(data.targetActorId);
  const defenseLabel = getDefenseLabel(data);
  if (!actor) {
    ui.notifications.warn(`Could not find the defender actor for ${defenseLabel}.`);
    return null;
  }

  if (data.defenderAction === "net-defense") {
    const defenseRoll = await rollNetrunningDefense(actor, defender, data);
    return defenseRoll ? { total: defenseRoll.resultTotal, details: getRollDetails(defenseRoll) } : null;
  }

  const defenseSkill = findDefenseSkill(actor, data);
  if (!defenseSkill) {
    ui.notifications.warn(`${actor.name} has no ${defenseLabel} skill item.`);
    return null;
  }

  const defenseRoll = await rollNative(actor, defenseSkill, "skill");
  return defenseRoll ? { total: defenseRoll.resultTotal, details: getRollDetails(defenseRoll) } : null;
}

async function rollNetrunningDefense(actor, defender, data) {
  if (data.targetProgramId) {
    return rollSelectedProgramDefense(actor, data);
  }
  if (actor.type === "blackIce") return rollProgramStat(actor, defender, "def");
  if (actor.type === "demon" && typeof actor.createStatRoll === "function") {
    return rollProgramStat(actor, defender, "interface");
  }

  const cyberdeck = findCyberdeckForNetrunningDefense(actor);
  const netRoleItem = getActiveNetRoleItem(actor);
  if (!cyberdeck || !netRoleItem) {
    return rollBaseNetrunningDefense(actor);
  }

  const cprRoll = cyberdeck.createRoll("interfaceAbility", actor, {
    cyberdeck,
    cyberdeckId: cyberdeck.id,
    interfaceAbility: "defense",
    netRoleItem,
  });
  return finalizeNativeRoll(cprRoll, actor, cyberdeck, {
    tokens: [],
    itemId: cyberdeck.id,
  });
}

async function rollSelectedProgramDefense(actor, data) {
  const selection = findRezzedProgramOption(actor, data.targetProgramId);
  if (!selection || (data.targetCyberdeckId && selection.cyberdeckId !== data.targetCyberdeckId)) {
    ui.notifications.warn(`Could not find the selected rezzed program for ${data.targetName}.`);
    return null;
  }

  const netRoleItem = getActiveNetRoleItem(actor) ?? {
    system: {
      mainRoleAbility: "Interface",
      rank: 0,
    },
  };
  const cprRoll = selection.cyberdeck.createRoll("cyberdeckProgram", actor, {
    cyberdeckId: selection.cyberdeckId,
    programId: selection.id,
    executionType: "def",
    netRoleItem,
  });
  if (!cprRoll) {
    ui.notifications.warn(`Could not create native DEF roll for ${selection.name}.`);
    return null;
  }
  return finalizeNativeRoll(cprRoll, actor, selection.cyberdeck, {
    tokens: [],
    itemId: selection.id,
  });
}

async function rollBaseNetrunningDefense(actor) {
  const cprRoll = createBaseNetrunningDefenseRoll();
  if (!cprRoll) return null;
  return finalizeNativeRoll(cprRoll, actor, null, {
    tokens: [],
    itemId: "",
  });
}

function createBaseNetrunningDefenseRoll() {
  if (!CPRInterfaceRollClass) {
    ui.notifications.error("CPR Combat Automatism native roll adapter is not available.");
    return null;
  }
  const config = getBaseNetrunningDefenseRollConfig();
  const cprRoll = new CPRInterfaceRollClass(config.rollType, config.roleName, config.roleValue);
  cprRoll.rollTitle = config.rollTitle;
  cprRoll.ability = config.ability;
  return cprRoll;
}

function getBaseNetrunningDefenseRollConfig() {
  return {
    rollType: "defense",
    roleName: "Interface",
    roleValue: 0,
    rollTitle: "Netrunning Defense",
    ability: "defense",
  };
}

function usesBaseNetrunningDefense(actor) {
  if (actor?.type === "blackIce") return false;
  if (actor?.type === "demon" && typeof actor.createStatRoll === "function") return false;
  return !findCyberdeckForNetrunningDefense(actor) || !getActiveNetRoleItem(actor);
}

async function rollProgramStat(actor, defender, statName) {
  const cprRoll = actor.createStatRoll(statName);
  return finalizeNativeRoll(cprRoll, actor, null, {
    tokens: [],
    itemId: defender?.document?.id ?? defender?.id ?? "",
  });
}

async function resolveAgainstEvasion(data) {
  const defendedData = { ...data, defenderAction: data.defenderAction ?? "evade" };
  const context = await getRollContext(defendedData);
  if (!context) return;
  if (!isNetrunningDeclaration(defendedData)) markNativeResultSuppressions([defendedData], context.actor?.name);
  const attackRoll = await rollAttackForData(context, defendedData);
  if (!attackRoll) return;

  const evasionTotal = Number(data.evasionTotal);
  const comparison = { mode: "evasion", target: evasionTotal, label: getDefenseLabel(defendedData) };
  const hit = isAttackHit(attackRoll.resultTotal, evasionTotal);
  await updateAttackFlowMessage(defendedData, {
    resolved: true,
    rows: createOutcomeRows(
      [{ choice: defendedData, comparison, hit }],
      attackRoll,
      new Map([[defendedData.attackId, defendedData.defenseDetails]]),
    ),
    hitTargets: hit ? [defendedData.targetName] : [],
    attackDetails: getRollDetails(attackRoll),
  });
  if (hit) {
    const damageRoll = await rollDamageForHits(context, [{
      ...defendedData,
      autofireMultiplier: getAutofireHitMultiplier(context.actor, context.weapon, attackRoll.resultTotal, evasionTotal),
    }], attackRoll);
    if (damageRoll) await updateAttackFlowMessage(defendedData, {
      damageHtml: damageRoll.cprAutomatismHtml,
      damageRows: createDamageRows([defendedData], damageRoll.resultTotal),
      damageDetails: getDamageRollDetails(damageRoll),
    });
  }
}

async function rollAttackForData(context, data) {
  if (isNetrunningDeclaration(data)) return rollNetrunningAttack(context, data);
  return rollNative(context.actor, context.weapon, "attack");
}

async function rollDamageForHits(context, hits, attackRoll) {
  if (isNetrunningDeclaration(hits[0])) return rollNetrunningDamage(context, hits);
  return rollNative(context.actor, context.weapon, "damage", {
    tokens: await getDamageTokensForHits(hits),
    autofireMultiplier: getHighestAutofireMultiplier(hits),
    aimedLocation: getAimedDamageLocation(context.actor, context.weapon, attackRoll),
  });
}

async function rollNetrunningAttack(context, data) {
  const cprRoll = createNetrunningAttackRoll(context, data);
  if (!cprRoll) return null;
  return finalizeNativeRoll(cprRoll, context.actor, context.rollItem ?? context.weapon, {
    tokens: [],
    itemId: context.rollItem?.id ?? context.weapon?.id ?? data.weaponId,
  });
}

function createNetrunningAttackRoll(context, data) {
  if (data.netAction === "blackice") {
    if (typeof context.actor?.createStatRoll !== "function") {
      ui.notifications.warn("Black ICE attacker cannot create a native ATK roll.");
      return null;
    }
    return context.actor.createStatRoll("atk");
  }

  if (!context.cyberdeck) {
    ui.notifications.warn("Could not resolve cyberdeck for netrunning attack.");
    return null;
  }

  const netRoleItem = getActiveNetRoleItem(context.actor);
  if (!netRoleItem) {
    ui.notifications.warn(`${context.actor.name} has no active Netrunner role configured.`);
    return null;
  }

  if (data.netAction === "zap") {
    return context.cyberdeck.createRoll("interfaceAbility", context.actor, {
      cyberdeck: context.cyberdeck,
      cyberdeckId: context.cyberdeck.id,
      interfaceAbility: "zap",
      netRoleItem,
    });
  }

  return context.cyberdeck.createRoll("cyberdeckProgram", context.actor, {
    cyberdeckId: context.cyberdeck.id,
    programId: data.programId,
    executionType: "atk",
    netRoleItem,
  });
}

async function rollNetrunningDamage(context, hits) {
  const hit = hits[0];
  const cprRoll = await createNetrunningDamageRoll(context, hit);
  if (!cprRoll) return null;
  const tokenHits = hits.filter((entry) => !entry.targetProgramId);
  return finalizeNativeRoll(cprRoll, context.actor, context.rollItem ?? context.weapon, {
    tokens: await getDamageTokensForHits(tokenHits),
    itemId: context.rollItem?.id ?? context.weapon?.id ?? hit.weaponId,
  });
}

async function createNetrunningDamageRoll(context, hit) {
  if (hit.netAction === "blackice") {
    if (typeof context.actor?.createDamageRoll !== "function") {
      ui.notifications.warn("Black ICE attacker cannot create a native damage roll.");
      return null;
    }
    const flags = getSystemFlags(context.token?.document ?? context.token ?? context.actor?.token);
    return context.actor.createDamageRoll(flags.programUUID, flags.netrunnerTokenId, flags.sceneId);
  }

  const netRoleItem = getActiveNetRoleItem(context.actor);
  if (!context.cyberdeck || !netRoleItem) {
    ui.notifications.warn("Could not resolve native netrunning damage roll data.");
    return null;
  }

  if (hit.netAction === "zap") {
    return context.cyberdeck.createRoll("interfaceAbility", context.actor, {
      cyberdeckId: context.cyberdeck.id,
      interfaceAbility: "zap",
      programId: "zap",
      executionType: "damage",
      netRoleItem,
    });
  }

  const cprRoll = context.cyberdeck.createRoll("cyberdeckProgram", context.actor, {
    cyberdeckId: context.cyberdeck.id,
    programId: hit.programId,
    executionType: "damage",
    netRoleItem,
  });
  if (cprRoll) {
    const targetIsBlackIce = await shouldUseBlackIceDamageRoll(hit);
    cprRoll.formula = getProgramDamageFormula(
      context.program,
      targetIsBlackIce ? { type: "blackIce" } : null,
      hit.targetProgramClass,
    );
  }
  return cprRoll;
}

async function shouldUseBlackIceDamageRoll(hit) {
  const target = await resolveToken(hit.targetSceneId, hit.targetTokenId, hit.targetActorId);
  return target?.actor?.type === "blackIce";
}

async function rollNative(actor, item, rollType, { tokens = [], autofireMultiplier = null, aimedLocation = null } = {}) {
  if (!CPRChatClass) {
    ui.notifications.error("CPR Combat Automatism native roll adapter is not available.");
    return null;
  }

  const extraData = {};
  const savedFireType = getSavedFireType(actor, item);
  const nativeRollType = getNativeRollType(actor, item, rollType);
  if (rollType === "damage" && savedFireType) extraData.damageType = savedFireType;

  let cprRoll = item.createRoll(nativeRollType, actor, extraData);
  if (!cprRoll) {
    ui.notifications.warn(`Could not create native ${nativeRollType} roll for ${item.name}.`);
    return null;
  }
  if (rollType === "damage") applyAutofireMultiplier(cprRoll, autofireMultiplier);
  if (rollType === "damage") applyAimedLocation(cprRoll, aimedLocation ?? getSavedAimedLocation(actor));

  const keepRolling = await cprRoll.handleRollDialog({ ctrlKey: false, type: MODULE_ID }, actor, item);
  if (!keepRolling) return null;

  cprRoll = await item.confirmRoll(cprRoll);
  await renderFinalizedNativeRoll(cprRoll, actor, {
    itemId: item.id,
    tokens: rollType === "damage" ? tokens : [],
  });
  if (nativeRollType === "aimed" && cprRoll.location) {
    await actor.setFlag(game.system.id, "aimedLocation", cprRoll.location);
  }
  return cprRoll;
}

async function finalizeNativeRoll(cprRoll, actor, item = null, { tokens = [], itemId = null } = {}) {
  if (!cprRoll) return null;
  const keepRolling = await cprRoll.handleRollDialog({ ctrlKey: false, type: MODULE_ID }, actor, item);
  if (!keepRolling) return null;

  const confirmedRoll = typeof item?.confirmRoll === "function"
    ? await item.confirmRoll(cprRoll)
    : cprRoll;
  await renderFinalizedNativeRoll(confirmedRoll, actor, {
    itemId: itemId ?? item?.id ?? "",
    tokens,
  });
  return confirmedRoll;
}

async function renderFinalizedNativeRoll(cprRoll, actor, { itemId = "", tokens = [] } = {}) {
  await cprRoll.roll();
  cprRoll.entityData = ChatMessage.getSpeaker({ actor });
  cprRoll.entityData.item = itemId;
  cprRoll.entityData.tokens = tokens;
  cprRoll.criticalCard = cprRoll.wasCritical();
  cprRoll.cprAutomatismHtml = await renderTemplate(cprRoll.rollCard, cprRoll);
}

function getNativeRollType(actor, item, rollType) {
  if (rollType !== "attack") return rollType;
  const savedFireType = getSavedFireType(actor, item);
  return FIRE_MODE_ROLL_TYPES.has(savedFireType) ? savedFireType : rollType;
}

function isSuppressiveFire(actor, item) {
  return getNativeRollType(actor, item, "attack") === "suppressive";
}

function getSavedFireType(actor, item) {
  const itemIds = [item?.id, item?._id].filter(Boolean);
  for (const itemId of itemIds) {
    const fireType = actor?.getFlag?.(game.system.id, `firetype-${itemId}`);
    if (fireType) return fireType;
  }
  return null;
}

function getAutofireHitMultiplier(actor, item, attackTotal, targetTotal) {
  if (getNativeRollType(actor, item, "attack") !== "autofire") return null;

  const margin = Number(attackTotal) - Number(targetTotal);
  if (!Number.isFinite(margin)) return null;

  const max = getWeaponAutofireMax(item);
  return clampAutofireMultiplier(margin, max);
}

function getWeaponAutofireMax(item) {
  const weaponMax = Number(item?.system?.fireModes?.autoFire);
  if (Number.isFinite(weaponMax) && weaponMax > 0) return weaponMax;
  if (item?.system?.weaponType === "assaultRifle") return 4;
  if (["smg", "heavySmg"].includes(item?.system?.weaponType)) return 3;
  return 0;
}

function clampAutofireMultiplier(multiplier, max) {
  const value = Math.max(1, Math.floor(Number(multiplier)));
  const limit = Math.floor(Number(max));
  return Number.isFinite(limit) && limit > 0 ? Math.min(value, limit) : value;
}

function getHighestAutofireMultiplier(hits) {
  const multipliers = hits
    .map((hit) => Number(hit.autofireMultiplier))
    .filter(Number.isFinite);
  return multipliers.length > 0 ? Math.max(...multipliers) : null;
}

function applyAutofireMultiplier(cprRoll, multiplier) {
  if (!Number.isFinite(Number(multiplier)) || !cprRoll?.isAutofire) return;
  const configuredMax = Number(cprRoll.autofireMultiplierMax);
  const max = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : Number(multiplier);
  const safeMultiplier = clampAutofireMultiplier(multiplier, max);

  if (typeof cprRoll.configureAutofire === "function") {
    cprRoll.configureAutofire(safeMultiplier, max);
    return;
  }

  cprRoll.autofireMultiplier = safeMultiplier;
}

function getAimedDamageLocation(actor, item, attackRoll) {
  if (getNativeRollType(actor, item, "attack") !== "aimed") return null;
  return normalizeAimedLocation(attackRoll?.location) ?? getSavedAimedLocation(actor);
}

function getSavedAimedLocation(actor) {
  return normalizeAimedLocation(actor.getFlag?.(game.system.id, "aimedLocation"));
}

function normalizeAimedLocation(location) {
  return AIMED_LOCATIONS.has(location) ? location : null;
}

function applyAimedLocation(cprRoll, location) {
  const safeLocation = normalizeAimedLocation(location);
  if (!safeLocation || !cprRoll?.isAimed) return;
  cprRoll.location = safeLocation;
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
  if (isNetrunningDeclaration(data)) return getNetrunningRollContext(data, actor, token);

  const weapon = getOwnedItem(actor, data.weaponId);
  if (!actor || !weapon) {
    ui.notifications.warn("Could not resolve attacker or weapon for CPR Combat Automatism.");
    return null;
  }
  return { actor, weapon, token };
}

function getNetrunningRollContext(data, actor, token) {
  if (!actor) {
    ui.notifications.warn("Could not resolve netrunning attacker for CPR Combat Automatism.");
    return null;
  }

  if (data.netAction === "blackice") {
    return { actor, weapon: null, rollItem: null, token };
  }

  const cyberdeck = getOwnedItem(actor, data.cyberdeckId) ?? findCyberdeckForNetrunningDefense(actor);
  const program = data.programId ? getNetrunningProgramById(actor, cyberdeck, data.programId) : null;
  if (!cyberdeck) {
    ui.notifications.warn("Could not resolve cyberdeck for CPR Combat Automatism.");
    return null;
  }
  if (data.netAction === "program" && !program) {
    ui.notifications.warn("Could not resolve netrunning program for CPR Combat Automatism.");
    return null;
  }
  return {
    actor,
    weapon: program ?? cyberdeck,
    rollItem: cyberdeck,
    cyberdeck,
    program,
    token,
  };
}

function getNetrunningProgramById(actor, cyberdeck, programId) {
  return getOwnedItem(actor, programId)
    ?? getInstalledPrograms(cyberdeck).find((program) => [program.id, program._id, program.uuid].includes(programId))
    ?? null;
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
  return game.actors.get(actorId) ?? Object.values(game.actors.tokens ?? {}).find((actor) => actor.id === actorId);
}

function getOwnedItem(actor, itemId) {
  if (!actor || !itemId) return null;
  return actor.getOwnedItem?.(itemId)
    ?? actor.items?.get?.(itemId)
    ?? getCollectionValues(actor.items).find((item) => [item.id, item._id, item.uuid].includes(itemId))
    ?? null;
}

function getActiveNetRoleItem(actor) {
  const activeRoleId = actor?.system?.roleInfo?.activeNetRole;
  const roles = actor?.itemTypes?.role ?? getCollectionValues(actor?.items).filter((item) => item.type === "role");
  return roles.find((role) => role.id === activeRoleId || role._id === activeRoleId)
    ?? roles.find((role) => role.system?.mainRoleAbility?.toLocaleLowerCase?.() === "interface")
    ?? null;
}

function findCyberdeckForNetrunningDefense(actor) {
  return getCyberdecks(actor).find((cyberdeck) => cyberdeck.system?.equipped !== "carried")
    ?? getCyberdecks(actor)[0]
    ?? null;
}

function getSystemFlags(document) {
  return document?.flags?.[game.system.id] ?? document?.getFlag?.(game.system.id) ?? {};
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

function findDefenseSkill(actor, data) {
  const expectedNames = getDefenseSkillNames(data).map((name) => normalizeSkillName(name));
  return getCollectionValues(actor.items).find((item) => {
    if (item.type !== "skill") return false;
    return expectedNames.includes(normalizeSkillName(item.name));
  });
}

function getDefenseSkillNames(data) {
  if (data?.defenderAction === "concentration") return ["concentration", "concentracion"];
  return ["evasion"];
}

function getDefenseLabel(data) {
  if (data?.defenderAction === "net-defense") {
    return data.targetProgramName ? `${data.targetProgramName} DEF` : "Netrunning Defense";
  }
  return data?.defenderAction === "concentration" ? "Concentration" : "Evasion";
}

function normalizeSkillName(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function calculateDv(weapon, attacker, target) {
  const distance = measureDistance(attacker, target);
  const baseTableName = getBaseDvTableName(weapon);
  const tableName = getActiveDvTableName(weapon, attacker?.actor, baseTableName);
  if (!tableName) {
    return { distance, reason: "Weapon has no DV table." };
  }

  const staticDv = getStaticDv(tableName);
  if (staticDv !== null) {
    return {
      dv: staticDv,
      distance,
      tableName,
      bandLabel: "Fixed DV",
      reason: "",
    };
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

function getActiveDvTableName(weapon, actor, tableName) {
  if (!tableName) return "";
  if (getSavedFireType(actor, weapon) !== "autofire") return tableName;
  return tableName.includes("(Autofire)") ? tableName : `${tableName} (Autofire)`;
}

function getStaticDv(tableName) {
  return STATIC_DV_TABLES.get(normalizeTableName(tableName)) ?? null;
}

function getBaseDvTableName(weapon) {
  const configuredTable = weapon.system?.dvTable || "";
  const inferredTable = inferDvTableName(weapon);
  if (!configuredTable) return inferredTable;
  if (!inferredTable) return configuredTable;
  if (isStandardDvTable(configuredTable)) return inferredTable;
  return configuredTable;
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
  const ammoVariety = getWeaponAmmoVariety(weapon);
  const weaponTypeTable = getWeaponTypeDvTableName(weapon?.system?.weaponType, ammoVariety);
  if (weaponTypeTable) return weaponTypeTable;

  const source = `${weapon.name} ${weapon.system?.weaponType ?? ""} ${weapon.system?.ammoVariety ?? ""} ${ammoVariety}`;
  const value = normalizeTableName(source);
  if (value.includes("shotgun")) return getShotgunDvTableName(ammoVariety);
  if (value.includes("sniper")) return "DV Sniper Rifle";
  if (value.includes("assault")) return "DV Assault Rifle";
  if (value.includes("rocket")) return "DV Rocket Launcher";
  if (value.includes("grenade")) return "DV Grenade Launcher";
  if (value.includes("crossbow") || value.includes("bow")) return "DV Bows & Crossbows";
  if (value.includes("smg")) return "DV SMG";
  if (value.includes("pistol")) return "DV Pistol";
  return "";
}

function getWeaponTypeDvTableName(weaponType, ammoVariety) {
  switch (weaponType) {
    case "assaultRifle":
      return "DV Assault Rifle";
    case "bow":
      return "DV Bows & Crossbows";
    case "grenadeLauncher":
      return "DV Grenade Launcher";
    case "heavyPistol":
    case "medPistol":
    case "vHeavyPistol":
      return "DV Pistol";
    case "heavySmg":
    case "smg":
      return "DV SMG";
    case "rocketLauncher":
      return "DV Rocket Launcher";
    case "shotgun":
      return getShotgunDvTableName(ammoVariety);
    case "sniperRifle":
      return "DV Sniper Rifle";
    default:
      return "";
  }
}

function getShotgunDvTableName(ammoVariety) {
  const value = normalizeTableName(ammoVariety);
  if (value.includes("shell")) return SHOTGUN_DV_TABLES.shell;
  return SHOTGUN_DV_TABLES.slug;
}

function isStandardDvTable(tableName) {
  const normalizedTableName = normalizeTableName(tableName);
  return Array.from(STANDARD_DV_TABLES).some((standardTable) => normalizeTableName(standardTable) === normalizedTableName);
}

function getWeaponAmmoVariety(weapon) {
  const loadedAmmoVariety = getLoadedAmmoVariety(weapon);
  if (loadedAmmoVariety) return loadedAmmoVariety;

  const ammoVariety = weapon?.system?.ammoVariety;
  if (Array.isArray(ammoVariety)) return ammoVariety.length === 1 ? ammoVariety[0] : "";
  return ammoVariety ?? "";
}

function getLoadedAmmoVariety(weapon) {
  try {
    const loadedAmmoProp = weapon?._getLoadedAmmoProp?.("variety");
    if (loadedAmmoProp) return loadedAmmoProp;
  } catch (_error) {
    // Foundry item helpers can depend on actor state; fall through to raw data.
  }

  try {
    const [installedAmmo] = weapon?.getInstalledItems?.("ammo") ?? [];
    const variety = getAmmoVariety(installedAmmo);
    if (variety) return variety;
  } catch (_error) {
    // Some test doubles and legacy items do not expose installed item helpers.
  }

  const installedAmmo = getInstalledAmmoFromActor(weapon);
  const installedAmmoVariety = getAmmoVariety(installedAmmo);
  if (installedAmmoVariety) return installedAmmoVariety;

  const loadedAmmo = weapon?.system?.loadedAmmo;
  const loadedAmmoVariety = getAmmoVariety(loadedAmmo);
  if (loadedAmmoVariety) return loadedAmmoVariety;

  const loadedAmmoId = loadedAmmo?.id ?? loadedAmmo?._id;
  const loadedAmmoItem = getActorItemById(weapon?.actor, loadedAmmoId);
  return getAmmoVariety(loadedAmmoItem);
}

function getInstalledAmmoFromActor(weapon) {
  const installedIds = weapon?.system?.installedItems?.list ?? [];
  if (!Array.isArray(installedIds)) return null;

  for (const itemId of installedIds) {
    const item = getActorItemById(weapon?.actor, itemId) ?? game.items?.get?.(itemId);
    if (item?.type === "ammo" || getAmmoVariety(item)) return item;
  }
  return null;
}

function getActorItemById(actor, itemId) {
  if (!actor || !itemId) return null;
  return actor.getOwnedItem?.(itemId)
    ?? actor.items?.get?.(itemId)
    ?? getCollectionValues(actor.items).find((item) => [item.id, item._id].includes(itemId))
    ?? null;
}

function getAmmoVariety(ammo) {
  return getPropertyValue(ammo, "system.variety") ?? getPropertyValue(ammo, "variety") ?? "";
}

function getPropertyValue(source, path) {
  if (!source || !path) return undefined;
  if (foundry.utils?.getProperty) return foundry.utils.getProperty(source, path);
  return path.split(".").reduce((value, key) => value?.[key], source);
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

function getWeaponTypeLabel(weapon) {
  if (isNetrunningAttack(weapon)) {
    if (weapon.netAction === "zap") return "Zap";
    if (weapon.netAction === "blackice") return "Black ICE";
    return "Netrunning Program";
  }
  const weaponType = weapon?.system?.weaponType;
  if (!weaponType) return weapon?.name ?? "-";
  return WEAPON_TYPE_LABELS[weaponType] ?? formatCamelCase(weaponType);
}

function formatCamelCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

function formatDistance(distance) {
  if (!Number.isFinite(distance)) return "-";
  const units = canvas.scene?.grid?.units || "m";
  return `${Math.round(distance * 10) / 10} ${units}`;
}

async function simpleMessage(content, { outcome = null } = {}) {
  const safeContent = escapeHtml(content);
  const outcomeStyle = getOutcomeMessageStyle(outcome);
  await ChatMessage.create({
    user: game.user.id,
    flags: {
      [MODULE_ID]: {
        resultMessage: true,
      },
    },
    content: `
      <div class="rollcard cpr-af-message">
        <div class="rollcard-bottom">
          <div class="cpr-block text-normal"${outcomeStyle}>
            <div class="cpr-af-message-content">${safeContent}</div>
          </div>
        </div>
      </div>
    `,
  });
}

function getOutcomeMessageStyle(outcome) {
  if (outcome === true || outcome === "hit" || outcome === "success") {
    return ' style="padding:10px;background-color:var(--cpr-text-chat-success, #2d9f36)"';
  }
  if (outcome === false || outcome === "miss" || outcome === "failure") {
    return ' style="padding:10px;background-color:var(--cpr-text-chat-failure, #b90202ff)"';
  }
  return "";
}

async function maybeSuppressNativeResultMessage(message) {
  if (message.getFlag?.(MODULE_ID, "resultMessage")) return false;
  if (!isDiwakoCpredAdditionsActive()) return false;

  pruneNativeResultSuppressions();
  if (pendingNativeResultSuppressions.size === 0) return false;

  const content = String(message.content ?? "");
  if (!isSuppressibleDiwakoResultContent(content)) return false;
  const text = normalizeMessageText(content);

  for (const key of pendingNativeResultSuppressions.keys()) {
    if (!messageMatchesNativeResultSuppression(text, key)) continue;
    if (!canManageChatMessage(message)) return false;
    try {
      await message.delete();
      return true;
    } catch (_error) {
      return false;
    }
  }
  return false;
}

function markNativeResultSuppressions(attacks, actorName = null) {
  const expiresAt = Date.now() + 5000;
  for (const attack of attacks) {
    const attackerNames = [actorName, attack.attackerName].filter(Boolean);
    for (const attackerName of attackerNames) {
      const key = getNativeResultSuppressionKey(attackerName, attack.targetName);
      pendingNativeResultSuppressions.set(key, expiresAt);
    }
  }
}

function pruneNativeResultSuppressions() {
  const now = Date.now();
  for (const [key, expiresAt] of pendingNativeResultSuppressions.entries()) {
    if (expiresAt <= now) pendingNativeResultSuppressions.delete(key);
  }
}

function getNativeResultSuppressionKey(attackerName, targetName) {
  return `${normalizeResultText(attackerName)}|${normalizeResultText(targetName)}`;
}

function messageMatchesNativeResultSuppression(text, key) {
  const [attackerName, targetName] = key.split("|");
  const normalized = normalizeResultText(text);
  return normalized.includes(`${attackerName} hits ${targetName} (dv:`)
    || normalized.includes(`${attackerName} missed ${targetName} by `)
    || (normalized.includes(`${attackerName} beats the ranged dv`)
      && normalized.includes(`to hit ${targetName}`));
}

function isSuppressibleNativeResultText(text) {
  const normalized = normalizeResultText(text);
  return (normalized.includes(" hits ") && normalized.includes("(dv:") && normalized.includes("roll damage"))
    || (normalized.includes(" missed ") && normalized.includes(" by ") && normalized.includes("(dv:"))
    || (normalized.includes(" beats the ranged dv ") && normalized.includes(" to hit ") && normalized.includes("roll damage"))
    || (normalized.includes(" according to the ranged dv ") && normalized.includes(" missed ") && normalized.includes("roll damage"));
}

function isSuppressibleDiwakoResultContent(content) {
  return hasDiwakoResultTraits(content) && isSuppressibleNativeResultText(content);
}

function hasDiwakoResultTraits(content) {
  const normalized = normalizeRawContent(content);
  return normalized.includes("cpr-block")
    && normalized.includes("background-color:")
    && (normalized.includes("fg-red") || normalized.includes("fg-green"));
}

function isDiwakoCpredAdditionsActive() {
  return Boolean(game.modules?.get?.(DIWAKO_CPRED_ADDITIONS_ID)?.active);
}

function normalizeMessageText(content) {
  return String(content ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResultText(content) {
  return normalizeMessageText(content).toLocaleLowerCase();
}

function normalizeRawContent(content) {
  return String(content ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function canManageChatMessage(message) {
  const messageUserId = message.user?.id ?? message.user;
  return game.user.isGM || messageUserId === game.user.id;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emitSocket(message) {
  game.socket.emit(SOCKET, { ...message, senderUserId: game.user.id });
}

function emitTo(userId, type, data) {
  emitSocket({ userId, type, data });
}

function rememberAttackDeclaration(data) {
  if (data?.attackId) knownAttackDeclarations.set(data.attackId, foundry.utils.deepClone(data));
}

async function getKnownAttackDeclaration(attackId) {
  if (!attackId) return null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cached = knownAttackDeclarations.get(attackId);
    if (cached) return foundry.utils.deepClone(cached);

    const message = getCollectionValues(game.messages).find((entry) => {
      const declarations = entry.getFlag?.(MODULE_ID, "attackDeclarations") ?? [];
      return declarations.some((declaration) => declaration.attackId === attackId)
        || entry.getFlag?.(MODULE_ID, "attackDeclaration")?.attackId === attackId;
    });
    const declaration = (message?.getFlag?.(MODULE_ID, "attackDeclarations") ?? [])
      .find((entry) => entry.attackId === attackId)
      ?? message?.getFlag?.(MODULE_ID, "attackDeclaration");
    if (declaration) {
      rememberAttackDeclaration(declaration);
      return foundry.utils.deepClone(declaration);
    }

    await waitFor(75);
  }

  return null;
}

function getCollectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function waitFor(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function validateSocketMessage(message) {
  if (!message || typeof message !== "object" || !SOCKET_MESSAGE_TYPES.has(message.type)) return null;
  if (message.userId && message.userId !== game.user.id) return null;

  if (message.type === "promptClaimed") {
    const declaration = await getKnownAttackDeclaration(message.attackId);
    if (!declaration) return null;
    const defender = await resolveToken(declaration.targetSceneId, declaration.targetTokenId, declaration.targetActorId);
    const docs = getDefenderOwnershipDocs(declaration, defender);
    const owner = getUserById(message.ownerUserId);
    if (!owner || !userOwnsAny(owner, docs, declaration, defender?.document)) return null;
    return { type: message.type, attackId: message.attackId };
  }

  const data = await getTrustedSocketData(message.data);
  if (!data) return null;

  if (message.type === "routePrompt" && !game.user.isGM) return null;

  if (["recordChoice", "recordGroupEvasion", "resolveNoEvade", "resolveAgainstEvasion"].includes(message.type)) {
    const resolver = pickAttackResolver(data);
    if (resolver !== game.user.id) return null;
  }

  if (["showPrompt", "rollGroupEvasion", "rollEvasion"].includes(message.type)) {
    const defender = await resolveToken(data.targetSceneId, data.targetTokenId, data.targetActorId);
    const docs = getDefenderOwnershipDocs(data, defender);
    if (!game.user.isGM && !userOwnsAny(game.user, docs, data, defender?.document)) return null;
  }

  if (message.type === "recordGroupEvasion" && data.resolverUserId && data.resolverUserId !== game.user.id) {
    return null;
  }

  return { ...message, data };
}

async function getTrustedSocketData(data) {
  if (!data?.attackId) return null;

  const declaration = await getKnownAttackDeclaration(data.attackId);
  if (!declaration) return null;

  const trusted = {
    ...declaration,
    defenderAction: data.defenderAction,
    evasionTotal: data.evasionTotal,
    evasionFailed: Boolean(data.evasionFailed),
    defenseDetails: sanitizeRollDetails(data.defenseDetails),
    resolverUserId: data.resolverUserId,
  };

  if (trusted.defenderAction && !["evade", "no-evade", "concentration", "net-defense"].includes(trusted.defenderAction)) return null;
  return trusted;
}

function sanitizeRollDetails(details) {
  if (!details || typeof details !== "object") return null;
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    initialRoll: numberOrNull(details.initialRoll),
    criticalRoll: numberOrNull(details.criticalRoll),
    modifierTotal: numberOrNull(details.modifierTotal),
    total: numberOrNull(details.total),
    isCritical: details.isCritical === true,
    isFumble: details.isFumble === true,
    components: Array.isArray(details.components) ? details.components.slice(0, 30).map((component) => {
      const value = numberOrNull(component?.value);
      return {
        label: String(component?.label ?? "Modificador").slice(0, 100),
        value,
        signedValue: value === null ? "" : value >= 0 ? `+${value}` : String(value),
      };
    }).filter((component) => component.value !== null) : [],
  };
}

function getUserById(userId) {
  return game.users.get?.(userId) ?? game.users.find?.((user) => user.id === userId) ?? null;
}

async function onSocket(message) {
  const trusted = await validateSocketMessage(message);
  if (!trusted) return;

  if (trusted.type === "promptClaimed") {
    claimedPrompts.add(trusted.attackId);
    return;
  }

  if (trusted.type === "routePrompt") await routeDefenderPrompt(trusted.data);
  if (trusted.type === "maybeShowPrompt") await maybeShowDefenderPrompt(trusted.data);
  if (trusted.type === "showPrompt") await showDefenderPrompt(trusted.data);
  if (trusted.type === "recordChoice") await recordDefenderChoice(trusted.data);
  if (trusted.type === "rollGroupEvasion") await rollGroupEvasion(trusted.data);
  if (trusted.type === "recordGroupEvasion") await recordGroupEvasion(trusted.data);
  if (trusted.type === "resolveNoEvade") await resolveNoEvade(trusted.data);
  if (trusted.type === "rollEvasion") await rollEvasionAndContinue(trusted.data);
  if (trusted.type === "resolveAgainstEvasion") await resolveAgainstEvasion(trusted.data);
}

export {
  escapeHtml,
  applyAimedLocation,
  applyAutofireMultiplier,
  clampAutofireMultiplier,
  createDamageRows,
  createPublicApi,
  getAimedDamageLocation,
  getAutofireHitMultiplier,
  getActorById,
  getActiveDvTableName,
  getBaseDvTableName,
  getDefenseLabel,
  getDefenseSkillNames,
  getGroupComparison,
  isAttackHit,
  findWeaponBySelection,
  findDefenseSkill,
  formatAttackOutcomeMessage,
  getOutcomeMessageStyle,
  getRollDetails,
  getNativeResultSuppressionKey,
  getCollectionValues,
  getCyberdecks,
  getHighestAutofireMultiplier,
  getInstalledPrograms,
  getRezzedPrograms,
  getRezzedProgramOptions,
  getProgramTargetPromptData,
  getNetrunningAttackOptions,
  getNetrunningDamageLabel,
  getNetrunningAttackSkillLabel,
  getAttackActionLabel,
  getBaseNetrunningDefenseRollConfig,
  hasDiwakoResultTraits,
  isNetrunningAttack,
  isNetrunningAttackerProgram,
  isNetrunnerActor,
  isAntiProgramAttack,
  isNetrunningDeclaration,
  isDiwakoCpredAdditionsActive,
  isSuppressibleDiwakoResultContent,
  isSuppressibleNativeResultText,
  messageMatchesNativeResultSuppression,
  isSuppressiveFire,
  getLoadedAmmoVariety,
  getNativeRollType,
  getSavedFireType,
  getSavedAimedLocation,
  getStaticDv,
  getWeaponAmmoVariety,
  getWeaponAutofireMax,
  getWeaponTypeLabel,
  inferDvTableName,
  formatCamelCase,
  classifyChatMessage,
  isCombatSkillTitle,
  isCombatUplinkTracker,
  normalizeAimedLocation,
  normalizeDefenderAction,
  normalizePublicAttackRequest,
  normalizeTargetList,
  normalizeTargetProgramSelections,
  needsProgramTargetPrompt,
  findRezzedProgramOption,
  applyProgramDamage,
  prepareAttackDeclarations,
  getProgramDamageFormula,
  shouldSkipDefenderPrompt,
  usesBaseNetrunningDefense,
  getTrustedSocketData,
  rememberAttackDeclaration,
  validateSocketMessage,
  knownAttackDeclarations,
};
