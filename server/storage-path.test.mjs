import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultDataDirectory} from './store.mjs';
test('vault uses persisted runtime data, never replaceable mod source', () => {
 assert.equal(defaultDataDirectory({BURROW_RUNTIME_ROOT:'/data'}, '/home/burrow'),'/data/mods/mod-data/goblin-secret-store');
 assert.equal(defaultDataDirectory({GSS_DATA_DIR:'/vault',BURROW_RUNTIME_ROOT:'/data'}),'/vault');
 assert.equal(defaultDataDirectory({},'/home/operator'),'/home/operator/.local/share/goblin-secret-store');
 assert.throws(()=>defaultDataDirectory({BURROW_RUNTIME_ROOT:'relative'}),/storage_absolute_required/);
});
