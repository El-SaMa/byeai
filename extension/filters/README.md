# ByeAI filter list

Network rules live in `../rules/core-network.json` and are loaded as the `core_network` ruleset.

## Format

Each rule blocks requests matching a URL pattern for AI widgets, embeds, or LLM API hosts.

## Updates (planned)

Future versions may fetch a remote delta list and merge into dynamic rules. v1 ships a baked-in static list so blocking works offline on install.
