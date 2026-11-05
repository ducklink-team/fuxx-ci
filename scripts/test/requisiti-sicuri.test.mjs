import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../requisiti-sicuri.mjs', import.meta.url));

function esegui(testo) {
  const directory = mkdtempSync(join(tmpdir(), 'fuxx-requisiti-'));
  const file = join(directory, 'requirements.txt');
  writeFileSync(file, testo);
  return spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
}

test('requisiti-sicuri ammette requisiti per nome, commenti, continuazioni e opzioni consentite', () => {
  const risultato = esegui([
    '# commento',
    'requests==2.32.3',
    'Django>=5,<6 ; python_version>="3.11"',
    'uvicorn[standard]==0.30.1 --hash=sha256:abc',
    'packaging>=24 \\',
    '  --hash=sha256:def',
    '  # commento in coda',
    '--index-url https://x/simple',
    '',
  ].join('\n'));

  assert.equal(risultato.status, 0, risultato.stderr);
});

for (const testo of [
  './loc',
  '-e ./loc',
  'file:./loc',
  'locale1 @ file:///x.tar.gz',
  'pkg @ git+https://x/y.git',
  'git+https://x/y.git#egg=y',
  'https://x/y.tar.gz',
  '-r altro.txt',
  '--no-binary :all:',
  'C:\\x\\y',
]) {
  test(`requisiti-sicuri rifiuta ${testo}`, () => {
    const risultato = esegui(testo);
    assert.equal(risultato.status, 1, risultato.stdout + risultato.stderr);
    assert.match(risultato.stderr, /riga 1 non ammessa:/);
    assert.match(risultato.stderr, /\S/);
  });
}
