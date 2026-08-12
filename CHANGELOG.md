# Changelog

## v0.1.13

- Fixed physical attack and damage cards being incorrectly styled as yellow netrunning rolls.
- Removed generic subtitle-based netrunning detection and replaced it with program-specific markers.
- Prioritized explicit CPR Combat Automatism and CPR Dice Uplink roll metadata over incidental card markup.
- Added regression coverage for physical combat, combat skills, neutral skills and native program damage palettes.

## v0.1.12

- Added rezzed-program target selection for anti-program attacks against Netrunners.
- Used the selected program's native DEF roll instead of the target Netrunner's Interface defense.
- Applied anti-program damage to the selected program's REZ instead of the target Netrunner.
- Added a program-only target prompt when external integrations provide a preselected anti-program attack.
- Used the attacking cyberdeck's native program damage rollcard against external Black ICE targets, with Black ICE damage selected by default.
- Removed Interface from unified roll breakdowns when the native program defense roll excludes it.
- Added contextual chat palettes managed centrally by CPR Combat Automatism.
- Kept attacks, initiative, damage, combat skills and combat requests from CPR Dice Uplink red.
- Styled non-combat skill, role and CPR Dice Uplink requests cyan.
- Styled Interface, program, Quickhack and other netrunning rolls yellow.
- Made optional CPR Dice Uplink and CPR Quickhacks detection safe when either module is absent.
- Added explicit compatibility with public/whisper cards and Haradan UI's high-specificity chat styles.
- Updated the minimum supported Cyberpunk RED CORE version to v0.92.5.

## v0.1.11

- Unified each attack flow into one progressively updated chat message instead of separate declaration, result and damage messages.
- Added a compact target table comparing DV, Evasion and Attack, with the winning result highlighted per target.
- Added on-demand roll breakdowns for Attack, Evasion and Damage; only one breakdown can be visible at a time.
- Aligned roll breakdown labels to the left and numeric values to the right.
- Added critical and fumble indicators, including native CPR critical detection for damage rolls.
- Added a compact damage table with one native damage action per hit target.
- Added a GM-only Apply to all action for applying native CPR damage to every hit target.
- Preserved native armor, ablation, ammunition, aimed-location and critical-damage handling while hiding duplicated native chat output.
- Closed the defender choice dialog directly after selecting Evade or No evade, including rapid clicks.
- Changed closing the defender choice prompt without selecting an option to resolve as No evade.
- Consolidated multi-target declarations and results into a single chat card.
- Changed DV ties to favor the defender, consistently with Evasion and other opposed defenses.
- Changed the attack summary to a two-column layout with wrapping values and native action labels.
- Improved spacing around the native chat-card mask.
- Simplified netrunning headers and labels by removing cyberdeck names from program headers and showing Interface or Atk according to the attacker.
- Added regression coverage for native CPR roll breakdown components.

## v0.1.10

- Added native netrunning attack support for Zap, attacker programs and Black ICE ATK.
- Added opposed netrunning defense rolls using Black ICE DEF, demon Interface or netrunner Interface defense.
- Allowed targets without Interface to still roll a native Interface defense card as a plain d10.
- Used native Cyberpunk RED rollcards for netrunning attack, defense and damage rolls.
- Added regression tests for netrunning attack options, declarations, socket validation and fallback defense behavior.

## v0.1.9

- Added a public `game.cprCombatAutomatism` API for external macros/modules to prepare, declare and resolve attacks.
- Added public helpers for defender choices and explicit Evasion/Concentration totals.
- Split attack declaration preparation from chat card creation so integrations can inspect declarations before dispatching prompts.
- Documented the public API in the README.
- Added regression tests for the public API surface and input normalization.

## v0.1.8

- Fixed Suppressive Fire resolution:
  - Targets no longer receive an Evade / No evade popup.
  - Targets always roll Concentration.
  - The attack roll is compared against each target's Concentration roll.
  - Damage is not rolled for Suppressive Fire.
- Removed extra debug-style chat messages from grouped attack resolution.
- Fixed hit/miss comparison messages so Evading targets are resolved against Evasion instead of weapon DV.
- Replaced redundant grouped hit summary messages with one definitive result message per target.
- Changed "hits no targets" style results to use the attacker name instead of the weapon name.

## v0.1.7

- Fixed weapon selection in the attack dialog so the declared attack uses the selected weapon instead of falling back to another weapon's DV table.
- Added shotgun ammo-aware DV handling:
  - Shotgun Slug uses `DV Shotgun (Slug)`.
  - Shotgun Shell uses fixed `DV 13` when no system roll table exists.
- Aligned loaded ammo detection with the native Cyberpunk RED weapon helper.
- Changed the attack declaration card weapon value to display the weapon type instead of the weapon name.
- Added regression tests for weapon selection, shotgun shell/slug DV handling, stale standard DV tables, and fixed shell DV.

## v0.1.6

- Used the attacker's selected fire mode when creating native attack rolls.
- Supported native Aimed Shot attack rolls from the module flow.
- Carried the selected aimed location into the native damage dialog.
- Preloaded Autofire damage multiplier from attack margin against DV or Evasion.
- Capped Autofire damage multiplier by the weapon Autofire maximum.
- Used the Autofire DV table while calculating hit DV for Autofire attacks.
- Added tests for fire modes, Aimed Shot locations and Autofire damage multiplier handling.

## v0.1.5

- Hardened socket handling with message type allowlisting, canonical attack data lookup and resolver/defender checks.
- Escaped generated chat message content before rendering it as HTML.
- Prevented multi-target attack groups from getting stuck when an Evasion roll cannot be completed.
- Delayed defender prompt claims until the popup has rendered successfully.
- Removed debug console logging from normal gameplay.
- Added Node-based quality checks, static scanner tests and coverage reporting.

## v0.1.4

- Closed the defender popup immediately after selecting Evade or No evade.
- Disabled both defender choice buttons after the first click.
- Prevented both choices from being submitted for the same attack.
- Pinned the release manifest URL to v0.1.4.

## v0.1.3

- First usable release of CPR Combat Automatism.
- Added guided attack declaration flow for Cyberpunk RED CORE.
- Added weapon selection from the selected attacker token.
- Added public attack declaration cards.
- Added defender popup with No evade and Evade choices.
- Added native attack, Evasion and damage roll delegation.
- Added version-pinned manifest and downloadable release ZIP.
