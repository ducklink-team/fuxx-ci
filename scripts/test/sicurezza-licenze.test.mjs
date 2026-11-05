import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/sicurezza.yml', import.meta.url), 'utf8');

test('sicurezza: audit e licenze non eseguono codice della PR', () => {
  assert.doesNotMatch(workflow, /\bnpx\b/, 'npx non deve essere usato nel workflow');

  for (const line of workflow.split(/\r?\n/).filter(line => /pip install .*\s-r\s/.test(line))) {
    assert.match(line, /--only-binary=:all:/, `installazione Python senza sole wheel: ${line.trim()}`);
  }

  assert.doesNotMatch(workflow, /pip-licenses[^\n]*--python/);
  assert.doesNotMatch(workflow, /pip-audit[^\n]*\s-r\s/);

  const pythonInstall = workflow.match(/- name: Dipendenze Python solo wheel in target isolato[\s\S]*?(?=\r?\n      - name:|$)/)?.[0];
  assert.ok(pythonInstall, 'manca il passo di installazione Python');
  assert.match(pythonInstall, /node __fuxx_ci\/scripts\/requisiti-sicuri\.mjs "\$REQUIREMENTS"/);
  assert.ok(pythonInstall.indexOf('requisiti-sicuri.mjs') < pythonInstall.indexOf('pip install'), 'la validazione requirements deve precedere pip install');

  const installNodeTool = workflow.match(/- name: Installa strumento licenze Node[\s\S]*?(?=\r?\n      - name:|$)/)?.[0];
  assert.ok(installNodeTool, 'manca il passo di installazione dello strumento licenze Node');
  assert.match(installNodeTool, /working-directory:\s*\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(installNodeTool, /npm install .*license-checker-rseidelsohn@5\.0\.1/);
});
