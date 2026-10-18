import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('main publishes an installable NightShaman development mod version after fast standalone checks', () => {
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /Fast development contract gate/);
  assert.match(workflow, /! -name 'core-integration\.test\.mjs'/);
  assert.match(workflow, /set-release-version\.mjs/);
  assert.match(workflow, /git tag -a "\$VERSION"/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /Complete GSS\/Core validation and public promotion run separately/);
});
