import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountControl } from './control.js';
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
async function fixture(handler, fn) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('root'), calls = [];
  const cleanup = mountControl({ root, api: async (path, init) => { calls.push([path, init]); return handler(path, init); } });
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
  assert.equal(passwords[0].value, ''); assert.ok(find('button', 'Log out'));
}));
test('editing omits existing protected value but retains public value; ACL requires all confirmation', async () => fixture((path, init) => {
  if (path === '/records' && !init?.method) return { records: [{ id: 'r', name: 'Example', template: 'token', version: 2, fields: [{ name: 'token', type: 'token', protected: true, hasValue: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }], acl: { mode: 'none', agents: [], active: true } }] };
  if (path === '/records/r' && init?.method === 'PUT') return { record: { id: 'r' } };
  if (path === '/records/r/acl') return { record: { id: 'r' } };
  return base(path);
}, async ({ root, calls, find }) => {
  find('button', 'Example').click();
  const form = root.descendants().find(n => n.tagName === 'form'); await form.fire('submit'); await flush();
  const saved = JSON.parse(calls.find(c => c[0] === '/records/r' && c[1]?.method === 'PUT')[1].body);
  assert.deepEqual(saved.fields, [{ name: 'token', type: 'token', protected: true }, { name: 'site', type: 'url', protected: false, value: 'https://example.org' }]);
  const scope = root.descendants().find(n => n.tagName === 'select' && n.parent?.textContent === 'Access scope'); scope.value = 'all'; scope.fire('change');
  find('button', 'Save access').click(); await flush(); assert.equal(calls.some(c => c[0] === '/records/r/acl'), false);
  root.descendants().find(n => n.tagName === 'input' && n.parent?.children.some(c => c.textContent === 'I understand this grants every agent access to this credential.')).checked = true;
  find('button', 'Save access').click(); await flush();
  assert.deepEqual(JSON.parse(calls.find(c => c[0] === '/records/r/acl')[1].body).acl, { mode: 'all', agents: [], active: true });
}));
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
}));
test('settings mounts only orientation, never a credential form', () => {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  try { const primary = { replace(node) { this.node = node; }, clear() { this.node = null; } }; const cleanup = mountSettings({ primary }); assert.deepEqual(settingsSections, [{ id: 'vault', label: 'Vault' }]); assert.match(primary.node.descendants().map(n => n.textContent).join(' '), /Manage credentials/); cleanup(); assert.equal(primary.node, null); }
  finally { globalThis.document = old; }
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
}));
