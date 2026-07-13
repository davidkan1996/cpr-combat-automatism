# CPR Combat Automatism

A Foundry VTT v12 module for Cyberpunk RED CORE that guides weapon attacks from a selected attacker token to the current target.

## Features

- Selects the attacker from the controlled token.
- Selects the defender from the current target.
- Shows the attack weapon, damage, skill, range and DV before resolving.
- Lets the defender choose between No evade and Evade in a popup.
- Uses native Cyberpunk RED CORE rolls for attacks, Evasion and damage.
- Leaves damage application, armor, criticals and ablation to the native damage card.

## Installation

Use this manifest URL in Foundry:

```text
https://github.com/davidkan1996/cpr-combat-automatism/releases/download/v0.1.9/module.json
```

## Compatibility

- Foundry VTT v12 build 343
- cyberpunk-red-core v0.92.4

## Usage

1. Select one attacker token.
2. Target one defender token.
3. Use the CPR Combat Automatism token control.
4. Choose a weapon and create the attack.
5. The defender, or the GM fallback, chooses whether to evade.

## Public API

After Foundry's `ready` hook, the module exposes `game.cprCombatAutomatism`.
`game.cprAttackFlow` is kept as a backwards-compatible alias.

```js
const api = game.cprCombatAutomatism;
```

Available methods:

- `open()` opens the module attack dialog for the current token selection.
- `getWeapons(actor)` returns the attacker's usable weapon items.
- `prepareAttack({ attacker, targets, weapon })` builds attack declaration data without creating chat cards or resolving prompts.
- `declareAttack({ attacker, targets, weapon, dispatchPrompts = true })` creates public attack declaration cards and, by default, starts the normal defender prompt or Suppressive Fire resolution flow.
- `chooseDefense(declaration, defenderAction)` submits a defender choice. Supported actions are `"no-evade"`, `"evade"` and `"concentration"`.
- `resolveAttack(declaration, { defenderAction, defenseTotal, evasionTotal })` resolves one declaration through the module flow. Use `defenseTotal` or `evasionTotal` when an external caller has already rolled Evasion or Concentration.

Example:

```js
const [declaration] = await game.cprCombatAutomatism.declareAttack({
  attacker: canvas.tokens.controlled[0],
  targets: Array.from(game.user.targets),
  weapon: canvas.tokens.controlled[0].actor.items.get("weapon-id"),
});

await game.cprCombatAutomatism.resolveAttack(declaration, {
  defenderAction: "no-evade",
});
```
