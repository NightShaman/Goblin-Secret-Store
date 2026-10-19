# Export, import, and recover

!!! danger "Restore replaces the destination vault"
    Restore is not a merge. Export the destination first if its credentials matter. Every restored assignment must be reviewed and explicitly regranted.

## Portable encrypted export and restore

**Settings → Goblin Secret Store → Backup & restore** can export a passphrase-encrypted portable backup containing all records and the source encryption material needed for a clean-install restore. The passphrase must be 12–1024 UTF-16 code units.

**Restore replaces every current credential; it does not merge records.** Export a backup of the destination first if you need to preserve its current contents.

1. On the destination installation, enable the mod and authenticate in Settings (or claim its local management password).
2. Open **Backup & restore → Restore backup — replaces all credentials**.
3. Select the unchanged backup file, enter its backup passphrase, and type `RESTORE`.
4. Select **Replace credentials from backup**.
5. Review each restored record under **Agent sharing** and select **Regrant access** for the intended agents.

A restore:

- validates and decrypts the complete archive before changing the vault;
- replaces records in one SQLite transaction;
- re-encrypts protected values under the destination installation key;
- preserves the destination's local management password;
- excludes sessions, audit history, and live managed references; and
- restores every ACL as inactive, including ACLs whose agent IDs still exist.

After restoring, explicitly review and reassign every ACL. Keep the archive unchanged between export and restore, preserve its passphrase separately, and test recovery regularly.

For an ordinary filesystem-copy backup or restore, stop the mod first and preserve **both** `vault.sqlite` and its matching `master.key` as a consistent pair. Protect that copy: anyone with both files can decrypt the protected fields. Restart only after the pair is in the configured data directory with the correct service ownership and permissions.

An existing database with a missing key or a key of the wrong length fails startup. A different 32-byte key cannot decrypt its protected fields. Restore the matching key or recover a portable backup into a separate clean installation; do not delete the existing database to bypass a key error.

The local management password cannot recreate a lost master key. Losing the matching key and all usable portable backups means losing the protected values.


## What import means here

GSS imports its own encrypted portable backup through **Backup & restore**. It does not provide CSV import, browser-password import, or a merge-import tool. Add credentials from other systems manually, keeping secrets in protected fields.

## Recovery drill

1. Download a backup and store its passphrase separately.
2. Prepare a separate clean, trusted installation with durable storage.
3. Restore there and confirm the expected record names and field metadata.
4. Regrant only a test agent and verify an authorized use without printing the secret.
5. Protect or remove the test installation according to your own retention policy.

Do not test a restore against your only live vault.
