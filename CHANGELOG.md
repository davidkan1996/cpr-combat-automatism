# Changelog

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
