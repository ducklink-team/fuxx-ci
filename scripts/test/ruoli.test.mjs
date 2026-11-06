import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rolesPath = path.join(root, '.fuxx', 'ruoli.json');

test('ruoli dichiarati hanno workflow reale nel repository', () => {
  const data = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
  assert.ok(data.ruoli && typeof data.ruoli === 'object' && !Array.isArray(data.ruoli));
  for (const [name, role] of Object.entries(data.ruoli)) {
    assert.equal(role.prova?.tipo, 'workflow', `${name}: prova.tipo deve essere workflow`);
    const file = role.prova.valore;
    assert.match(file, /^\.github\/workflows\/[\w.-]+\.ya?ml$/);
    assert.equal(fs.existsSync(path.join(root, file)), true, `${name}: workflow ${file} non esiste`);
  }
});
