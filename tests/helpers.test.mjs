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

const { __test__ } = await import("../scripts/main.js");

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

test("getWeaponAutofireMax falls back to system defaults for common autofire weapons", () => {
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "assaultRifle" } }), 4);
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "heavySmg" } }), 3);
  assert.equal(__test__.getWeaponAutofireMax({ system: { weaponType: "bow" } }), 0);
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
