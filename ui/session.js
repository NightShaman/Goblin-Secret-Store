// Module-scoped, memory-only sessions. Mod loaders reuse this module across Settings and Archive.
const sessions = new Map();
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000;
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
    authenticated() { this.current(); return state.authenticated; },
    set(result) {
      const receivedAt = Date.now(), duration = result?.expiresInMs;
      if (typeof result?.session !== 'string' || !result.session || !Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_SESSION_DURATION_MS || !Number.isSafeInteger(receivedAt) || receivedAt > Number.MAX_SAFE_INTEGER - duration) throw new Error('Invalid vault session response.');
      state.token = result.session; state.expiresAt = receivedAt + duration; state.mode = 'local'; state.authenticated = true;
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
