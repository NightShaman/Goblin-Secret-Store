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

## Review checkpoint: 21 October 2026

All pages in this section were reconciled from the [2026.10.19 runtime baseline](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/tree/9641ab88741716e1aff6ad2601dc50f992411aa9) through [public source `80b264f`](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/tree/80b264fd14e4eb1d503a57772b214099991b50a1). The public runtime implementation is unchanged across that interval; documentation changes do not imply a new runtime release. Core-dependent and forthcoming managed-skill behavior is identified separately in the relevant guides.

The original guides named the release line but did not pin every page to a commit. This review uses the published release snapshot and repository history as the baseline, rather than assuming an undocumented per-page source revision.

## Test prerequisites and public-snapshot limitation

`npm run build` performs JavaScript syntax checks. Full `npm test` also imports a compatible Core checkout (`BURROW_CORE_ROOT`), its installed dependencies, and PostgreSQL 17 with pgvector; the fixture owns a disposable cluster and must run as a non-root user.

The 2026.10.19 public snapshot retains `server/development-release-workflow.test.mjs` but excludes the development release workflow it reads. The aggregate suite fails on that missing file. A focused unit-test pass or a documentation build must not be reported as a passing full integration suite.
