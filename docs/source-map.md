# Source and coverage

This guide describes the public Goblin Secret Store release line **2026.10.19**. Check the installed mod version when comparing behavior.

| Area | Public source |
| --- | --- |
| Routes, limits, tool registration | [server/index.mjs](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/server/index.mjs) |
| Encryption, storage, access, restore | [server/store.mjs](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/server/store.mjs) |
| Credential, sharing, backup UI | [ui/management.js](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/ui/management.js) |
| Browser sessions | [ui/session.js](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/ui/session.js) |
| API contract | [API-CONTRACT.md](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/API-CONTRACT.md) |

The guide is checked against these sources. A successful documentation build is not a security certification or proof that your deployment and backups are safe. Verify your own network boundary, consumer behavior, and recovery procedure.

## Build the documentation

Use Python 3.12 and install `requirements-docs.txt`, then run:

```sh
python -m mkdocs build --strict
python scripts/docs/check_site.py site
```

The site is published from the public repository. See [releases](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/releases) and the [license](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/blob/main/LICENSE).
