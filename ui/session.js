// Module-scoped, memory-only sessions. Mod loaders reuse this module across Settings and Archive.
const sessions = new Map();
const key = (scope, modId) => `${scope}\0${modId}`;
export function vaultSession(scope, modId) {
  if (!scope || !modId) throw new Error('Vault requires an explicit runtime scope and mod identity.');
  const id = key(scope, modId);
  if (!sessions.has(id)) sessions.set(id, { token: '', expiresAt: 0, mode: null, authenticated: false, listeners: new Set() });
  const state = sessions.get(id);
  const clear = () => {
    const changed = Boolean(state.token || state.expiresAt || state.authenticated);
    state.token = ''; state.expiresAt = 0; state.authenticated = false;
    if (changed) for (const listener of [...state.listeners]) listener();
  };
  return {
    current() { if (state.token && state.expiresAt <= Date.now()) clear(); return state.token; },
    set(result) {
      if (typeof result?.session !== 'string' || !result.session || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('Invalid vault session response.');
      state.token = result.session; state.expiresAt = result.expiresAt; state.mode = 'local'; state.authenticated = true;
    },
    invalidate(token) { if (state.token === token) clear(); },
    observe(status, sentToken) {
      if (status.authMode !== 'local' && status.authMode !== 'core') throw new Error('Invalid vault authentication mode.');
      // Ignore an older status response after another mount has established a newer login.
      if (state.token !== sentToken) return;
      if (state.mode !== null && state.mode !== status.authMode) clear();
      state.mode = status.authMode;
      if (status.authMode === 'local' && (!status.initialized || (status.authenticated === false && state.token === sentToken))) clear();
      else if (status.authMode === 'core' && status.authenticated === false) clear();
      state.authenticated = status.authenticated === true;
    },
    subscribe(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  };
}
