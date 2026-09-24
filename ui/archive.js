import { vaultSession } from './session.js';

/** Read-only audit. Authentication and records remain owned by this mod. */
export function mountArchive({ root, api, date = '', runtimeScope, modId }) {
  const abort = new AbortController();
  const session = vaultSession(runtimeScope, modId);
  let live = true, cursor = null, busy = false, refreshPending = false;
  const el = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const view = el('section', null, 'gss-archive');
  const style = el('style');
  style.textContent = `
.gss-archive{box-sizing:border-box;width:100%;min-width:0;color:var(--text);line-height:1.5}
.gss-archive *{box-sizing:border-box}.gss-archive [hidden]{display:none!important}
.gss-archive h2{font-size:20px;margin:0 0 4px;color:var(--text-strong,var(--text))}
.gss-archive p{margin:0;overflow-wrap:anywhere}
.gss-archive .gss-archive-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.gss-archive .gss-archive-muted{color:var(--muted)}
.gss-archive button{min-height:36px;padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface-input);color:var(--text);font:inherit;cursor:pointer}
.gss-archive button:hover:not(:disabled){border-color:var(--accent-border);background:var(--surface-hover)}
.gss-archive button:disabled{opacity:.55;cursor:not-allowed}
.gss-archive button.gss-archive-primary{border-color:var(--accent-border);background:var(--accent-muted);font-weight:700}
.gss-archive button:focus-visible,.gss-archive input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.gss-archive .gss-archive-gate{max-width:480px;display:grid;gap:14px}
.gss-archive .gss-archive-gate form{display:grid;gap:12px}
.gss-archive .gss-archive-gate label{display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--muted)}
.gss-archive input{width:100%;min-width:0;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface-input);color:var(--text);font:inherit}
.gss-archive .gss-archive-gate button{justify-self:start}
.gss-archive .gss-archive-table-wrap{max-width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:8px}
.gss-archive table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}
.gss-archive th,.gss-archive td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.gss-archive th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--surface-input);white-space:nowrap}
.gss-archive tbody tr:last-child td{border-bottom:0}
.gss-archive td{overflow-wrap:anywhere}.gss-archive td:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.gss-archive .gss-archive-outcome{font-weight:700}.gss-archive .gss-archive-denied{color:var(--warn)}
.gss-archive .gss-archive-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}.gss-archive .gss-archive-empty{padding:24px 0;color:var(--muted)}
.gss-archive .gss-archive-notice:not(:empty){margin:12px 0;color:var(--muted)}
.gss-archive .gss-archive-notice[role=alert]{color:var(--warn)}
@media(max-width:650px){.gss-archive th,.gss-archive td{padding:9px 10px}.gss-archive td:first-child{white-space:normal;min-width:125px}}
`;
  const content = el('div'), notice = el('p', '', 'gss-archive-notice'); notice.setAttribute('role', 'status');
  view.append(style, content, notice);
  root.replaceChildren(view);
  async function request(path, init = {}) {
    const sentToken = session.current();
    try {
      const result = await api(path, { ...init, signal: abort.signal, headers: { 'content-type': 'application/json', ...(sentToken ? { 'X-GSS-Session': sentToken } : {}) } });
      if (path === '/status') {
        if (session.current() !== sentToken) return request('/status');
        session.observe(result, sentToken);
      }
      return result;
    } catch (e) {
      if ((e?.status === 401 || e?.statusCode === 401) && path !== '/login') session.invalidate(sentToken);
      throw e;
    }
  }
  const button = (text, fn, className) => { const n = el('button', text, className); n.type = 'button'; n.addEventListener('click', fn); return n; };
  async function run(fn) {
    if (!live || busy) return;
    busy = true; notice.textContent = 'Loading…'; notice.setAttribute('role', 'status');
    try { await fn(); if (live) notice.textContent = ''; }
    catch (e) {
      if (live) {
        notice.textContent = e?.message || 'Audit unavailable'; notice.setAttribute('role', 'alert');
        if (e?.status === 401 || e?.statusCode === 401) content.replaceChildren(button('Sign in again', () => run(load)));
      }
    } finally { busy = false; if (live && refreshPending) { refreshPending = false; void run(load); } }
  }
  function heading(description, action) {
    const head = el('header', null, 'gss-archive-head'), title = el('div');
    title.append(el('h2', 'Vault audit'), el('p', description, 'gss-archive-muted'));
    head.append(title); if (action) head.append(action);
    content.replaceChildren(head);
  }
  async function load() {
    const requestedDate = date;
    const status = await request('/status'); if (!live || requestedDate !== date) return;
    if (!status.authenticated) {
      heading('Credential access and vault activity, recorded by Goblin Secret Store.');
      const gate = el('div', null, 'gss-archive-gate');
      if (status.authMode !== 'local' || !status.initialized) {
        gate.append(el('p', status.authMode === 'local' ? 'Initialize the vault in Settings before reading audit history.' : 'Sign in to Burrow to read audit history.'));
        content.append(gate); return;
      }
      gate.append(el('p', 'Unlock the vault to see its audit history. Your password is not stored in this page.', 'gss-archive-muted'));
      const form = el('form'), label = el('label', 'Vault password'), password = el('input');
      password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
      label.append(password);
      const submit = el('button', 'Unlock audit', 'gss-archive-primary'); submit.type = 'submit';
      form.append(label, submit); gate.append(form); content.append(gate);
      form.addEventListener('submit', e => {
        e.preventDefault(); const value = password.value; password.value = '';
        void run(async () => { const result = await request('/login', { method: 'POST', body: JSON.stringify({ password: value }) }); if (!live) return; session.set(result); await load(); });
      });
      return;
    }
    const logout = status.authMode === 'local' ? button('Log out', () => run(async () => {
      const token = session.current();
      try { await request('/logout', { method: 'POST' }); }
      finally { session.invalidate(token); if (live) await load(); }
    })) : null;
    heading(date ? `Activity on ${date} (UTC)` : 'All recorded activity · UTC', logout);
    const results = el('div'), footer = el('div', null, 'gss-archive-footer');
    let body, count = 0;
    const more = button('Load earlier events', () => run(page));
    footer.append(more); content.append(results, footer); cursor = null;
    async function page() {
      const query = new URLSearchParams({ ...(requestedDate ? { date: requestedDate } : {}), ...(cursor ? { before: cursor } : {}) });
      const data = await request(`/audit?${query}`); if (!live || requestedDate !== date) return;
      if (!results.children.length && !data.events.length) results.append(el('p', requestedDate ? 'No vault activity for this date.' : 'No vault activity yet.', 'gss-archive-empty'));
      else {
        if (!body) {
          const wrap = el('div', null, 'gss-archive-table-wrap'), table = el('table'), head = el('thead'), header = el('tr');
          table.setAttribute('aria-label', 'Vault audit events');
          for (const text of ['Time (UTC)', 'Action', 'Result', 'Agent', 'Credential']) header.append(el('th', text));
          head.append(header); body = el('tbody'); table.append(head, body); wrap.append(table); results.replaceChildren(wrap);
        }
        for (const event of data.events) {
          const row = el('tr');
          const time = el('td'); const parsed = Date.parse(event.at);
          if (Number.isFinite(parsed)) {
            const stamp = el('time', new Date(parsed).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }));
            stamp.dateTime = event.at; time.append(stamp);
          } else time.textContent = event.at || 'Time unavailable';
          const outcome = el('td', event.outcome || '—', `gss-archive-outcome${event.outcome === 'denied' ? ' gss-archive-denied' : ''}`);
          const credential = typeof event.recordName === 'string' && event.recordName.trim()
            ? event.recordName : event.recordId ? `ID: ${event.recordId}` : '—';
          row.append(time, el('td', event.action || '—'), outcome, el('td', event.agentId || '—'), el('td', credential));
          body.append(row); count++;
        }
      }
      const total = el('span', `${count} ${count === 1 ? 'event' : 'events'} shown`, 'gss-archive-muted');
      footer.replaceChildren(total, more);
      cursor = data.nextCursor; more.hidden = !cursor;
    }
    await page();
  }
  void run(load);
  return {
    update(context) {
      if (!live || context.date === date) return;
      date = context.date; cursor = null;
      content.replaceChildren(); // Never label old records with the newly selected date.
      if (busy) refreshPending = true;
      else void run(load);
    },
    unmount() { live = false; refreshPending = false; abort.abort(); root.replaceChildren(); },
  };
}
