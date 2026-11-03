import test from 'node:test';
import assert from 'node:assert/strict';
import { eseguiMerge } from '../merge.mjs';

const sha = 'a'.repeat(40);

function scenario({ commenti = [], autore = 'doubledrag33', label = false, files = [{ filename: 'src/page.tsx' }], jobs = [] } = {}) {
  const comandi = [];
  const gh = (args) => {
    comandi.push(args);
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') {
      return JSON.stringify({
        number: 7,
        state: 'open',
        draft: false,
        labels: label ? [{ name: 'non-unire' }] : [],
        head: { sha, repo: { full_name: 'org/progetto' } },
        base: { ref: 'main', repo: { full_name: 'org/progetto' } },
      });
    }
    if (endpoint?.endsWith('/files')) return JSON.stringify([files]);
    if (endpoint?.endsWith('/jobs')) return JSON.stringify([{ jobs: [
      { name: 'CI progetto', status: 'completed', conclusion: 'success' },
      { name: 'sicurezza / Sicurezza', status: 'completed', conclusion: 'success' },
      ...jobs,
    ] }]);
    if (endpoint?.endsWith('/comments')) return JSON.stringify([commenti.map(body => ({ user: { login: autore }, body }))]);
    if (endpoint === 'repos/org/progetto/actions/workflows/demo.yml') return JSON.stringify({ state: 'active' });
    return '';
  };
  return { comandi, gh };
}

const base = {
  repository: 'org/progetto',
  numero: 7,
  runId: 90,
  sha,
  controlli: ['CI progetto', 'sicurezza / Sicurezza'],
  modo: 'commento-revisore',
  revisione: 'Revisione AI',
};

function commento(esito, commentoSha = sha) {
  return `nota del revisore\nESITO: ${esito}\nSHA: ${commentoSha}`;
}

test('configurazione predefinita senza job Revisione AI si ferma', () => {
  const s = scenario();
  const risultato = eseguiMerge({ ...base, modo: 'job-ci' }, s.gh);
  assert.equal(risultato.unita, false);
  assert.match(risultato.motivo, /Controllo non verde: Revisione AI/);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});

test('commento revisore OK sullo SHA corrente unisce', () => {
  const s = scenario({ commenti: [commento('OK')] });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.ok(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'));
});

for (const [nome, opzioni, motivo] of [
  ['SHA vecchio', { commenti: [commento('OK', 'b'.repeat(40))] }, /SHA corrente/],
  ['BLOCCA', { commenti: [commento('BLOCCA')] }, /BLOCK|mancante|SHA corrente/],
  ['autore diverso', { commenti: [commento('OK')], autore: 'altra-persona' }, /mancante|SHA corrente/],
  ['nessun commento', {}, /mancante|SHA corrente/],
  ['etichetta non-unire', { commenti: [commento('OK')], label: true }, /etichetta/],
  ['file a rischio', { commenti: [commento('OK')], files: [{ filename: '.github/workflows/ci.yml' }] }, /rischio|responsabile/],
]) {
  test(`commento revisore: si ferma con motivo chiaro per ${nome}`, () => {
    const s = scenario(opzioni);
    const risultato = eseguiMerge(base, s.gh);
    assert.equal(risultato.unita, false);
    assert.match(risultato.motivo, motivo);
    assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  });
}
