import { mountManagement } from './management.js';
export const settingsSections = [{ id: 'vault', label: 'Vault' }];
export function mountSettings({ primary, overflow, api }) {
  const root = document.createElement('section');
  primary.replace(root);
  const cleanup = mountManagement({ root, api });
  return () => { cleanup(); primary.clear(); overflow?.clear(); };
}
