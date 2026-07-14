import test from "node:test";
import assert from "node:assert/strict";

const users = [
  { id: "resolver", name: "Resolver", active: true, isGM: false },
  { id: "target-owner", name: "Target Owner", active: true, isGM: false },
  { id: "stranger", name: "Stranger", active: true, isGM: false },
  { id: "gm", name: "GM", active: true, isGM: true },
];
users.get = (id) => users.find((user) => user.id === id);

const attackerActor = {
  id: "attacker",
  testUserPermission: (user) => user.id === "resolver",
};
const defenderActor = {
  id: "defender",
  testUserPermission: (user) => user.id === "target-owner",
};

const actors = {
  tokens: undefined,
  get: (id) => ({ attacker: attackerActor, defender: defenderActor }[id]),
};

const targetDocument = {
  id: "target-token",
  actorId: "defender",
  actor: defenderActor,
};

globalThis.window = { setTimeout };
globalThis.foundry = {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    randomID: () => "random-id",
  },
};
globalThis.Hooks = {
  once: () => {},
  on: () => {},
};
globalThis.game = {
  system: { id: "cyberpunk-red-core" },
  user: users[0],
  users,
  actors,
  modules: new Map([["diwako-cpred-additions", { active: true }]]),
  messages: [],
  scenes: {
    get: () => ({
      tokens: {
        get: () => targetDocument,
      },
    }),
  },
  socket: {
    emit: () => {},
  },
};
globalThis.canvas = {
  scene: { id: "other-scene" },
  tokens: {
    get: () => null,
  },
};
globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
};

const __test__ = await import("../scripts/main.js");

const declaration = {
  attackId: "attack-1",
  attackerSceneId: "scene-1",
  attackerTokenId: "attacker-token",
  attackerActorId: "attacker",
  targetSceneId: "scene-1",
  targetTokenId: "target-token",
  targetActorId: "defender",
  targetBaseActorId: "defender",
  targetName: "Target",
  weaponId: "weapon-1",
  weaponName: "Safe Weapon",
  groupTotalTargets: 1,
};

test.beforeEach(() => {
  __test__.knownAttackDeclarations.clear();
  __test__.rememberAttackDeclaration(declaration);
  game.user = users[0];
});

test("escapeHtml encodes dangerous characters", () => {
  assert.equal(
    __test__.escapeHtml("<img src=x onerror=alert(1)> & \"quote\" 'single'"),
    "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot; &#39;single&#39;",
  );
});

test("getActorById tolerates missing synthetic token actor map", () => {
  assert.equal(__test__.getActorById("attacker"), attackerActor);
  assert.equal(__test__.getActorById("missing"), undefined);
});

test("public API exposes attack preparation and resolution methods", () => {
  const api = __test__.createPublicApi();

  assert.equal(typeof api.open, "function");
  assert.equal(typeof api.prepareAttack, "function");
  assert.equal(typeof api.declareAttack, "function");
  assert.equal(typeof api.resolveAttack, "function");
  assert.equal(typeof api.chooseDefense, "function");
  assert.equal(typeof api.getWeapons, "function");
  assert.equal(Object.isFrozen(api), true);
});

test("public API normalizes defender actions", () => {
  assert.equal(__test__.normalizeDefenderAction(true), "evade");
  assert.equal(__test__.normalizeDefenderAction("evade"), "evade");
  assert.equal(__test__.normalizeDefenderAction(false), "no-evade");
  assert.equal(__test__.normalizeDefenderAction("noEvade"), "no-evade");
  assert.equal(__test__.normalizeDefenderAction("no-evade"), "no-evade");
  assert.equal(__test__.normalizeDefenderAction("suppressive"), "concentration");
  assert.equal(__test__.normalizeDefenderAction("concentration"), "concentration");
  assert.equal(__test__.normalizeDefenderAction("parry"), null);
});

test("public API normalizes explicit attacker target and weapon input", () => {
  const attackerToken = {
    name: "Solo",
    actor: attackerActor,
    document: { id: "attacker-token" },
  };
  const targetToken = {
    name: "Target",
    actor: defenderActor,
    document: { id: "target-token" },
  };
  const weapon = { id: "weapon-1", name: "Rifle" };

  const request = __test__.normalizePublicAttackRequest({
    attacker: attackerToken,
    targets: targetToken,
    weapon,
  });

  assert.equal(request.attacker, attackerToken);
  assert.deepEqual(request.targets, [targetToken]);
  assert.equal(request.weapon, weapon);
  assert.deepEqual(__test__.normalizeTargetList(new Set([targetToken])), [targetToken]);
});

test("netrunning attack options include Zap and attacker programs", () => {
  const attacker = {
    items: [
      {
        id: "deck-1",
        type: "cyberdeck",
        name: "Cyberdeck",
        system: {
          installedPrograms: [
            {
              id: "sword",
              type: "program",
              name: "Sword",
              system: { class: "antipersonnelattacker", damage: { standard: "3d6", blackIce: "2d6" } },
            },
            {
              id: "armor",
              type: "program",
              name: "Armor",
              system: { class: "defender", damage: { standard: "", blackIce: "" } },
            },
          ],
        },
      },
    ],
  };

  const options = __test__.getNetrunningAttackOptions(attacker);

  assert.deepEqual(options.map((option) => option.netAction), ["zap", "program"]);
  assert.equal(options[0].name, "Zap (Cyberdeck)");
  assert.equal(options[1].program.name, "Sword");
  assert.equal(__test__.isNetrunningAttackerProgram(attacker.items[0].system.installedPrograms[0]), true);
  assert.equal(__test__.isNetrunningAttackerProgram(attacker.items[0].system.installedPrograms[1]), false);
});

test("netrunning declarations carry cyberdeck and program data without DV", async () => {
  const program = {
    id: "sword",
    uuid: "Actor.runner.Item.sword",
    type: "program",
    name: "Sword",
    system: { class: "antiprogramattacker", damage: { standard: "3d6", blackIce: "2d6" } },
  };
  const cyberdeck = {
    id: "deck-1",
    type: "cyberdeck",
    name: "Cyberdeck",
  };
  const option = {
    id: "net-program-deck-1-sword",
    name: "Sword (Cyberdeck)",
    type: "netrunning",
    netAction: "program",
    cyberdeck,
    program,
  };
  const attackerToken = {
    name: "Runner",
    actor: { id: "runner" },
    document: { id: "runner-token" },
  };
  const targetToken = {
    name: "Black ICE",
    actor: { id: "blackice", type: "blackIce" },
    document: { id: "blackice-token", actorId: "blackice" },
  };

  const [data] = await __test__.prepareAttackDeclarations(attackerToken, [targetToken], option, {
    skipDefenderPrompt: true,
  });

  assert.equal(data.attackKind, "netrunning");
  assert.equal(data.netAction, "program");
  assert.equal(data.cyberdeckId, "deck-1");
  assert.equal(data.programId, "sword");
  assert.equal(data.programUuid, "Actor.runner.Item.sword");
  assert.equal(data.damage, "2d6");
  assert.equal(data.dvLabel, "Black ICE DEF");
  assert.equal(data.distanceLabel, "-");
  assert.equal(data.skipDefenderPrompt, true);
});

test("netrunning defense is trusted as an internal contested action", async () => {
  __test__.knownAttackDeclarations.clear();
  __test__.rememberAttackDeclaration({
    ...declaration,
    attackKind: "netrunning",
    netAction: "zap",
    cyberdeckId: "deck-1",
    skipDefenderPrompt: true,
  });

  const result = await __test__.getTrustedSocketData({
    attackId: "attack-1",
    defenderAction: "net-defense",
    evasionTotal: 17,
  });

  assert.equal(result.defenderAction, "net-defense");
  assert.equal(result.attackKind, "netrunning");
  assert.equal(result.cyberdeckId, "deck-1");
  assert.equal(__test__.getDefenseLabel(result), "Netrunning Defense");
});

test("netrunning defense falls back to base d10 without Interface setup", () => {
  const actorWithoutInterface = {
    type: "character",
    items: [],
    itemTypes: { role: [] },
    system: { roleInfo: {} },
  };
  const actorWithInterface = {
    type: "character",
    items: [{ id: "deck-1", type: "cyberdeck", system: { equipped: "equipped" } }],
    itemTypes: { role: [{ id: "role-1", system: { mainRoleAbility: "Interface" } }] },
    system: { roleInfo: { activeNetRole: "role-1" } },
  };
  const blackIce = {
    type: "blackIce",
    createStatRoll: () => ({}),
  };

  assert.equal(__test__.usesBaseNetrunningDefense(actorWithoutInterface), true);
  assert.equal(__test__.usesBaseNetrunningDefense(actorWithInterface), false);
  assert.equal(__test__.usesBaseNetrunningDefense(blackIce), false);
  assert.deepEqual(__test__.getBaseNetrunningDefenseRollConfig(), {
    rollType: "defense",
    roleName: "Interface",
    roleValue: 0,
    rollTitle: "Netrunning Defense",
    ability: "defense",
  });
});

test("getNativeRollType uses the attacker's selected fire mode for attacks", () => {
  const actor = {
    getFlag: (_systemId, key) => (key === "firetype-weapon-1" ? "aimed" : null),
  };

  assert.equal(__test__.getNativeRollType(actor, { id: "weapon-1" }, "attack"), "aimed");
  assert.equal(__test__.getNativeRollType(actor, { id: "weapon-1" }, "damage"), "damage");
});

test("getSavedFireType falls back to item _id and ignores unsupported modes", () => {
  const actor = {
    getFlag: (_systemId, key) => (key === "firetype-legacy-id" ? "autofire" : null),
  };
  const unsupported = {
    getFlag: () => "burst",
  };

  assert.equal(__test__.getSavedFireType(actor, { _id: "legacy-id" }), "autofire");
  assert.equal(__test__.getNativeRollType(unsupported, { id: "weapon-1" }, "attack"), "attack");
});

test("isSuppressiveFire detects the attacker's selected suppressive fire mode", () => {
  const actor = {
    getFlag: (_systemId, key) => (key === "firetype-weapon-1" ? "suppressive" : null),
  };

  assert.equal(__test__.isSuppressiveFire(actor, { id: "weapon-1" }), true);
  assert.equal(__test__.isSuppressiveFire(actor, { id: "weapon-2" }), false);
});

test("getAutofireHitMultiplier returns attack margin capped by weapon autofire max", () => {
  const actor = {
    getFlag: (_systemId, key) => (key === "firetype-weapon-1" ? "autofire" : null),
  };
  const weapon = {
    id: "weapon-1",
    system: {
      fireModes: { autoFire: 3 },
      weaponType: "smg",
    },
  };

  assert.equal(__test__.getAutofireHitMultiplier(actor, weapon, 19, 17), 2);
  assert.equal(__test__.getAutofireHitMultiplier(actor, weapon, 25, 17), 3);
  assert.equal(__test__.getAutofireHitMultiplier(actor, weapon, 17, 17), 1);
});

test("getActiveDvTableName uses the autofire DV table when autofire is selected", () => {
  const actor = {
    getFlag: (_systemId, key) => (key === "firetype-weapon-1" ? "autofire" : null),
  };
  const weapon = { id: "weapon-1" };

  assert.equal(__test__.getActiveDvTableName(weapon, actor, "DV SMG"), "DV SMG (Autofire)");
  assert.equal(__test__.getActiveDvTableName(weapon, actor, "DV SMG (Autofire)"), "DV SMG (Autofire)");
  assert.equal(__test__.getActiveDvTableName(weapon, null, "DV SMG"), "DV SMG");
});

test("findWeaponBySelection resolves selected weapons by dialog index before id", () => {
  const first = { id: "first-id", name: "First" };
  const second = { _id: "second-id", name: "Second" };

  assert.equal(__test__.findWeaponBySelection([first, second], "1"), second);
  assert.equal(__test__.findWeaponBySelection([first, second], "first-id"), first);
  assert.equal(__test__.findWeaponBySelection([first, second], "second-id"), second);
  assert.equal(__test__.findWeaponBySelection([first, second], "missing"), null);
});

test("getBaseDvTableName uses loaded shotgun shell ammo over the configured slug table", () => {
  const weapon = {
    name: "Nomad Shotgun",
    system: {
      weaponType: "shotgun",
      dvTable: "DV Shotgun (Slug)",
      ammoVariety: ["shotgunShell", "shotgunSlug"],
    },
    _getLoadedAmmoProp: (prop) => (prop === "variety" ? "shotgunShell" : undefined),
  };

  assert.equal(__test__.getWeaponAmmoVariety(weapon), "shotgunShell");
  assert.equal(__test__.inferDvTableName(weapon), "DV Shotgun (Shell)");
  assert.equal(__test__.getBaseDvTableName(weapon), "DV Shotgun (Shell)");
});

test("getStaticDv returns DV 13 for shotgun shell without requiring a roll table", () => {
  assert.equal(__test__.getStaticDv("DV Shotgun (Shell)"), 13);
  assert.equal(__test__.getStaticDv("DV Shotgun (Slug)"), null);
});

test("getBaseDvTableName infers shotgun DV from weapon type over stale standard tables and names", () => {
  const assaultNamedShotgun = {
    name: "Assault Shotgun",
    system: {
      weaponType: "shotgun",
      dvTable: "DV Assault Rifle",
      ammoVariety: ["shotgunShell", "shotgunSlug"],
    },
    _getLoadedAmmoProp: (prop) => (prop === "variety" ? "shotgunSlug" : undefined),
  };

  assert.equal(__test__.inferDvTableName(assaultNamedShotgun), "DV Shotgun (Slug)");
  assert.equal(__test__.getBaseDvTableName(assaultNamedShotgun), "DV Shotgun (Slug)");
});

test("getLoadedAmmoVariety resolves installed ammo from the owning actor", () => {
  const ammo = {
    id: "ammo-1",
    type: "ammo",
    system: {
      variety: "shotgunShell",
    },
  };
  const actor = {
    items: [ammo],
  };
  const weapon = {
    name: "Nomad Shotgun",
    actor,
    system: {
      weaponType: "shotgun",
      dvTable: "DV Shotgun (Slug)",
      installedItems: {
        list: ["ammo-1"],
      },
      ammoVariety: ["shotgunShell", "shotgunSlug"],
    },
  };

  assert.equal(__test__.getLoadedAmmoVariety(weapon), "shotgunShell");
  assert.equal(__test__.getBaseDvTableName(weapon), "DV Shotgun (Shell)");
});

test("getLoadedAmmoVariety follows the native loaded ammo helper over stale loadedAmmo data", () => {
  const slugAmmo = {
    id: "slug-ammo",
    type: "ammo",
    system: {
      variety: "shotgunSlug",
    },
  };
  const actor = {
    items: [slugAmmo],
  };
  const weapon = {
    name: "Nomad Shotgun",
    actor,
    _getLoadedAmmoProp: (prop) => (prop === "variety" ? "shotgunShell" : undefined),
    system: {
      weaponType: "shotgun",
      dvTable: "DV Shotgun (Shell)",
      loadedAmmo: {
        id: "slug-ammo",
      },
      ammoVariety: ["shotgunShell", "shotgunSlug"],
    },
  };

  assert.equal(__test__.getLoadedAmmoVariety(weapon), "shotgunShell");
  assert.equal(__test__.getBaseDvTableName(weapon), "DV Shotgun (Shell)");
});

test("getBaseDvTableName keeps slug shotgun DV and custom shotgun tables intact", () => {
  const slugWeapon = {
    name: "Nomad Shotgun",
    system: {
      weaponType: "shotgun",
      dvTable: "DV Shotgun (Slug)",
      ammoVariety: ["shotgunShell", "shotgunSlug"],
    },
    _getLoadedAmmoProp: (prop) => (prop === "variety" ? "shotgunSlug" : undefined),
  };
  const customWeapon = {
    name: "Custom Shotgun",
    system: {
      weaponType: "shotgun",
      dvTable: "Custom DV Table",
      ammoVariety: "shotgunShell",
    },
  };

  assert.equal(__test__.getBaseDvTableName(slugWeapon), "DV Shotgun (Slug)");
  assert.equal(__test__.getBaseDvTableName(customWeapon), "Custom DV Table");
});

test("getWeaponAutofireMax falls back to system defaults for common autofire weapons", () => {
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "assaultRifle" } }), 4);
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "heavySmg" } }), 3);
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "bow" } }), 0);
});

test("getWeaponTypeLabel displays the weapon type instead of the weapon name", () => {
  assert.equal(__test__.getWeaponTypeLabel({ name: "Malorian", system: { weaponType: "heavyPistol" } }), "Heavy Pistol");
  assert.equal(__test__.getWeaponTypeLabel({ name: "Generic", system: { weaponType: "customWeaponType" } }), "Custom Weapon Type");
  assert.equal(__test__.getWeaponTypeLabel({ name: "Fallback", system: {} }), "Fallback");
});

test("applyAutofireMultiplier preloads the damage roll multiplier safely", () => {
  const cprRoll = {
    isAutofire: true,
    autofireMultiplier: 1,
    autofireMultiplierMax: 4,
    configureAutofire(multiplier, max) {
      this.autofireMultiplier = multiplier;
      this.autofireMultiplierMax = max;
    },
  };

  __test__.applyAutofireMultiplier(cprRoll, 7);

  assert.equal(cprRoll.autofireMultiplier, 4);
  assert.equal(cprRoll.autofireMultiplierMax, 4);
  assert.equal(__test__.getHighestAutofireMultiplier([{ autofireMultiplier: 2 }, { autofireMultiplier: 4 }]), 4);
});

test("getAimedDamageLocation carries the selected aimed shot location into damage", () => {
  const actor = {
    getFlag: (_systemId, key) => {
      if (key === "firetype-weapon-1") return "aimed";
      if (key === "aimedLocation") return "head";
      return null;
    },
  };
  const weapon = { id: "weapon-1" };

  assert.equal(__test__.getAimedDamageLocation(actor, weapon, { location: "leg" }), "leg");
  assert.equal(__test__.getAimedDamageLocation(actor, weapon, { location: "heldItem" }), "heldItem");
  assert.equal(__test__.getAimedDamageLocation(actor, weapon, { location: "body" }), "head");
});

test("applyAimedLocation only updates aimed damage rolls with valid locations", () => {
  const cprRoll = {
    isAimed: true,
    location: "head",
  };

  __test__.applyAimedLocation(cprRoll, "heldItem");
  assert.equal(cprRoll.location, "heldItem");

  __test__.applyAimedLocation(cprRoll, "body");
  assert.equal(cprRoll.location, "heldItem");

  assert.equal(__test__.normalizeAimedLocation("leg"), "leg");
  assert.equal(__test__.normalizeAimedLocation("body"), null);
});

test("defense skill helpers use Concentration for suppressive fire", () => {
  const actor = {
    items: [
      { type: "skill", name: "Evasion" },
      { type: "skill", name: "Concentración" },
    ],
  };

  assert.deepEqual(__test__.getDefenseSkillNames({ defenderAction: "concentration" }), ["concentration", "concentracion"]);
  assert.equal(__test__.getDefenseLabel({ defenderAction: "concentration" }), "Concentration");
  assert.equal(__test__.findDefenseSkill(actor, { defenderAction: "concentration" }).name, "Concentración");
  assert.equal(__test__.findDefenseSkill(actor, { defenderAction: "evade" }).name, "Evasion");
});

test("suppressive fire declarations skip the defender evasion prompt", () => {
  assert.equal(__test__.shouldSkipDefenderPrompt({ skipDefenderPrompt: true }), true);
  assert.equal(__test__.shouldSkipDefenderPrompt({ skipDefenderPrompt: false }), false);
  assert.equal(__test__.shouldSkipDefenderPrompt({}), false);
});

test("group comparisons use evasion totals for evading targets even when a DV exists", () => {
  const entry = {
    evasions: new Map([["attack-1", 18]]),
  };
  const choice = {
    attackId: "attack-1",
    defenderAction: "evade",
    targetName: "Target",
    dv: 13,
  };

  assert.deepEqual(__test__.getGroupComparison(choice, entry), {
    mode: "evasion",
    target: 18,
    label: "Evasion",
  });
});

test("attack outcome messages use the actual comparison target", () => {
  const attacker = { name: "Solo" };

  assert.equal(
    __test__.formatAttackOutcomeMessage(attacker, "Target", 21, { mode: "evasion", target: 18, label: "Evasion" }, true),
    "Solo hits Target (Evasion: 18, 3 over)! Roll Damage!",
  );
  assert.equal(
    __test__.formatAttackOutcomeMessage(attacker, "Target", 17, { mode: "evasion", target: 18, label: "Evasion" }, false),
    "Solo missed Target by 1 (Evasion: 18).",
  );
  assert.equal(
    __test__.formatAttackOutcomeMessage(attacker, "Target", 13, { mode: "dv", target: 13, label: "DV" }, true),
    "Solo hits Target (DV: 13, 0 over)! Roll Damage!",
  );
  assert.equal(
    __test__.formatAttackOutcomeMessage(attacker, "Target", 18, { mode: "evasion", target: 15, label: "Concentration" }, true, { skipDamage: true }),
    "Solo affects Target (Concentration: 15, 3 over)!",
  );
});

test("getOutcomeMessageStyle returns controlled hit and miss chat colors", () => {
  assert.equal(
    __test__.getOutcomeMessageStyle(true),
    ' style="padding:10px;background-color:var(--cpr-text-chat-success, #2d9f36)"',
  );
  assert.equal(
    __test__.getOutcomeMessageStyle(false),
    ' style="padding:10px;background-color:var(--cpr-text-chat-failure, #b90202ff)"',
  );
  assert.equal(__test__.getOutcomeMessageStyle(null), "");
});

test("native DV result suppression only matches Diwako attacker and target results", () => {
  const key = __test__.getNativeResultSuppressionKey("Solo", "Target");
  const hitHtml = '<div class="cpr-block" style="padding:10px;background-color:var(--cpr-text-chat-success, #2d9f36)"><b>Solo <span class="fg-green">hits</span> Target</b> (DV: 13, 5 over)! Roll Damage!</div>';
  const missHtml = '<div class="cpr-block" style="padding:10px;background-color:var(--cpr-text-chat-failure, #b90202ff)"><b>Solo <span class="fg-red">missed</span> Target</b> by 2 (DV: 15)!</div>';
  const evadeHitHtml = '<div class="cpr-block" style="padding:10px;background-color:var(--cpr-text-chat-success, #2d9f36)"><b>Solo <span class="fg-green">beats the ranged DV</span> </b>(13, 5 over)<b> to hit Target</b> by 4! Roll damage IF they have NOT declared that they are dodging OR your roll has beat their evasion roll</div>';

  assert.equal(__test__.isDiwakoCpredAdditionsActive(), true);
  game.modules.set("diwako-cpred-additions", { active: false });
  assert.equal(__test__.isDiwakoCpredAdditionsActive(), false);
  game.modules.set("diwako-cpred-additions", { active: true });
  assert.equal(__test__.hasDiwakoResultTraits(hitHtml), true);
  assert.equal(__test__.hasDiwakoResultTraits("Solo hits Target (DV: 13, 5 over)! Roll Damage!"), false);
  assert.equal(__test__.isSuppressibleDiwakoResultContent(hitHtml), true);
  assert.equal(__test__.isSuppressibleDiwakoResultContent(missHtml), true);
  assert.equal(__test__.isSuppressibleDiwakoResultContent(evadeHitHtml), true);
  assert.equal(__test__.isSuppressibleDiwakoResultContent("Solo hits Target (DV: 13, 5 over)! Roll Damage!"), false);
  assert.equal(__test__.isSuppressibleNativeResultText("Solo hits Target (DV: 13, 5 over)! Roll Damage!"), true);
  assert.equal(__test__.isSuppressibleNativeResultText("Solo missed Target by 2 (DV: 15)"), true);
  assert.equal(__test__.isSuppressibleNativeResultText("Solo beats the ranged DV (13, 5 over) to hit Target by 4! Roll damage IF they have NOT declared that they are dodging OR your roll has beat their evasion roll"), true);
  assert.equal(__test__.isSuppressibleNativeResultText("Solo hits Target (Evasion: 18, 2 over)! Roll Damage!"), false);
  assert.equal(__test__.messageMatchesNativeResultSuppression("Solo hits Target (DV: 13, 5 over)! Roll Damage!", key), true);
  assert.equal(__test__.messageMatchesNativeResultSuppression("Solo missed Target by 2 (DV: 15)", key), true);
  assert.equal(__test__.messageMatchesNativeResultSuppression("Solo beats the ranged DV (13, 5 over) to hit Target by 4! Roll damage IF they have NOT declared that they are dodging OR your roll has beat their evasion roll", key), true);
  assert.equal(__test__.messageMatchesNativeResultSuppression("Solo hits Other Target (DV: 13, 5 over)! Roll Damage!", key), false);
});

test("socket validation rejects unknown message types", async () => {
  const result = await __test__.validateSocketMessage({ type: "deleteEverything", data: declaration });
  assert.equal(result, null);
});

test("socket validation canonicalizes attack data from stored declaration", async () => {
  const result = await __test__.validateSocketMessage({
    type: "recordChoice",
    userId: "resolver",
    data: {
      ...declaration,
      weaponId: "forged-weapon",
      defenderAction: "evade",
    },
  });

  assert.equal(result.data.weaponId, "weapon-1");
  assert.equal(result.data.defenderAction, "evade");
});

test("socket validation accepts concentration as an internal defender roll action", async () => {
  __test__.knownAttackDeclarations.clear();
  __test__.rememberAttackDeclaration({ ...declaration, skipDefenderPrompt: true });

  const result = await __test__.validateSocketMessage({
    type: "recordChoice",
    userId: "resolver",
    data: {
      ...declaration,
      defenderAction: "concentration",
    },
  });

  assert.equal(result.data.defenderAction, "concentration");
  assert.equal(result.data.skipDefenderPrompt, true);
});

test("socket validation rejects resolver-only actions for non-resolvers", async () => {
  game.user = users.find((user) => user.id === "stranger");

  const result = await __test__.validateSocketMessage({
    type: "recordChoice",
    userId: "stranger",
    data: {
      ...declaration,
      defenderAction: "no-evade",
    },
  });

  assert.equal(result, null);
});

test("prompt claims require a real target owner", async () => {
  const accepted = await __test__.validateSocketMessage({
    type: "promptClaimed",
    attackId: "attack-1",
    ownerUserId: "target-owner",
  });
  const rejected = await __test__.validateSocketMessage({
    type: "promptClaimed",
    attackId: "attack-1",
    ownerUserId: "stranger",
  });

  assert.equal(accepted.attackId, "attack-1");
  assert.equal(rejected, null);
});
