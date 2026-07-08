# Changelog

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
