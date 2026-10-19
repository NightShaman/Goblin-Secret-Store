# Install Goblin Secret Store

### Requirements

- Burrow with Git mod sources, Settings/Archive mod UI, verified operator authentication context, agent discovery, and the `mod-authorized` tool and managed-reference bridge
- A Burrow server runtime that loads the mod; standalone CLI agent runs do not load mod hosts
- Node.js **22.13 or newer** (`node:sqlite`); tested with Node 22.23.2 and 24.20.0
- Durable storage for the Burrow runtime or a dedicated `GSS_DATA_DIR`
- HTTPS and a trusted network boundary

Goblin Secret Store has no npm runtime dependencies. See [API reference](api.md) for its authentication and tool contract.

### Add the mod to Burrow

1. Open **Settings → Mods → Mod sources**.
2. Add `https://github.com/GoblinKing-Burrow/Goblin-Secret-Store.git` as the Git repository URL.
3. Recheck the source and select **Goblin Secret Store** from the mod catalog.
4. Install a published version, then explicitly enable the mod. Installation alone does not enable it.
5. Open **Settings → Goblin Secret Store**.

Use a published version tag for stable installations. Review the [public releases](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/releases) before updating.


## After installation
Continue with [your first credential](credentials.md). Installing the mod does not create or back up your secrets for you.
