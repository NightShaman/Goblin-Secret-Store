<div class="burrow-hero" markdown>

![Goblin Secret Store](assets/hero.png){ .gss-hero-art }

# Your credentials. Explicit agent access.

Goblin Secret Store keeps protected credential fields encrypted at rest in Burrow. Add a credential, choose which agents may use it, and keep a tested recovery copy.

[Install GSS](installation.md){ .md-button .md-button--primary }
[Add your first credential](credentials.md){ .md-button }

Public-release guide · **2026.10.19**

</div>

!!! danger "Secrets still carry real risk."
    **An authorized agent or program can use and disclose your credentials.** GSS does not protect against a compromised host, operator, service account, or authorized consumer. Anyone with the database and its matching master key can decrypt protected values. Use HTTPS, a trusted host, narrowly scoped credentials, and explicit grants. Never put secrets in public names or fields. Losing the key and all usable backups means losing the protected values.

## Start with one credential

1. [Install and enable the mod](installation.md) in a working Burrow server.
2. [Sign in or claim the vault](authentication.md) on a trusted network.
3. [Create a credential](credentials.md), keeping sensitive values protected.
4. [Grant selected agents access](access.md), then [use a managed reference](agents.md).
5. [Export an encrypted backup and test recovery](backup.md).

<div class="grid cards" markdown>

- **Keep protected fields out of routine reads**

    Saved protected values are write-only in Settings. Agents receive short-lived handles for compatible tools.

    [Credentials and editing →](credentials.md)

- **Choose who gets access**

    New records have no agent access. All agents includes future agents; logging out does not revoke grants.

    [Access control →](access.md)

- **Recover without surprises**

    Portable restore replaces all destination credentials and leaves every restored assignment inactive.

    [Export, import, and recovery →](backup.md)

- **Understand the boundary**

    Encryption at rest does not make a trusted host or receiving program safe.

    [Security and trust →](security.md)

</div>

## What GSS does not do

GSS is not a general password manager. There is no cloud sync, OAuth brokerage, automatic credential rotation, browser autofill, or CSV import. The mod runs inside the Burrow server; standalone CLI agent runs do not load it.

## Help and reference

- [Storage and updates](storage.md), [configuration](configuration.md), and [troubleshooting](troubleshooting.md)
- [API reference](api.md) and [source coverage](source-map.md)
- [Burrow documentation](https://burrow-docs.blissful-psychosis.com/)
- [Public repository](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store), [releases](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/releases), and [issues](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/issues)
