// Ogni file .github/workflows/*.yml deve essere YAML valido.
// Usa Python con PyYAML (nessuna dipendenza npm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const PY_ARGS = ['-c', 'import sys,yaml; yaml.safe_load(open(sys.argv[1],encoding="utf-8"))'];

function controllaYaml(percorso) {
  const r = spawnSync('python', [...PY_ARGS, percorso], { encoding: 'utf8' });
  if (r.error) {
    assert.fail('serve python con PyYAML: ' + r.error.message);
  }
  return r;
}

const file = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((nome) => nome.endsWith('.yml'))
  .sort();

for (const nome of file) {
  test(`workflow YAML valido: ${nome}`, () => {
    const r = controllaYaml(path.join(WORKFLOWS_DIR, nome));
    assert.equal(r.status, 0, r.stderr);
  });
}

test('il controllo YAML riconosce un file rotto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-yaml-'));
  try {
    const rotto = path.join(dir, 'rotto.yml');
    fs.writeFileSync(rotto, 'jobs:\n  x:\n    steps:\n      - run: "a" b\n', 'utf8');
    const r = controllaYaml(rotto);
    assert.notEqual(r.status, 0, 'un YAML rotto doveva far fallire il controllo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
