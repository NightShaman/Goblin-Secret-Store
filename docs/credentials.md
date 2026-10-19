# Create and edit credentials

1. Confirm the vault storage path is on durable storage. See [Storage and lifecycle](storage.md).
2. Open **Settings → Goblin Secret Store → Credentials**.
3. If Burrow authentication is enabled, your authenticated operator session is used automatically. Otherwise, the first visitor must **Claim vault** with a local password of at least 12 characters on a trusted, isolated network. On later visits, use **Unlock vault**.
4. Name the credential, choose a template, and enter its fields. Keep sensitive values in fields marked **Protected (write-only)**. Credential names and field keys are public metadata.
5. Select **Save credential**. New credentials start with no agent access.
6. Open **Agent sharing**, select the credential, and choose **Selected agents** or **All agents** under **Access scope**. Select **Save access**. All agents includes future agents.
7. Ask an authorized agent to use the credential as described below.
8. Open **Backup & restore**, download an encrypted backup, and complete a restore drill before relying on the vault.

Audit history lives in **Archive → MODS → Goblin Secret Store**.


## Choose a template

| Template | Starting fields |
| --- | --- |
| token | Protected token |
| id secret | Public ID, protected secret |
| user pass | Public username, protected password |
| ssh key | Public username, protected privateKey |
| custom | No initial fields; add your own |

The template supplies a starting shape. Check **Protected (write-only)** for every sensitive field, including any field you add yourself. New fields start public. The field type alone does not make a value protected.

Private keys can be entered in multiline mode using **Enter multiline key (visible)**. This makes the draft visible on screen; use it only where nobody else can see your display.

## Replace or clear a value

Protected fields are write-only in Settings: saved values cannot be revealed or copied back out. For an existing protected field with the same name and type, leave its value blank to keep it, enter a new value to replace it, or select **Replace stored value with an empty string** to clear it.

Renaming a field, changing its type, or changing whether it is protected changes that field's identity. Supply its intended value again; a blank changed field does not retain the old secret. Changing an existing credential's template keeps its fields until you adjust them explicitly.

Use **Agent sharing → Save access** to change permissions. After a restore, use **Regrant access**; editing and saving the credential alone does not reactivate its restored assignment.


## Delete a credential

Select the record, choose **Delete credential**, then **Confirm delete**. This removes the record and prevents future use through it, but cannot retract values already used outside the vault. A previous portable backup may still contain that credential.
