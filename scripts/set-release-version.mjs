import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [version, mode] = process.argv.slice(2);
if (!/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(version ?? '')) throw new Error('Expected YYYY.MM.DD[.N]');
if (mode && mode !== '--check') throw new Error(`Unknown mode: ${mode}`);

const root = new URL('../', import.meta.url);
for (const name of ['burrow.mod.json', 'package.json']) {
  const path = fileURLToPath(new URL(name, root));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (mode === '--check') {
    if (data.version !== version) throw new Error(`${name}: release version mismatch`);
    continue;
  }
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
