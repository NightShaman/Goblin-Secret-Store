import { mountManagement } from './management.js';

export const settingsSections = [
  { id: 'credentials', label: 'Credentials' },
  { id: 'sharing', label: 'Agent sharing' },
  { id: 'vault-access', label: 'Vault access' },
  { id: 'backup', label: 'Backup & restore' },
];

export function mountSettings({ section, primary, overflow, api }) {
  const root = document.createElement('section');
  primary.replace(root);
  const detailRoot = overflow ? document.createElement('section') : null;
  if (detailRoot) { detailRoot.className = 'gss'; overflow.replace(detailRoot); }
  const cleanup = mountManagement({ root, detailRoot, api, section });
  return () => { cleanup(); primary.clear(); overflow?.clear(); };
}
