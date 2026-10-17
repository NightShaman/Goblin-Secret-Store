import { vaultSession } from './session.js';
/** Operator-facing vault. Sensitive inputs live in this mount; the local session lives in scoped module memory. */
export function mountManagement({ root, detailRoot = null, api, section = 'credentials', runtimeScope, modId }) {
  const abort = new AbortController();
  const session = vaultSession(runtimeScope, modId);
  let live = true, status, records = [], templates = [], agents = [], selected = null, busy = false, loadGeneration = 0;
  function clearManagementState() {
    records = []; templates = []; agents = []; selected = null;
    content?.replaceChildren(); detailRoot?.replaceChildren();
  }
  function invalidateManagementState() {
    loadGeneration++;
    clearManagementState();
  }
  const el = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
  const button = (text, fn, className) => { const n = el('button', text, className); n.type = 'button'; n.addEventListener('click', fn); return n; };
  const label = (text, input) => { const n = el('label', text, 'gss-field'); n.append(input); return n; };
  const input = (type = 'text') => { const n = el('input'); n.type = type; return n; };
  const notice = el('p', '', 'gss-notice'); notice.setAttribute('role', 'status');
  const view = el('section', null, 'gss');
  const style = el('style'); style.textContent = `
.gss{box-sizing:border-box;width:100%;min-width:0;color:var(--text);line-height:1.5}.gss *{box-sizing:border-box}.gss [hidden]{display:none!important}
.gss h1{font-size:24px;margin:0}.gss h2{font-size:18px;margin:0 0 8px}.gss h3{font-size:14px;margin:16px 0 7px}.gss p{margin:6px 0 14px;overflow-wrap:anywhere}.gss .gss-muted{color:var(--text-muted,var(--muted))}.gss .gss-head,.gss .gss-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.gss .gss-head{justify-content:space-between;margin-bottom:20px}
.gss .gss-layout{display:grid;grid-template-columns:minmax(190px,260px) minmax(0,1fr);gap:24px;align-items:start}.gss .gss-list{display:grid;gap:5px}.gss .gss-list button{text-align:left;width:100%;overflow-wrap:anywhere}.gss .gss-list button[aria-current=true]{border-color:var(--accent-border);background:var(--accent-muted)}
.gss .gss-primary-panel{min-width:0}.gss .gss-panel{min-width:0;padding-left:24px;border-left:1px solid var(--line)}.gss .gss-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.gss .gss-field{display:grid;gap:5px;min-width:0;font-size:12px;font-weight:700;color:var(--text-muted,var(--muted))}.gss .gss-field input,.gss .gss-field select,.gss .gss-field textarea{width:100%;min-width:0;min-height:36px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface-input);color:var(--text);font:inherit}.gss .gss-field textarea{min-height:100px;resize:vertical}.gss .gss-masked-value{-webkit-text-security:disc;text-security:disc}.gss button{min-height:34px;padding:6px 11px;border:1px solid var(--line);border-radius:6px;background:var(--surface-input);color:var(--text);cursor:pointer;font:inherit}.gss button:hover:not(:disabled){border-color:var(--accent-border);background:var(--surface-hover)}.gss button:disabled{opacity:.55;cursor:not-allowed}.gss button.primary{border-color:var(--accent-border);background:var(--accent-muted);font-weight:700}.gss button.danger{border-color:var(--warning,var(--accent-border))}.gss .gss-actions{margin:16px 0}.gss .gss-notice:not(:empty){padding:9px 0}.gss .gss-notice[role=alert]{color:var(--warning,var(--accent))}.gss .gss-choice{display:flex;align-items:center;gap:8px;margin:6px 0}.gss .gss-choice input{accent-color:var(--accent)}.gss details{margin:22px 0;border-top:1px solid var(--line);padding-top:14px}.gss summary{cursor:pointer;font-weight:700}.gss .gss-audit{list-style:none;padding:0}.gss .gss-audit li{padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.gss .gss-confirm{padding:12px;border:1px solid var(--warning,var(--accent-border));border-radius:6px}.gss :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:760px){.gss .gss-layout{grid-template-columns:1fr}.gss .gss-panel{border-left:0;border-top:1px solid var(--line);padding:18px 0 0}.gss .gss-fields{grid-template-columns:1fr}}
`; view.append(style);
  const content = el('div'); view.append(content, notice); root.replaceChildren(view);
  const unsubscribe = session.subscribe(() => { if (!live) return; invalidateManagementState(); void load(); });
  const message = (text, error = false) => { notice.textContent = text; notice.setAttribute('role', error ? 'alert' : 'status'); };
  const err = e => e?.message || 'Request failed';
  async function request(path, options = {}) {
    const headers = { ...options.headers };
    const sentToken = session.current();
    if (sentToken) headers['X-GSS-Session'] = sentToken;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    try {
      const result = await api(path, { ...options, headers, signal: abort.signal });
      if (path === '/status') {
        if (session.current() !== sentToken) return request('/status');
        session.observe(result, sentToken);
      }
      return result;
    } catch (e) {
      if ((e?.status === 401 || e?.statusCode === 401) && path !== '/login' && path !== '/bootstrap') {
        session.invalidate(sentToken);
        clearManagementState();
      }
      throw e;
    }
  }
  const write = (path, method, body) => request(path, { method, body: JSON.stringify(body) });
  async function operation(action, success) {
    if (busy) return;
    busy = true; message('Working…');
    try { await action(); if (live) message(success); }
    catch (e) { if (live) message(err(e), true); }
    finally { busy = false; }
  }
  function logoutButton() {
    return button('Log out', () => void operation(async () => {
      const token = session.current();
      try { await request('/logout', { method: 'POST' }); }
      finally { session.invalidate(token); await load(); }
    }, 'Logged out.'));
  }
  function locked() {
    content.replaceChildren(el('h2', 'Unlock vault'));
    const first = status.authMode === 'local' && !status.initialized;
    if (first) content.append(el('p', 'First visitor on this trusted network can claim the vault. Isolate the service until the intended operator sets its password. Minimum 12 characters.'));
    else content.append(el('p', status.authMode === 'core' ? 'Sign in to Burrow with a verified operator login to manage this vault.' : 'Unlock this vault with its local password. Sessions stay in memory and expire after one hour.'));
    if (status.authMode !== 'local') return;
    const form = el('form'), password = input('password'); password.required = true; password.minLength = first ? 12 : 1; password.autocomplete = first ? 'new-password' : 'current-password';
    form.append(label(first ? 'Set vault password' : 'Vault password', password));
    let confirm;
    if (first) { confirm = input('password'); confirm.required = true; confirm.minLength = 12; confirm.autocomplete = 'new-password'; form.append(label('Confirm password', confirm)); }
    const submit = el('button', first ? 'Claim vault' : 'Unlock vault', 'primary'); submit.type = 'submit'; form.append(submit); content.append(form);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      if (confirm && password.value !== confirm.value) { message('Passwords do not match.', true); return; }
      const secret = password.value; password.value = ''; if (confirm) confirm.value = '';
      submit.disabled = true;
      await operation(async () => { const result = await write(first ? '/bootstrap' : '/login', 'POST', { password: secret }); if (!live) return; session.set(result); await load(); }, 'Vault unlocked.');
      if (live) submit.disabled = false;
    });
  }
  async function load() {
    const generation = ++loadGeneration;
    const current = () => live && generation === loadGeneration;
    try {
      const nextStatus = await request('/status'); if (!current()) return;
      status = nextStatus;
      if (!status.authenticated || !session.authenticated()) { clearManagementState(); locked(); return; }
      const [r, t, a] = await Promise.all([request('/records'), request('/templates'), request('/agents')]);
      if (!current() || !session.authenticated()) return;
      records = r.records; templates = t.templates; agents = Array.isArray(a) ? a : a.agents || [];
      if (selected && !records.some(record => record.id === selected)) selected = null;
      render();
    } catch (e) { if (current()) { content.replaceChildren(el('h2', 'Vault unavailable'), button('Retry', () => void load())); message(`Could not load vault: ${err(e)}`, true); } }
  }
  function render() {
    if (!session.authenticated()) { clearManagementState(); return; }
    if (section === 'backup') {
      content.replaceChildren();
      extras(content);
      if (status.authMode === 'local') content.append(logoutButton());
      detailRoot?.replaceChildren();
      return;
    }
    const layout = el('div', null, detailRoot ? 'gss-primary' : 'gss-layout'), sidebar = el('nav'), panel = el('section', null, detailRoot ? 'gss-primary-panel' : 'gss-panel');
    sidebar.setAttribute('aria-label', 'Credentials');
    const list = el('div', null, 'gss-list');
    if (!records.length) list.append(el('p', section === 'sharing' ? 'No credentials to share yet. Create one under Credentials first.' : 'No credentials yet. Create one to get started.', 'gss-muted'));
    for (const record of records) { const b = button(record.name, () => { if (!session.authenticated()) { clearManagementState(); return; } selected = record.id; render(); }); b.setAttribute('aria-current', String(selected === record.id)); list.append(b); }
    sidebar.append(list);
    if (status.authMode === 'local') sidebar.append(logoutButton());
    if (detailRoot) layout.append(panel);
    else layout.append(sidebar, panel);
    const record = records.find(r => r.id === selected);
    if (section === 'sharing' && record) access(panel, record);
    else if (section === 'credentials') editor(panel, record);
    else panel.append(el('h2', 'Select a credential'), el('p', section === 'sharing' ? 'Choose a credential to manage agent access.' : 'Names and public fields are metadata. Never put a secret in them.', 'gss-muted'));
    content.replaceChildren(layout);
    if (detailRoot) detailRoot.replaceChildren(sidebar);
  }
  function editor(panel, record) {
    const form = el('form'); form.append(el('h2', record ? 'Edit credential' : 'New credential'));
    const name = input(); name.required = true; name.maxLength = 256; name.value = record?.name || '';
    const template = el('select'); for (const t of templates) { const option = el('option', t.id.replaceAll('-', ' ')); option.value = t.id; template.append(option); } template.value = record?.template || templates[0]?.id || 'custom';
    const basics = el('div', null, 'gss-fields'); basics.append(label('Credential name (public)', name), label('Credential template', template)); form.append(basics);
    const fields = el('div'); form.append(el('h3', 'Fields'), el('p', 'Public fields are visible to authorized agents. Protected fields are write-only here. Leave an existing protected field blank to keep its value.', 'gss-muted'), fields);
    let draft = record ? record.fields.map(f => ({ ...f })) : templates.find(t => t.id === template.value)?.fields.map(f => ({ ...f })) || [];
    function captureFields() {
      for (const field of draft) {
        if (!field._nodes) continue;
        const { fieldName, fieldType, protectedBox, value, clear } = field._nodes;
        field.name = fieldName.value;
        field.type = fieldType.value;
        field.protected = protectedBox.checked;
        field.editValue = value.value;
        field.clear = clear?.checked || false;
      }
    }
    function drawFields() {
      fields.replaceChildren();
      for (const [index, field] of draft.entries()) {
        const row = el('div', null, 'gss-fields');
        const fieldName = input(); fieldName.value = field.name; fieldName.required = true; fieldName.maxLength = 128;
        const fieldType = el('select'); for (const type of ['text','url','username','credential','secret','token','password','private-key']) { const opt = el('option', type); opt.value = type; fieldType.append(opt); } fieldType.value = field.type;
        const protectedBox = input('checkbox'); protectedBox.checked = field.protected;
        // Keep private-key drafts in a textarea in both modes: password inputs normalize away line breaks.
        const privateKey = field.protected && field.type === 'private-key';
        const multiline = privateKey && field.keyVisible;
        const value = privateKey ? el('textarea') : input(field.protected ? 'password' : 'text');
        if (privateKey && !multiline) { value.className = 'gss-masked-value'; value.autocomplete = 'off'; value.spellcheck = false; }
        value.value = field.editValue ?? (field.protected ? '' : field.value || '');
        value.placeholder = field.protected && field.hasValue ? 'Stored — leave blank to keep' : '';
        row.append(label('Field key (public)', fieldName), label('Field type', fieldType), label(multiline ? 'Field value (visible while editing)' : 'Field value', value));
        if (privateKey) row.append(button(multiline ? 'Mask private key' : 'Enter multiline key (visible)', () => { captureFields(); field.keyVisible = !field.keyVisible; drawFields(); }));
        let clear; if (field.protected && field.hasValue) { clear = input('checkbox'); clear.checked = field.clear || false; const clearLabel = el('label', null, 'gss-choice'); clearLabel.append(clear, el('span', 'Replace stored value with an empty string')); row.append(clearLabel); }
        const toggle = el('label', null, 'gss-choice'); toggle.append(protectedBox, el('span', 'Protected (write-only)')); row.append(toggle);
        row.append(button('Remove field', () => { captureFields(); draft.splice(index, 1); drawFields(); })); fields.append(row);
        field._nodes = { fieldName, fieldType, protectedBox, value, clear };
        fieldType.addEventListener('change', () => { captureFields(); field.keyVisible = false; drawFields(); });
        protectedBox.addEventListener('change', () => { captureFields(); field.keyVisible = false; drawFields(); });
      }
    }
    drawFields();
    template.addEventListener('change', () => { if (record) { message('Changing a template retains the existing fields; adjust fields explicitly.'); return; } draft = templates.find(t => t.id === template.value)?.fields.map(f => ({ ...f })) || []; drawFields(); });
    form.append(button('Add field', () => { captureFields(); draft.push({ name: '', type: 'text', protected: false }); drawFields(); }));
    const actions = el('div', null, 'gss-actions'), save = el('button', 'Save credential', 'primary'); save.type = 'submit'; actions.append(save);
    if (record) actions.append(button('Create another credential', () => { selected = null; render(); }));
    if (record) actions.append(button('Delete credential', () => {
      const box = el('div', null, 'gss-confirm'); box.append(el('p', `Permanently delete “${record.name}”? Existing references will be revoked.`));
      box.append(button('Cancel', () => box.remove()), button('Confirm delete', () => void operation(async () => { await write(`/records/${encodeURIComponent(record.id)}`, 'DELETE', { version: record.version }); selected = null; await load(); }, 'Credential deleted.'), 'danger')); form.append(box);
    }, 'danger'));
    form.append(actions);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      captureFields();
      const fieldData = draft.map(f => {
        const next = { name: f.name.trim(), type: f.type, protected: f.protected };
        // Only the same protected field may omit value. Blank on a changed/new field is a literal blank.
        const unchanged = record?.fields.some(old => old.name === next.name && old.type === next.type && old.protected === next.protected && old.hasValue);
        if (!next.protected || f.editValue !== '' || f.clear || !unchanged) next.value = f.editValue ?? '';
        return next;
      });
      if (new Set(fieldData.map(f => f.name)).size !== fieldData.length || fieldData.some(f => !f.name)) { message('Each field needs a unique name.', true); return; }
      save.disabled = true;
      await operation(async () => {
        const result = await write(record ? `/records/${encodeURIComponent(record.id)}` : '/records', record ? 'PUT' : 'POST', { ...(record ? { version: record.version } : {}), name: name.value.trim(), template: template.value, fields: fieldData, acl: record?.acl || { mode: 'none', agents: [], active: true } });
        if (!live) return; selected = result.record.id; await load();
      }, 'Credential saved. Protected values cannot be viewed here.');
      if (live) save.disabled = false;
    });
    panel.append(form);
  }
  function access(panel, record) {
    const box = el('section'); box.append(el('h2', `Agent access · ${record.name}`), el('p', record.acl.active ? 'Explicit access is independent of Burrow tool grants.' : 'Restored assignment inactive. Regrant access explicitly; editing the record does not reactivate it.', 'gss-muted'));
    const mode = el('select'); for (const [value, text] of [['none', 'No agents'], ['agents', 'Selected agents'], ['all', 'All agents']]) { const option = el('option', text); option.value = value; mode.append(option); } mode.value = record.acl.mode; box.append(label('Access scope', mode));
    const choices = el('div'); const chosen = new Map(); for (const agent of agents) { const checkbox = input('checkbox'); checkbox.checked = record.acl.agents.includes(agent.id); checkbox.disabled = agent.enabled === false; chosen.set(agent.id, checkbox); const item = el('label', null, 'gss-choice'); item.append(checkbox, el('span', `${agent.name || agent.id}${agent.enabled === false ? ' · unavailable' : ''}`)); choices.append(item); }
    for (const id of record.acl.agents) if (!chosen.has(id)) choices.append(el('p', `${id} · unavailable; reassign access to remove this stale ID`, 'gss-muted'));
    box.append(choices);
    const sync = () => { choices.hidden = mode.value !== 'agents'; }; mode.addEventListener('change', sync); sync();
    box.append(button(record.acl.active ? 'Save access' : 'Regrant access', () => {
      const ids = [...chosen].filter(([, checkbox]) => checkbox.checked && !checkbox.disabled).map(([id]) => id);
      if (mode.value === 'agents' && !ids.length) { message('Choose at least one available agent.', true); return; }
      void operation(async () => { await write(`/records/${encodeURIComponent(record.id)}/acl`, 'PUT', { version: record.version, acl: { mode: mode.value, agents: mode.value === 'agents' ? ids : [], active: true } }); await load(); }, 'Agent access saved.');
    }, 'primary')); panel.append(box);
  }
  function extras(container) {
    const portability = el('section'); portability.append(el('h2', 'Encrypted backup and restore'));
    portability.append(el('p', 'Choose a separate backup passphrase (at least 12 characters). Keep the downloaded file and passphrase somewhere safe. Backups do not include this installation’s login password or audit history.', 'gss-muted'));
    const pass = input('password'); pass.minLength = 12; pass.autocomplete = 'new-password'; portability.append(label('Backup passphrase', pass));
    portability.append(button('Download encrypted backup', () => {
      if (pass.value.length < 12) { message('Backup passphrase must be at least 12 characters.', true); return; }
      const phrase = pass.value; pass.value = '';
      void operation(async () => {
        const { backup } = await write('/backup', 'POST', { passphrase: phrase }); if (!live) return;
        const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
        try { const link = el('a'); link.href = url; link.download = 'goblin-secret-store-backup.json'; link.style.display = 'none'; view.append(link); link.click(); link.remove(); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
      }, 'Encrypted backup downloaded.');
    }));
    const restore = el('details'); restore.append(el('summary', 'Restore backup — replaces all credentials'));
    restore.append(el('p', 'Restore permanently replaces every current credential. All restored agent assignments will be inactive until you explicitly regrant them, including assignments to matching IDs. The current login password remains unchanged.', 'gss-muted'));
    const file = input('file'); file.accept = '.json,application/json'; restore.append(label('Encrypted backup file', file));
    const restorePass = input('password'); restorePass.autocomplete = 'off'; restore.append(label('Backup passphrase', restorePass));
    const confirm = input(); confirm.autocomplete = 'off'; restore.append(label('Type RESTORE to replace all credentials', confirm));
    restore.append(button('Replace credentials from backup', () => {
      if (!file.files?.[0] || !restorePass.value || confirm.value !== 'RESTORE') { message('Choose a backup, enter its passphrase, and type RESTORE.', true); return; }
      const phrase = restorePass.value, selectedFile = file.files[0]; restorePass.value = ''; confirm.value = ''; file.value = '';
      void operation(async () => { const backup = await selectedFile.text(); const result = await write('/restore', 'POST', { backup, passphrase: phrase }); selected = null; await load(); return result.restored; }, 'Restore completed. Regrant agent access explicitly.');
    }, 'danger')); portability.append(restore); container.append(portability);
  }
  content.replaceChildren(el('p', 'Loading vault…'));
  void load();
  return () => { live = false; unsubscribe(); abort.abort(); clearManagementState(); root.replaceChildren(); };
}
