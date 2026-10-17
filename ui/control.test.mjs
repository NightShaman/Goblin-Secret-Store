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
  const cleanup = mountControl({ root, section, runtimeScope: 'local', modId: 'gss-test-fixture', api: async (path, init) => { calls.push([path, init]); return handler(path, init); } });
  try { await flush(); await fn({ root, calls, find: (tag, text) => root.descendants().find(n => n.tagName === tag && n.textContent === text) }); }
  finally { cleanup(); globalThis.document = previous; }
}
const base = (path) => {
  if (path === '/status') return { authMode: 'core', authenticated: true, initialized: false };
  if (path === '/templates') return { templates: [{ id: 'token', fields: [{ name: 'token', type: 'token', protected: true }] }, { id: 'custom', fields: [] }] };
  if (path === '/agents') return [{ id: 'a', name: 'Agent A', enabled: true }];
};
test('first-visitor claim uses POST bootstrap and retains session in memory only', async () => fixture((path, init) => {
  if (path === '/status') return { authMode: 'local', initialized: Boolean(init?.headers?.['X-GSS-Session']), authenticated: init?.headers?.['X-GSS-Session'] === 'local-session' };
  if (path === '/bootstrap') return { session: 'local-session', expiresInMs: 1000 };
  if (path === '/records') return { records: [] };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.match(root.descendants().map(n => n.textContent).join(' '), /First visitor on this trusted network/);
  const passwords = root.descendants().filter(n => n.type === 'password'); passwords.forEach(n => n.value = 'long-vault-password');
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/bootstrap')[1].body), { password: 'long-vault-password' });
  assert.equal(calls.find(c => c[0] === '/records')[1].headers['X-GSS-Session'], 'local-session');
  assert.equal(passwords[0].value, ''); assert.ok(find('h2', 'New credential'));
}));
test('editing omits existing protected value but retains public value', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Example', template: 'token', version: 2, fields: [{ name: 'token', type: 'token', protected: true, hasValue: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r' && init?.method === 'PUT') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.equal(find('h2', 'New credential')?.tagName, 'h2');
  assert.equal(find('button', 'New credential'), undefined);
  find('button', 'Example').click();
  assert.ok(find('button', 'Create another credential'));
  assert.equal(find('button', 'Save access'), undefined);
  const form = root.descendants().find(n => n.tagName === 'form'); await form.fire('submit'); await flush();
  const saved = JSON.parse(calls.find(c => c[0] === '/records/r' && c[1]?.method === 'PUT')[1].body);
  assert.deepEqual(saved.fields, [{ name: 'token', type: 'token', protected: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }]);
}));
test('agent sharing saves explicit all-agent scope without redundant confirmation', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Example', template: 'token', version: 2, fields: [], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r/acl') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  assert.equal(find('h2', 'New credential'), undefined);
  find('button', 'Example').click();
  assert.equal(find('button', 'Save credential'), undefined);
  const scope = root.descendants().find(n => n.tagName === 'select' && n.parent?.textContent === 'Access scope'); scope.value = 'all'; scope.fire('change');
  assert.doesNotMatch(root.descendants().map(n => n.textContent).join(' '), /I understand this grants every agent access/);
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
    const cleanup = mountSettings({ section: 'credentials', primary, runtimeScope: 'local', modId: 'gss-settings-test', api: async path => path === '/records' ? { records: [] } : base(path) });
    await flush();
    assert.deepEqual(settingsSections.map(s => s.id), ['credentials', 'sharing', 'backup']);
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
      ['backup', 'Download encrypted backup', 'New credential'],
    ]) {
      const cleanup = mountSettings({ section, primary, overflow, api, runtimeScope: 'local', modId: 'gss-sections-test' }); await flush();
      assert.ok(primary.node.descendants().some(n => n.textContent === visible), `${section} should show ${visible}`);
      assert.ok(![...primary.node.descendants(), ...overflow.node.descendants()].some(n => n.textContent === absent), `${section} should not show ${absent}`);
      assert.ok(!has('Audit history'));
      assert.ok(![...primary.node.descendants(), ...overflow.node.descendants()].some(n => n.tagName === 'h1' && n.textContent === 'Goblin Secret Store'));
      if (section === 'backup') assert.equal(overflow.node.descendants().length, 0);
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
  const form = root.descendants().find(n => n.tagName === 'form');
  root.descendants().find(n => n.textContent === 'Credential name (public)').children[0].value = 'Token';
  await form.fire('submit'); await flush();
  const payload = JSON.parse(calls.find(c => c[0] === '/records' && c[1]?.method === 'POST')[1].body);
  assert.deepEqual(payload, { name: 'Token', template: 'token', fields: [{ name: 'token', type: 'token', protected: true, value: '' }], acl: { mode: 'none', agents: [], active: true } });
}));
test('two-column logout clears cached metadata from both surfaces and stale buttons cannot redraw it', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const primary = { replace(node) { this.node = node; }, clear() { this.node = null; } };
  const overflow = { replace(node) { this.node = node; }, clear() { this.node = null; } };
  const calls = []; let authenticated = true;
  const cleanup = mountSettings({ section: 'credentials', primary, overflow, runtimeScope: 'local', modId: 'gss-cache-logout-test', api: async (path, init = {}) => {
    calls.push([path, init]);
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated };
    if (path === '/records') return { records: [{ id: 'r', name: 'Cached credential', template: 'custom', version: 1, fields: [{ name: 'public-metadata', type: 'text', protected: false, value: 'cached-value' }], acl: { mode: 'none', agents: [], active: true } }] };
    if (path === '/templates') return { templates: [{ id: 'custom', fields: [] }] };
    if (path === '/agents') return [];
    if (path === '/logout') { authenticated = false; return { ok: true }; }
    throw new Error(path);
  } });
  try {
    await flush();
    const stale = overflow.node.descendants().find(n => n.tagName === 'button' && n.textContent === 'Cached credential');
    stale.click(); assert.ok(primary.node.descendants().some(n => n.value === 'cached-value'));
    overflow.node.descendants().find(n => n.textContent === 'Log out').click(); await flush();
    const visible = [...primary.node.descendants(), ...overflow.node.descendants()];
    assert.ok(visible.some(n => n.textContent === 'Unlock vault'));
    assert.ok(!visible.some(n => n.textContent === 'Cached credential' || n.value === 'cached-value'));
    const before = calls.length; stale.click(); await flush();
    assert.equal(calls.length, before); assert.ok(!primary.node.descendants().some(n => n.value === 'cached-value'));
  } finally { cleanup(); globalThis.document = previous; }
});

test('auth loss clears every concurrently mounted management surface', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const rootA = new Element('root'), rootB = new Element('root'); let rejectRecords, authenticated = true;
  const context = { runtimeScope: 'local', modId: 'gss-concurrent-auth-loss-test' };
  const apiA = async path => {
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated };
    if (path === '/records') return { records: [{ id: 'r', name: 'Shared cached credential', template: 'custom', version: 1, fields: [], acl: { mode: 'none', agents: [], active: true } }] };
    if (path === '/templates') return { templates: [{ id: 'custom', fields: [] }] };
    if (path === '/agents') return [];
    throw new Error(path);
  };
  const apiB = async path => {
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: true };
    if (path === '/records') return new Promise((_, reject) => { rejectRecords = reject; });
    if (path === '/templates') return { templates: [] };
    if (path === '/agents') return [];
    throw new Error(path);
  };
  const cleanupA = mountControl({ root: rootA, api: apiA, ...context });
  const cleanupB = mountControl({ root: rootB, api: apiB, ...context });
  try {
    await flush(); assert.ok(rootA.descendants().some(n => n.textContent === 'Shared cached credential'));
    authenticated = false; rejectRecords(Object.assign(new Error('Signed out'), { status: 401 })); await flush();
    assert.ok(!rootA.descendants().some(n => n.textContent === 'Shared cached credential'));
    assert.ok(!rootB.descendants().some(n => n.textContent === 'Shared cached credential'));
  } finally { cleanupA(); cleanupB(); globalThis.document = previous; }
});

test('delayed authorized records cannot repopulate metadata after shared logout invalidation', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const delayedRoot = new Element('root'), logoutRoot = new Element('root');
  const context = { runtimeScope: 'local', modId: 'gss-delayed-records-logout-test' };
  let releaseRecords, authenticated = true;
  const common = async path => {
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated };
    if (path === '/templates') return { templates: [{ id: 'custom', fields: [] }] };
    if (path === '/agents') return [];
    if (path === '/logout') { authenticated = false; return { ok: true }; }
    throw new Error(path);
  };
  const cleanupDelayed = mountControl({ root: delayedRoot, ...context, api: async path => {
    if (path === '/records') return new Promise(resolve => { releaseRecords = resolve; });
    return common(path);
  } });
  const cleanupLogout = mountControl({ root: logoutRoot, ...context, api: async path => {
    if (path === '/records') return { records: [] };
    return common(path);
  } });
  try {
    await flush();
    logoutRoot.descendants().find(n => n.textContent === 'Log out').click(); await flush();
    releaseRecords({ records: [{ id: 'late', name: 'Delayed credential', template: 'custom', version: 1, fields: [], acl: { mode: 'none', agents: [], active: true } }] });
    await flush();
    assert.ok(!delayedRoot.descendants().some(n => n.textContent === 'Delayed credential'));
    assert.ok(delayedRoot.descendants().some(n => n.textContent === 'Unlock vault'));
  } finally { cleanupDelayed(); cleanupLogout(); globalThis.document = previous; }
});

test('cached record interaction checks local session expiry before rendering metadata', async () => {
  const previous = globalThis.document, originalNow = Date.now;
  globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root'); let now = 1000;
  Date.now = () => now;
  const cleanup = mountControl({ root, runtimeScope: 'local', modId: 'gss-expired-cache-test', api: async (path, init = {}) => {
    const token = init.headers?.['X-GSS-Session'];
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: token === 'expiring-session' };
    if (path === '/login') return { session: 'expiring-session', expiresInMs: 10 };
    if (path === '/records') return { records: [{ id: 'r', name: 'Expiring credential', template: 'custom', version: 1, fields: [{ name: 'public', type: 'text', protected: false, value: 'must-not-render' }], acl: { mode: 'none', agents: [], active: true } }] };
    if (path === '/templates') return { templates: [{ id: 'custom', fields: [] }] };
    if (path === '/agents') return [];
    throw new Error(path);
  } });
  try {
    await flush();
    root.descendants().find(n => n.type === 'password').value = 'password';
    await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    const cached = root.descendants().find(n => n.tagName === 'button' && n.textContent === 'Expiring credential');
    now = 1011; cached.click(); await flush();
    assert.ok(root.descendants().some(n => n.textContent === 'Unlock vault'));
    assert.ok(!root.descendants().some(n => n.value === 'must-not-render'));
    assert.ok(!root.descendants().some(n => n.textContent === 'Expiring credential'));
  } finally { cleanup(); Date.now = originalNow; globalThis.document = previous; }
});

test('local logout clears the session header on subsequent status requests', async () => fixture((path, init) => {
  if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init?.headers?.['X-GSS-Session'] === 'session' };
  if (path === '/login') return { session: 'session', expiresInMs: 10000 };
  if (path === '/logout') return { ok: true };
  if (path === '/records') return { records: [] };
  return base(path);
}, async ({ root, calls, find }) => {
  root.descendants().find(n => n.type === 'password').value = 'password';
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  find('button', 'Log out').click(); await flush();
  assert.equal(calls.find(c => c[0] === '/logout')[1].headers['X-GSS-Session'], 'session');
  assert.equal(calls.filter(c => c[0] === '/status').at(-1)[1].headers['X-GSS-Session'], undefined);
}, 'credentials'));
const labeled = (root, text) => root.descendants().find(n => n.tagName === 'label' && n.textContent === text)?.children[0];
const rows = root => root.descendants().filter(n => n.className === 'gss-fields' && n.children.some(c => c.textContent === 'Field key (public)'));
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
  rowInput(publicRow, 'Field key (public)').value = 'renamed';
  rowInput(publicRow, 'Field type').value = 'url';
  rowInput(publicRow, 'Field value').value = 'https://new.example';
  rowInput(secretRow, 'Field value').value = 'replacement';
  eraseRow.children.find(c => c.children.some(child => child.textContent === 'Replace stored value with an empty string')).children[0].checked = true;
  find('button', 'Add field').click();
  assert.equal(rowInput(rows(root)[0], 'Field value').value, 'https://new.example');
  assert.equal(rowInput(rows(root)[1], 'Field value').value, 'replacement');
  assert.equal(rows(root)[2].children.find(c => c.children.some(child => child.textContent === 'Replace stored value with an empty string')).children[0].checked, true);
  const added = rows(root).at(-1);
  rowInput(added, 'Field key (public)').value = 'temporary';
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
  const template = labeled(root, 'Credential template'); template.value = 'custom'; template.fire('change');
  find('button', 'Add field').click();
  let row = rows(root)[0]; rowInput(row, 'Field key (public)').value = 'api'; rowInput(row, 'Field value').value = 'sensitive draft';
  const checkbox = row.children.find(c => c.children.some(child => child.textContent === 'Protected (write-only)')).children[0]; checkbox.checked = true; checkbox.fire('change');
  row = rows(root)[0]; assert.equal(rowInput(row, 'Field value').type, 'password'); assert.equal(rowInput(row, 'Field value').value, 'sensitive draft');
  find('button', 'Add field').click();
  assert.equal(rowInput(rows(root)[0], 'Field value').type, 'password');
  rows(root).at(-1).children.find(c => c.tagName === 'button' && c.textContent === 'Remove field').click();
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/records' && c[1]?.method === 'POST')[1].body).fields[0], { name: 'api', type: 'text', protected: true, value: 'sensitive draft' });
}));

test('private key stays multiline while masked and preserves LF/CRLF drafts through redraw and save', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [] };
  if (path === '/records' && init?.method === 'POST') return { record: { id: 'created' } };
  return { ...base(path), ...(path === '/templates' ? { templates: [{ id: 'ssh-key', fields: [{ name: 'privateKey', type: 'private-key', protected: true }] }] } : {}) };
}, async ({ root, calls, find }) => {
  let row = rows(root)[0], value = rowInput(row, 'Field value');
  assert.equal(value.tagName, 'textarea'); assert.equal(value.className, 'gss-masked-value');
  value.value = '-----BEGIN KEY-----\r\nline one\nline two\r\n-----END KEY-----';
  find('button', 'Enter multiline key (visible)').click();
  row = rows(root)[0]; value = rowInput(row, 'Field value (visible while editing)');
  assert.equal(value.tagName, 'textarea'); assert.equal(value.value, '-----BEGIN KEY-----\r\nline one\nline two\r\n-----END KEY-----');
  find('button', 'Mask private key').click();
  row = rows(root)[0]; value = rowInput(row, 'Field value');
  assert.equal(value.tagName, 'textarea'); assert.equal(value.className, 'gss-masked-value');
  assert.equal(value.value, '-----BEGIN KEY-----\r\nline one\nline two\r\n-----END KEY-----');
  labeled(root, 'Credential name (public)').value = 'SSH key';
  await root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
  const saved = JSON.parse(calls.find(c => c[0] === '/records' && c[1]?.method === 'POST')[1].body);
  assert.equal(saved.fields[0].value, '-----BEGIN KEY-----\r\nline one\nline two\r\n-----END KEY-----');
}));

test('archive authenticates locally, forwards date and walks cursor without management reads', async () => {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root'), calls = [];
  const cleanup = mountArchive({ root, date: '2026-09-23', runtimeScope: 'local', modId: 'gss-archive-test', api: async (path, init) => {
    calls.push([path, init]);
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init.headers['X-GSS-Session'] === 'session' };
    if (path === '/login') return { session: 'session', expiresInMs: 3600000 };
    assert.match(path, /^\/audit\?/); assert.equal(init.headers['X-GSS-Session'], 'session');
    const query = new URLSearchParams(path.split('?')[1]); assert.equal(query.get('date'), '2026-09-23');
    return { events: [{ at: 'now', action: 'use', outcome: 'ok' }], nextCursor: query.has('before') ? null : '42' };
  } });
  try {
    await flush(); assert.equal(calls.some(([p]) => p.startsWith('/audit')), false);
    root.descendants().find(n => n.type === 'password').value = 'password';
    root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    const more = root.descendants().find(n => n.textContent === 'Load earlier events');
    const rows = () => root.descendants().filter(n => n.tagName === 'tbody').flatMap(n => n.children);
    assert.match(root.descendants().find(n => n.tagName === 'style').textContent, /\.gss-archive input\{[^}]*background:var\(--surface-input\)/, 'password field uses the themed input style');
    assert.equal(root.descendants().find(n => n.tagName === 'table')['aria-label'], 'Vault audit events');
    assert.equal(rows().length, 1);
    more.click(); await flush();
    assert.ok(calls.some(([p]) => p.includes('before=42'))); assert.equal(more.hidden, true);
    assert.equal(rows().length, 2, 'earlier pages append to the table');
    assert.ok(root.descendants().some(n => n.textContent === '2 events shown'));
    assert.equal(calls.some(([p]) => ['/records', '/templates', '/agents'].includes(p)), false);
  } finally { cleanup.unmount(); globalThis.document = old; }
});

test('Archive date updates retain the shared session, reset pagination, and preserve logout/unmount', async () => {
  const previous = globalThis.document, storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.document = { createElement: tag => new Element(tag) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Archive must not use localStorage'); } });
  const root = new Element('root'), calls = [];
  let release, delay = false, expired = false;
  const api = async (path, init) => {
    calls.push([path, init]);
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: init.headers['X-GSS-Session'] === 'mount-session' };
    if (path === '/login') return { session: 'mount-session', expiresInMs: 3600000 };
    if (path === '/logout') return {};
    if (path.startsWith('/audit?')) {
      if (expired) throw Object.assign(new Error('Session expired'), { status: 401 });
      if (delay) { delay = false; await new Promise(resolve => { release = resolve; }); }
      return { events: [{ at: path, action: 'read', outcome: 'ok' }], nextCursor: 'next' };
    }
    throw new Error(path);
  };
  const mount = mountArchive({ root, api, date: '2026-09-23', runtimeScope: 'local', modId: 'gss-archive-date-test' });
  try {
    await flush();
    const password = root.descendants().find(n => n.type === 'password'); password.value = 'test-password';
    root.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    assert.equal(password.value, '');
    mount.update({ date: '2026-09-24' }); await flush();
    assert.equal(calls.at(-1)[0], '/audit?date=2026-09-24');
    assert.equal(calls.at(-1)[1].headers['X-GSS-Session'], 'mount-session');
    delay = true;
    root.descendants().find(n => n.textContent === 'Load earlier events').click(); await flush();
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
    const fresh = mountArchive({ root, api, date: '', runtimeScope: 'local', modId: 'gss-archive-date-test' }); await flush();
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

// Dynamic module loading mirrors Burrow's separate Settings/Archive imports and exercises shared module memory.
test('Settings remount and Archive import share only a matching runtime/mod session', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const { mountSettings: settings } = await import('./settings.js?mount=one');
  const { mountArchive: archive } = await import('./archive.js?mount=two');
  const apiCalls = [];
  const api = async (path, init = {}) => {
    apiCalls.push([path, init.headers?.['X-GSS-Session']]);
    const authenticated = init.headers?.['X-GSS-Session'] === 'shared-session';
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated };
    if (path === '/login') return { session: 'shared-session', expiresInMs: 3600000 };
    if (path === '/records') return { records: [] };
    if (path === '/templates') return { templates: [] };
    if (path === '/agents') return { agents: [] };
    if (path.startsWith('/audit?')) return { events: [], nextCursor: null };
    if (path === '/logout') return { ok: true };
    throw new Error(path);
  };
  const primary = { replace(node) { this.node = node; }, clear() { this.node = null; } }, root = new Element('root');
  const context = { modId: 'gss-session-flow', runtimeScope: 'local', api };
  let cleanup, panel;
  try {
    cleanup = settings({ ...context, section: 'credentials', primary }); await flush();
    primary.node.descendants().find(n => n.type === 'password').value = 'password';
    await primary.node.descendants().find(n => n.tagName === 'form').fire('submit'); await flush();
    cleanup(); assert.equal(primary.node, null);
    cleanup = settings({ ...context, section: 'sharing', primary }); await flush();
    assert.ok(primary.node.descendants().some(n => n.textContent === 'Choose a credential to manage agent access.'));
    assert.equal(primary.node.descendants().some(n => n.type === 'password'), false);
    cleanup(); cleanup = null;
    panel = archive({ ...context, root }); await flush();
    assert.equal(root.descendants().some(n => n.type === 'password'), false);
    assert.ok(apiCalls.some(([path, token]) => path.startsWith('/audit?') && token === 'shared-session'));
    panel.unmount(); panel = null;
    const isolatedRoot = new Element('root');
    const isolated = archive({ ...context, modId: 'other-mod', root: isolatedRoot }); await flush();
    assert.ok(isolatedRoot.descendants().some(n => n.type === 'password'));
    isolated.unmount();
    const otherRuntime = archive({ ...context, runtimeScope: 'another-runtime', root: isolatedRoot }); await flush();
    assert.ok(isolatedRoot.descendants().some(n => n.type === 'password'));
    otherRuntime.unmount();
    panel = archive({ ...context, root }); await flush();
    root.descendants().find(n => n.textContent === 'Log out').click(); await flush();
    panel.unmount(); panel = null;
    cleanup = settings({ ...context, section: 'credentials', primary }); await flush();
    assert.ok(primary.node.descendants().some(n => n.type === 'password'));
  } finally { cleanup?.(); panel?.unmount(); globalThis.document = previous; }
});

test('shared session uses receipt-relative expiry despite server/browser clock skew and preserves invalidation behavior', async () => {
  const { vaultSession } = await import('./session.js');
  const state = vaultSession('local', 'gss-expiry-test');
  const previous = globalThis.Date;
  let now = 5000000000000;
  globalThis.Date = class extends previous { static now() { return now; } };
  try {
    state.set({ session: 'old', expiresAt: 1000, expiresInMs: 3600000 });
    assert.equal(state.current(), 'old', 'an absolute server deadline behind the browser clock is ignored');
    state.set({ session: 'new', expiresAt: 9000000000000, expiresInMs: 3600000 });
    state.invalidate('old'); assert.equal(state.current(), 'new');
    state.observe({ authMode: 'local', initialized: true, authenticated: false }, 'old'); assert.equal(state.current(), 'new');
    now += 3599999; assert.equal(state.current(), 'new');
    now += 1; assert.equal(state.current(), '');
    state.set({ session: 'newer', expiresAt: -1, expiresInMs: 3600000 });
    state.observe({ authMode: 'core', initialized: true, authenticated: true }, 'newer');
    assert.equal(state.current(), '');
  } finally { globalThis.Date = previous; }
});

test('shared session rejects missing, non-positive, non-integral and excessive relative lifetimes', async () => {
  const { vaultSession } = await import('./session.js');
  const state = vaultSession('local', 'gss-duration-validation-test');
  for (const expiresInMs of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 60 * 60 * 1000 + 1]) {
    assert.throws(() => state.set({ session: 'invalid', expiresAt: Date.now() + 3600000, expiresInMs }), /Invalid vault session response/);
    assert.equal(state.current(), '');
  }
  assert.throws(() => state.set({ session: 'legacy-only', expiresAt: Date.now() + 3600000 }), /Invalid vault session response/);
  state.set({ session: 'bounded', expiresAt: -1, expiresInMs: 60 * 60 * 1000 });
  assert.equal(state.current(), 'bounded');
});

test('an older 401 cannot clear a newer login from another mounted surface', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const { vaultSession } = await import('./session.js');
  const session = vaultSession('local', 'gss-race-test');
  session.set({ session: 'old-token', expiresInMs: 3600000 });
  let rejectOld;
  const root = new Element('root');
  const api = async (path, init) => {
    if (path === '/status') return { authMode: 'local', initialized: true, authenticated: true };
    if (path === '/records') return new Promise((_, reject) => { rejectOld = reject; });
    if (path === '/templates') return { templates: [] };
    if (path === '/agents') return { agents: [] };
    throw Error(path);
  };
  const unmount = mountControl({ root, api, modId: 'gss-race-test', runtimeScope: 'local' });
  try {
    await flush(); assert.equal(typeof rejectOld, 'function');
    session.set({ session: 'new-token', expiresInMs: 3600000 });
    rejectOld(Object.assign(new Error('unauthorized'), { status: 401 }));
    await flush();
    assert.equal(session.current(), 'new-token');
  } finally { unmount(); globalThis.document = previous; }
});


test('Archive renders historical timestamps, missing time, empty date and safe text cells', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root');
  const mount = mountArchive({ root, runtimeScope: 'local', modId: 'gss-audit-format-test', api: async path => {
    if (path === '/status') return { authMode: 'core', authenticated: true };
    if (path.startsWith('/audit?')) return path.includes('date=2026-09-22')
      ? { events: [], nextCursor: null }
      : { events: [{ at: '2026-09-23T12:34:56.000Z', action: '<script>bad</script>', outcome: 'denied', agentId: 'agent', recordId: 'record', recordName: '<script>Old credential</script>' },
        { at: '', action: 'read', outcome: 'ok', agentId: 'agent', recordId: 'legacy-id', recordName: null },
        { at: '', action: 'login', outcome: 'ok', agentId: null, recordId: null }], nextCursor: null };
    throw new Error(path);
  } });
  try {
    await flush();
    const table = root.descendants().find(n => n.tagName === 'table');
    assert.equal(table['aria-label'], 'Vault audit events');
    assert.equal(root.descendants().find(n => n.tagName === 'time').dateTime, '2026-09-23T12:34:56.000Z');
    assert.ok(root.descendants().some(n => n.textContent === 'Time unavailable'));
    assert.ok(root.descendants().some(n => n.tagName === 'td' && n.textContent === '<script>bad</script>'));
    assert.ok(root.descendants().some(n => n.tagName === 'th' && n.textContent === 'Credential'));
    const credentialCells = root.descendants().find(n => n.tagName === 'tbody').children.map(row => row.children.at(-1).textContent);
    assert.deepEqual(credentialCells, ['<script>Old credential</script>', 'ID: legacy-id', '—']);
    assert.ok(root.descendants().some(n => n.textContent === '3 events shown'));
    mount.update({ date: '2026-09-22' }); await flush();
    assert.equal(root.descendants().some(n => n.tagName === 'table'), false);
    assert.ok(root.descendants().some(n => n.textContent === 'No vault activity for this date.'));
  } finally { mount.unmount(); globalThis.document = previous; }
});
