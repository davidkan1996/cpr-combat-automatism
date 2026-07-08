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
