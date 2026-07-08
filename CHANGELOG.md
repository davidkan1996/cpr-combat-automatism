# Changelog

## v0.1.5

- Hardened socket handling with message type allowlisting, canonical attack data lookup and resolver/defender checks.
- Escaped generated chat message content before rendering it as HTML.
- Prevented multi-target attack groups from getting stuck when an Evasion roll cannot be completed.
- Delayed defender prompt claims until the popup has rendered successfully.
- Removed debug console logging from normal gameplay.
- Added Node-based quality checks, static scanner tests and coverage reporting.
