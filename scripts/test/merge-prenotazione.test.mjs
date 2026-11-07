import test from 'node:test';
import assert from 'node:assert/strict';
import { eseguiMerge } from '../merge.mjs';

const sha = 'a'.repeat(40);
const base = { repository: 'org/progetto', numero: 7, runId: 90, sha, controlli: ['CI progetto'], revisione: 'Revisione AI' };

function scenario(eta, eventiDisponibili = true) {
  const comandi = [];
  let letture = 0;
  const pr = {
    number: 7, state: 'open', draft: false,
    labels: [{ name: 'in-lavorazione' }],
    head: { sha, repo: { full_name: 'org/progetto' } },
    base: { ref: 'main', repo: { full_name: 'org/progetto' } },
  };
  const gh = args => {
    comandi.push(args);
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') { letture++; return JSON.stringify(pr); }
    if (endpoint?.endsWith('/files')) return JSON.stringify([[{ filename: 'src/page.tsx' }]]);
    if (endpoint === 'repos/org/progetto/issues/7/events' && eventiDisponibili) {
      return JSON.stringify([[{ event: 'labeled', label: { name: 'in-lavorazione' }, created_at: new Date(Date.now() - eta).toISOString() }]]);
    }
    if (endpoint?.endsWith('/jobs')) return JSON.stringify([{ jobs: [
      { id: 1, name: 'CI progetto', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'Revisione AI', status: 'completed', conclusion: 'success' },
    ] }]);
    if (endpoint?.endsWith('/logs')) return `FUXX_REVISIONE={"verdetto":"OK","sha":"${sha}"}`;
    if (endpoint === 'repos/org/progetto/actions/workflows/demo.yml') return JSON.stringify({ state: 'active' });
    return '';
  };
  return { comandi, gh };
}

test('in-lavorazione di 10 minuti ferma la PR con il tempo nel motivo', () => {
  const s = scenario(10 * 60 * 1000);
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, false);
  assert.match(risultato.motivo, /^fermata: in-lavorazione da 10 min$/);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});

test('in-lavorazione di 3 ore è scaduta e la PR si unisce', () => {
  const s = scenario(3 * 60 * 60 * 1000);
  assert.equal(eseguiMerge(base, s.gh).unita, true);
});

test('età di in-lavorazione non leggibile ferma la PR', () => {
  const s = scenario(10 * 60 * 1000, false);
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, false);
  assert.equal(risultato.motivo, 'fermata: in-lavorazione da età non leggibile');
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});
