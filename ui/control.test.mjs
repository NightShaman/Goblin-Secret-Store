import { mountArchive } from './archive.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountManagement as mountControl } from './management.js';
import { settingsSections, mountSettings } from './settings.js';
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.textContent = ''; this.value = ''; this.style = {}; this.files = []; this.hidden = false; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(k, v) { this[k] = v; }
  addEventListener(k, fn) { this.listeners.set(k, fn); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  click() { return this.listeners.get('click')?.(); }
  fire(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(handler, fn, section = 'credentials') {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root'), calls = [];
  const cleanup = mountControl({ root, section, api: async (path, init) => { calls.push([path, init]); return handler(path, init); } });
  try { await flush(); await fn({ root, calls, find: (tag, text) => root.descendants().find(n => n.tagName === tag && n.textContent === text) }); }
  finally { cleanup(); globalThis.document = previous; }
}
const base = (path) => {
  if (path === '/status') return { authMode: 'core', authenticated: true, initialized: false };
  if (path === '/templates') return { templates: [{ id: 'token', fields: [{ name: 'token', type: 'token', protected: true }] }, { id: 'custom', fields: [] }] };
  if (path === '/agents') return [{ id: 'a', name: 'Agent A', enabled: true }];
};
test('first-visitor claim uses POST bootstrap and retains session in memory only', async () => fixture((path, init) => {
  if (path === '/status') return { authMode: 'local', initialized: false, authenticated: init?.headers?.['X-GSS-Session'] === 'local-session' };
  if (path === '/bootstrap') return { session: 'local-session', expiresAt: Date.now() + 1000 };
  if (path === '/records') return { records: [] };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.match(root.descendants().map(n => n.textContent).join(' '), /First visitor on this trusted network/);
  const passwords = root.descendants().filter(n => n.type === 'password'); passwords.forEach(n => n.value = 'long-vault-password');
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/bootstrap')[1].body), { password: 'long-vault-password' });
  assert.equal(calls.find(c => c[0] === '/records')[1].headers['X-GSS-Session'], 'local-session');
  assert.equal(passwords[0].value, ''); assert.ok(find('button', 'New credential'));
}));
test('editing omits existing protected value but retains public value', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Example', template: 'token', version: 2, fields: [{ name: 'token', type: 'token', protected: true, hasValue: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r' && init?.method === 'PUT') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  find('button', 'Example').click();
  assert.equal(find('button', 'Save access'), undefined);
  const form = root.descendants().find(n => n.tagName === 'form'); await form.fire('submit'); await flush();
  const saved = JSON.parse(calls.find(c => c[0] === '/records/r' && c[1]?.method === 'PUT')[1].body);
  assert.deepEqual(saved.fields, [{ name: 'token', type: 'token', protected: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }]);
}));
test('agent sharing requires explicit all-agent confirmation and excludes credential editing', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Example', template: 'token', version: 2, fields: [], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r/acl') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.equal(find('button', 'New credential'), undefined);
  find('button', 'Example').click();
  assert.equal(find('button', 'Save credential'), undefined);
  const scope = root.descendants().find(n => n.tagName === 'select' && n.parent?.textContent === 'Access scope'); scope.value = 'all'; scope.fire('change');
  find('button', 'Save access').click(); await flush(); assert.equal(calls.some(c => c[0] === '/records/r/acl'), false);
  root.descendants().find(n => n.tagName === 'input' && n.parent?.children.some(c => c.textContent === 'I understand this grants every agent access to this credential.')).checked = true;
  find('button', 'Save access').click(); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/records/r/acl')[1].body).acl, { mode: 'all', agents: [], active: true });
}, 'sharing'));
test('restore is gated by phrase, file, and typed confirmation; presents inactive ACL warning', async () => fixture((path, init) => {
  if (path === '/records') return { records: [] };
  if (path === '/restore') return { ok: true, restored: 1 };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.match(root.descendants().map(n => n.textContent).join(' '), /All restored agent assignments will be inactive/);
  const restore = find('button', 'Replace credentials from backup'); restore.click(); await flush(); assert.equal(calls.some(c => c[0] === '/restore'), false);
  root.descendants().find(n => n.type === 'file').files = [{ text: async () => '{"encrypted":true}' }];
  const field = root.descendants().filter(n => n.textContent === 'Backup passphrase' && n.children[0]?.type === 'password').at(-1); field.children[0].value = 'strong-backup-passphrase';
  root.descendants().find(n => n.textContent === 'Type RESTORE to replace all credentials').children[0].value = 'RESTORE';
  restore.click(); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/restore')[1].body), { backup: '{"encrypted":true}', passphrase: 'strong-backup-passphrase' });
  assert.equal(field.children[0].value, '');
}, 'backup'));
test('settings mounts management without duplicate audit', async () => {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  try {
    const primary = { replace(node) { this.node = node; }, clear() { this.node = null; } };
    const cleanup = mountSettings({ section: 'credentials', primary, api: async path => path === '/records' ? { records: [] } : base(path) });
    await flush();
    assert.deepEqual(settingsSections.map(s => s.id), ['credentials', 'sharing', 'vault-access', 'backup']);
    const text = primary.node.descendants().map(n => n.textContent).join(' ');
    assert.match(text, /New credential/); assert.doesNotMatch(text, /Audit history/);
    cleanup(); assert.equal(primary.node, null);
  } finally { globalThis.document = old; }
});
test('each Settings selection mounts only its own management surface and clears contextual column', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const api = async path => path === '/records' ? { records: [{ id: 'r', name: 'Existing', template: 'custom', version: 1, fields: [], acl: { mode: 'none', agents: [], active: true } }] } : base(path);
  const primary = { replace(node) { this.node = node; }, clear() { this.node = null; } };
  const overflow = { replace(node) { this.node = node; }, clear() { this.node = null; } };
  const has = (text) => primary.node.descendants().some(n => n.textContent === text);
  try {
    for (const [section, visible, absent] of [
      ['credentials', 'New credential', 'Download encrypted backup'],
      ['sharing', 'Choose a credential to manage agent access.', 'New credential'],
      ['vault-access', 'Vault access', 'New credential'],
      ['backup', 'Download encrypted backup', 'New credential'],
    ]) {
      const cleanup = mountSettings({ section, primary, overflow, api }); await flush();
      assert.ok((section === 'credentials' ? overflow.node : primary.node).descendants().some(n => n.textContent === visible), `${section} should show ${visible}`);
      assert.ok(![...primary.node.descendants(), ...overflow.node.descendants()].some(n => n.textContent === absent), `${section} should not show ${absent}`);
      assert.ok(!has('Audit history'));
      if (section === 'sharing') {
        overflow.node.descendants().find(n => n.tagName === 'button' && n.textContent === 'Existing').click();
        assert.ok(has('Save access'));
        assert.ok(overflow.node.descendants().some(n => n.textContent === 'Existing'));
      }
      cleanup(); assert.equal(primary.node, null); assert.equal(overflow.node, null);
    }
  } finally { globalThis.document = previous; }
});
test('new credential uses template fields and defaults to denied ACL', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [] };
  if (path === '/records' && init?.method === 'POST') return { record: { id: 'created' } };
  return base(path);
}, async ({ root, calls, find }) => {
  find('button', 'New credential').click();
  const form = root.descendants().find(n => n.tagName === 'form');
  root.descendants().find(n => n.textContent === 'Name (public metadata)').children[0].value = 'Token';
  await form.fire('submit'); await flush();
  const payload = JSON.parse(calls.find(c => c[0] === '/records' && c[1]?.method === 'POST')[1].body);
  assert.deepEqual(payload, { name: 'Token', template: 'token', fields: [{ name: 'token', type: 'token', protected: true, value: '' }], acl: { mode: 'none', agents: [], active: true } });
}));
test('local logout clears the session header on subsequent status requests', async () => fixture((path, init) => {
  if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init?.headers?.['X-GSS-Session'] === 'session' };
  if (path === '/login') return { session: 'session', expiresAt: Date.now() + 10000 };
  if (path === '/logout') return { ok: true };
  if (path === '/records') return { records: [] };
  return base(path);
}, async ({ root, calls, find }) => {
  root.descendants().find(n => n.type === 'password').value = 'password';
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  find('button', 'Log out').click(); await flush();
  assert.equal(calls.find(c => c[0] === '/logout')[1].headers['X-GSS-Session'], 'session');
  assert.equal(calls.filter(c => c[0] === '/status').at(-1)[1].headers['X-GSS-Session'], undefined);
}, 'vault-access'));
const labeled = (root, text) => root.descendants().find(n => n.tagName === 'label' && n.textContent === text)?.children[0];
const rows = root => root.descendants().filter(n => n.className === 'gss-fields' && n.children.some(c => c.textContent === 'Field name'));
const rowInput = (row, label) => row.children.find(c => c.textContent === label)?.children[0];

test('add and remove preserve unsaved field edits, protected replacement, and clear intent', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Old', template: 'custom', version: 2, fields: [
    { name: 'public', type: 'text', protected: false, value: 'old' },
    { name: 'secret', type: 'secret', protected: true, hasValue: true },
    { name: 'erase', type: 'secret', protected: true, hasValue: true },
  ], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r' && init?.method === 'PUT') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  find('button', 'Old').click();
  let [publicRow, secretRow, eraseRow] = rows(root);
  rowInput(publicRow, 'Field name').value = 'renamed';
  rowInput(publicRow, 'Type').value = 'url';
  rowInput(publicRow, 'Value').value = 'https://new.example';
  rowInput(secretRow, 'Value').value = 'replacement';
  eraseRow.children.find(c => c.children.some(child => child.textContent === 'Replace stored value with an empty string')).children[0].checked = true;
  find('button', 'Add field').click();
  assert.equal(rowInput(rows(root)[0], 'Value').value, 'https://new.example');
  assert.equal(rowInput(rows(root)[1], 'Value').value, 'replacement');
  assert.equal(rows(root)[2].children.find(c => c.children.some(child => child.textContent === 'Replace stored value with an empty string')).children[0].checked, true);
  const added = rows(root).at(-1);
  rowInput(added, 'Field name').value = 'temporary';
  added.children.find(c => c.tagName === 'button' && c.textContent === 'Remove field').click();
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/records/r' && c[1]?.method === 'PUT')[1].body).fields, [
    { name: 'renamed', type: 'url', protected: false, value: 'https://new.example' },
    { name: 'secret', type: 'secret', protected: true, value: 'replacement' },
    { name: 'erase', type: 'secret', protected: true, value: '' },
  ]);
}));

test('protection toggle masks a drafted value immediately and survives field redraw', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [] };
  if (path === '/records' && init?.method === 'POST') return { record: { id: 'created' } };
  return base(path);
}, async ({ root, calls, find }) => {
  find('button', 'New credential').click();
  const template = labeled(root, 'Template'); template.value = 'custom'; template.fire('change');
  find('button', 'Add field').click();
  let row = rows(root)[0]; rowInput(row, 'Field name').value = 'api'; rowInput(row, 'Value').value = 'sensitive draft';
  const checkbox = row.children.find(c => c.children.some(child => child.textContent === 'Protected (write-only)')).children[0]; checkbox.checked = true; checkbox.fire('change');
  row = rows(root)[0]; assert.equal(rowInput(row, 'Value').type, 'password'); assert.equal(rowInput(row, 'Value').value, 'sensitive draft');
  find('button', 'Add field').click();
  assert.equal(rowInput(rows(root)[0], 'Value').type, 'password');
  rows(root).at(-1).children.find(c => c.tagName === 'button' && c.textContent === 'Remove field').click();
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/records' && c[1]?.method === 'POST')[1].body).fields[0], { name: 'api', type: 'text', protected: true, value: 'sensitive draft' });
}));

test('private key starts masked and multiline mode explicitly warns and can re-mask without losing draft', async () => fixture((path, init) => {
  if (path === '/records') return { records: [] };
  return { ...base(path), ...(path === '/templates' ? { templates: [{ id: 'ssh-key', fields: [{ name: 'privateKey', type: 'private-key', protected: true }] }] } : {}) };
}, async ({ root, find }) => {
  find('button', 'New credential').click();
  assert.equal(rowInput(rows(root)[0], 'Value').type, 'password');
  find('button', 'Enter multiline key (visible)').click();
  let row = rows(root)[0]; assert.equal(rowInput(row, 'Value (visible while editing)').tagName, 'textarea');
  rowInput(row, 'Value (visible while editing)').value = 'line1\nline2';
  find('button', 'Mask private key').click();
  row = rows(root)[0]; assert.equal(rowInput(row, 'Value').type, 'password'); assert.equal(rowInput(row, 'Value').value, 'line1\nline2');
}));

test('archive authenticates locally, forwards date and walks cursor without management reads', async () => {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root'), calls = [];
  const cleanup = mountArchive({ root, date: '2026-09-23', api: async (path, init) => {
    calls.push([path, init]);
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init.headers['X-GSS-Session'] === 'session' };
    if (path === '/login') return { session: 'session' };
    assert.match(path, /^\/audit\?/); assert.equal(init.headers['X-GSS-Session'], 'session');
    const query = new URLSearchParams(path.split('?')[1]); assert.equal(query.get('date'), '2026-09-23');
    return { events: [{ at: 'now', action: 'use', outcome: 'ok' }], nextCursor: query.has('before') ? null : '42' };
  } });
  try {
    await flush(); assert.equal(calls.some(([p]) => p.startsWith('/audit')), false);
    root.descendants().find(n => n.type === 'password').value = 'password';
    root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    const more = root.descendants().find(n => n.textContent === 'Load earlier audit events'); more.click(); await flush();
    assert.ok(calls.some(([p]) => p.includes('before=42'))); assert.equal(more.hidden, true);
    assert.equal(calls.some(([p]) => ['/records', '/templates', '/agents'].includes(p)), false);
  } finally { cleanup.unmount(); globalThis.document = old; }
});

test('Archive date updates retain only the mount-local session, reset pagination, and preserve logout/unmount', async () => {
  const previous = globalThis.document, storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.document = { createElement: tag => new Element(tag) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Archive must not use localStorage'); } });
  const root = new Element('root'), calls = [];
  let release, delay = false, expired = false;
  const api = async (path, init) => {
    calls.push([path, init]);
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init.headers['X-GSS-Session'] === 'mount-session' };
    if (path === '/login') return { session: 'mount-session' };
    if (path === '/logout') return {};
    if (path.startsWith('/audit?')) {
      if (expired) throw Object.assign(new Error('Session expired'), { status: 401 });
      if (delay) { delay = false; await new Promise(resolve => { release = resolve; }); }
      return { events: [{ at: path, action: 'read', outcome: 'ok' }], nextCursor: 'next' };
    }
    throw new Error(path);
  };
  const mount = mountArchive({ root, api, date: '2026-09-23' });
  try {
    await flush();
    const password = root.descendants().find(n => n.type === 'password'); password.value = 'test-password';
    root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    assert.equal(password.value, '');
    mount.update({ date: '2026-09-24' }); await flush();
    assert.equal(calls.at(-1)[0], '/audit?date=2026-09-24');
    assert.equal(calls.at(-1)[1].headers['X-GSS-Session'], 'mount-session');
    delay = true;
    root.descendants().find(n => n.textContent === 'Load earlier audit events').click(); await flush();
    mount.update({ date: '2026-09-22' }); mount.update({ date: '2026-09-21' });
    release(); await flush();
    const audits = calls.filter(([path]) => path.startsWith('/audit?'));
    assert.equal(audits.at(-1)[0], '/audit?date=2026-09-21');
    assert.ok(audits.every(([, init]) => init.headers['X-GSS-Session'] === 'mount-session'));
    assert.equal(calls.filter(([path]) => path === '/login').length, 1);
    assert.ok(root.descendants().some(n => n.textContent === 'Log out'));
    assert.ok(!root.descendants().some(n => n.textContent.includes('2026-09-23')));
    root.descendants().find(n => n.textContent === 'Log out').click(); await flush();
    assert.equal(calls.find(([path]) => path === '/logout')[1].headers['X-GSS-Session'], 'mount-session');
    assert.equal(calls.at(-1)[1].headers['X-GSS-Session'], undefined);
    mount.update({ date: '2026-09-20' }); await flush();
    assert.ok(root.descendants().some(n => n.type === 'password'));
    mount.unmount();
    assert.ok(calls.every(([, init]) => init.signal.aborted));
    const count = calls.length; mount.update({ date: '' }); await flush(); assert.equal(calls.length, count);
    const fresh = mountArchive({ root, api, date: '' }); await flush();
    assert.equal(calls.at(-1)[1].headers['X-GSS-Session'], undefined);
    root.descendants().find(n => n.type === 'password').value = 'test-password';
    root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    expired = true; fresh.update({ date: '2026-09-19' }); await flush();
    assert.ok(root.descendants().some(n => n.textContent === 'Sign in again'));
    fresh.update({ date: '2026-09-18' }); await flush();
    assert.equal(calls.at(-1)[1].headers['X-GSS-Session'], undefined);
    assert.ok(root.descendants().some(n => n.type === 'password')); fresh.unmount();
  } finally {
    mount.unmount(); globalThis.document = previous;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
  }
});
