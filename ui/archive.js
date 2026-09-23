/** Read-only audit. Authentication and records remain owned by this mod. */
export function mountArchive({ root, api, date = '' }) {
  const abort = new AbortController();
  let live = true, session = '', cursor = null, busy = false, refreshPending = false;
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const content = el('section'), notice = el('p'); notice.setAttribute('role', 'status');
  root.replaceChildren(content, notice);
  const request = (path, init = {}) => api(path, { ...init, signal: abort.signal, headers: { 'content-type': 'application/json', ...(session ? { 'X-GSS-Session': session } : {}) } });
  const button = (text, fn) => { const n = el('button', text); n.type = 'button'; n.addEventListener('click', fn); return n; };
  async function run(fn) {
    if (!live || busy) return;
    busy = true; notice.textContent = 'Loading…';
    try { await fn(); if (live) notice.textContent = ''; }
    catch (e) { if (live) { notice.textContent = e?.message || 'Audit unavailable'; notice.setAttribute('role', 'alert'); if (e?.status === 401 || e?.statusCode === 401) { session = ''; content.replaceChildren(button('Sign in again', () => run(load))); } } }
    finally { busy = false; if (live && refreshPending) { refreshPending = false; void run(load); } }
  }
  async function load() {
    const requestedDate = date;
    const status = await request('/status'); if (!live || requestedDate !== date) return;
    content.replaceChildren(el('h2', 'Goblin Secret Store audit'));
    if (!status.authenticated) {
      if (status.authMode !== 'local' || !status.initialized) { content.append(el('p', status.authMode === 'local' ? 'Initialize the vault in Settings before reading audit history.' : 'Sign in to Burrow to read audit history.')); return; }
      const form = el('form'), label = el('label', 'Vault password'), password = el('input'); password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
      label.append(password); const submit = el('button', 'Unlock audit'); submit.type = 'submit'; form.append(label, submit); content.append(form);
      form.addEventListener('submit', e => { e.preventDefault(); const value = password.value; password.value = ''; void run(async () => { const result = await request('/login', { method: 'POST', body: JSON.stringify({ password: value }) }); if (!live) return; session = result.session; await load(); }); });
      return;
    }
    content.append(el('p', date ? `UTC date: ${date}` : 'All dates (UTC).'));
    if (status.authMode === 'local') content.append(button('Log out', () => run(async () => { try { await request('/logout', { method: 'POST' }); } finally { session = ''; if (live) await load(); } })));
    const list = el('ul'), more = button('Load earlier audit events', () => run(page)); content.append(list, more); cursor = null;
    async function page() {
      const query = new URLSearchParams({ ...(requestedDate ? { date: requestedDate } : {}), ...(cursor ? { before: cursor } : {}) });
      const data = await request(`/audit?${query}`); if (!live || requestedDate !== date) return;
      for (const event of data.events) list.append(el('li', `${event.at} · ${event.action} · ${event.outcome}${event.agentId ? ` · ${event.agentId}` : ''}${event.recordId ? ` · ${event.recordId}` : ''}`));
      cursor = data.nextCursor; more.hidden = !cursor;
      if (!list.children.length) list.append(el('li', 'No audit events for this date.'));
    }
    await page();
  }
  void run(load);
  return {
    update(context) {
      if (!live || context.date === date) return;
      date = context.date;
      cursor = null;
      content.replaceChildren(); // Never label old records with the newly selected date.
      if (busy) refreshPending = true;
      else void run(load);
    },
    unmount() { live = false; session = ''; refreshPending = false; abort.abort(); root.replaceChildren(); },
  };
}
