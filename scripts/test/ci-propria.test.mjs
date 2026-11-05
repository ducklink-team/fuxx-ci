import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const percorso = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));

test('ci propria controlla le PR con npm test e senza segreti', () => {
  assert.equal(fs.existsSync(percorso), true, 'deve esistere .github/workflows/ci.yml');
  const workflow = fs.readFileSync(percorso, 'utf8');

  assert.match(workflow, /on:\s*\n\s+pull_request\b/);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read\b/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /run:\s*npm test\b/);
});
