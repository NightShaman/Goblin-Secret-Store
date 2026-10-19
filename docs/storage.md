# Storage, updates, and lifecycle

The default vault location is:

- `$BURROW_RUNTIME_ROOT/mods/mod-data/goblin-secret-store` when `BURROW_RUNTIME_ROOT` is configured;
- `/data/mods/mod-data/goblin-secret-store` in the stock container; or
- `$HOME/.local/share/goblin-secret-store` as the fallback.

Set `GSS_DATA_DIR` to an absolute path in the Burrow service environment to relocate it. Do not place it inside the mod source installation directory.

The vault directory is mode `0700`; `vault.sqlite` and `master.key` are mode `0600`. SQLite uses DELETE journal mode so there is no persistent WAL. Protected values are encrypted before being written to SQLite.

The data directory is separate from the installed mod source. Upgrade, re-enable, and restart retain it; uninstall intentionally leaves it behind. To erase the vault permanently, stop the mod and explicitly delete its data directory. Container deployments must place that directory—or its containing runtime root—on a persistent volume.

Do not run multiple Burrow instances against the same vault.


## Update deliberately

Export an encrypted backup before updating. Use Burrow’s mod management to install the intended published version and confirm the mod is enabled afterward. Keep the same durable data directory. Check Credentials and Agent sharing, then make a harmless authorized test. Restart invalidates local sessions and live handles, so unlock again and request fresh handles as needed.

A source-code reinstall does not recover missing storage. See [backup and recovery](backup.md).
