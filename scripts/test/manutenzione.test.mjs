import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rolesPath = path.join(root, '.fuxx', 'ruoli.json');
const workflowPath = path.join(root, '.github', 'workflows', 'manutenzione.yml');

function stepNames(yaml) {
  return [...yaml.matchAll(/^\s+- name:\s+(.+)$/gm)].map((match) => match[1].trim());
}

test('la manutenzione è dispatchable e copre i passi cercati dal cruscotto', () => {
  const roles = JSON.parse(fs.readFileSync(rolesPath, 'utf8')).ruoli;
  const yaml = fs.readFileSync(workflowPath, 'utf8');
  const names = stepNames(yaml);

  assert.match(yaml, /(^|\n)\s+workflow_dispatch:\s*(#.*)?(?=\n|$)/);

  const patterns = {
    dipendenze: /dipendenz|libreri|renovate/i,
    sicurezza: /sicurezza|gitleaks|audit|segreti/i,
    pulizia: /pulizia/i,
  };
  for (const [roleName, pattern] of Object.entries(patterns)) {
    assert.equal(roles[roleName]?.prova?.tipo, 'workflow', `${roleName}: prova.workflow`);
    assert.equal(roles[roleName]?.prova?.valore, '.github/workflows/manutenzione.yml', `${roleName}: workflow manutenzione`);
    assert.ok(names.some((name) => pattern.test(name)), `${roleName}: manca un passo cercabile`);
  }
});
