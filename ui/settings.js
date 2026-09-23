/** Vault operations live in the full-width mod panel; Settings provides orientation only. */
export const settingsSections = [{ id: 'vault', label: 'Vault' }];
export function mountSettings({ primary, overflow }) {
  const section = document.createElement('section'); section.className = 'setting-section';
  const heading = document.createElement('h2'); heading.textContent = 'Goblin Secret Store';
  const description = document.createElement('p'); description.textContent = 'Manage credentials, agent access, audit history, and encrypted backups from the Goblin Secret Store panel. This settings view never handles vault passwords or protected values.';
  section.append(heading, description); primary.replace(section);
  if (overflow) { const note = document.createElement('p'); note.textContent = 'Agent access is denied by default and independent of tool grants. Restored assignments remain inactive until regranted.'; overflow.replace(note); }
  return () => { primary.clear(); overflow?.clear(); };
}
