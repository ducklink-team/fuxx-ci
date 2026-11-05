import test from 'node:test';
import assert from 'node:assert/strict';
import { PERCORSI_A_RISCHIO, fileARischio } from '../merge.mjs';

test('D-88: percorsi nuovi a rischio nella copia CI', () => {
  for (const filename of [
    'src/lib/sicurezza/csrf.ts', 'src/proxy.ts', 'middleware.ts', 'proxy.ts',
    'src/lib/permessi/ruoli.ts', 'tests/permessi/x.test.ts',
    'scripts/controlli/permessi.mjs', '.fuxx/mattoni.json', '.fuxx/creazione.json',
  ]) assert.equal(fileARischio({ filename }), true, filename);
});

test('D-88: la lista gemella non può perdere un percorso', () => {
  assert.ok(PERCORSI_A_RISCHIO.includes('src/proxy.ts'));
});
