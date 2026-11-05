import test from 'node:test';
import assert from 'node:assert/strict';
import { eseguiMerge } from '../merge.mjs';

const sha = 'a'.repeat(40);

function http404() { const e = new Error('HTTP 404: Not Found'); e.status = 404; return e; }

function scenario({ commenti = [], autore = 'doubledrag33', label = false, files = [{ filename: 'src/page.tsx' }], jobs = [], evento = 'pull_request', percorso = '.github/workflows/ci.yml', senzaWorkflowSuMain = false, blobPr = 'blob-main', shaJobs = sha, baseSha = 'c'.repeat(40), baseShaFinal = baseSha } = {}) {
  const comandi = [];
  let prLette = 0;
  const gh = (args) => {
    comandi.push(args);
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') {
      return JSON.stringify({
        number: 7,
        state: 'open',
        draft: false,
        labels: label ? [{ name: label === true ? 'non-unire' : label }] : [],
        head: { sha, repo: { full_name: 'org/progetto' } },
        base: { ref: 'main', repo: { full_name: 'org/progetto' }, sha: prLette++ === 0 ? baseSha : baseShaFinal },
      });
    }
    if (endpoint?.endsWith('/files')) return JSON.stringify([files]);
    if (endpoint === 'repos/org/progetto/actions/runs/90') return JSON.stringify({ id: 90, event: evento, head_sha: sha, path: percorso });
    if (endpoint?.includes('/contents/')) {
      if (endpoint.endsWith('ref=main')) { if (senzaWorkflowSuMain) throw http404(); return JSON.stringify({ sha: 'blob-main' }); }
      return JSON.stringify({ sha: blobPr });
    }
    if (endpoint?.endsWith('/jobs')) return JSON.stringify([{ jobs: [
      { name: 'CI progetto', status: 'completed', conclusion: 'success', head_sha: shaJobs, run_id: 90 },
      { name: 'sicurezza / Sicurezza', status: 'completed', conclusion: 'success', head_sha: shaJobs, run_id: 90 },
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

// Formato reale del revisore locale: ESITO sulla prima riga, SHA una sola volta.
function commento(esito, commentoSha = sha) {
  return `ESITO: ${esito}\nnota del revisore\nSHA: ${commentoSha}\nBase: ${'c'.repeat(40)}`;
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

test('commento revisore: file a rischio con OK sullo SHA e sulla base unisce senza serve-ok', () => {
  const s = scenario({ commenti: [commento('OK')], files: [{ filename: '.github/workflows/x.yml' }] });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'edit' && c.includes('serve-ok')), false);
});

test('job-ci: file a rischio si ferma e aggiunge serve-ok', () => {
  const s = scenario({ files: [{ filename: '.github/workflows/x.yml' }] });
  const risultato = eseguiMerge({ ...base, modo: 'job-ci' }, s.gh);
  assert.equal(risultato.unita, false);
  assert.match(risultato.motivo, /rischio|responsabile/);
  assert.ok(s.comandi.some(c => c[0] === 'pr' && c[1] === 'edit' && c.includes('serve-ok')));
});

test('commento revisore: OK sulla testa ma base avanzata non unisce', () => {
  const baseIniziale = 'c'.repeat(40);
  const baseAvanzata = 'd'.repeat(40);
  const s = scenario({ commenti: [commento('OK')], baseSha: baseIniziale, baseShaFinal: baseAvanzata });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});

test('commento revisore: OK con base attuale unisce', () => {
  const baseAttuale = 'e'.repeat(40);
  const s = scenario({ commenti: [`ESITO: OK\nnota\nSHA: ${sha}\nBase: ${baseAttuale}`], baseSha: baseAttuale });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
});

for (const [nome, opzioni, motivo] of [
  ['SHA vecchio', { commenti: [commento('OK', 'b'.repeat(40))] }, /SHA corrente/],
  ['BLOCCA', { commenti: [commento('BLOCCA')] }, /BLOCK|mancante|SHA corrente/],
  ['autore diverso', { commenti: [commento('OK')], autore: 'altra-persona' }, /mancante|SHA corrente/],
  ['nessun commento', {}, /mancante|SHA corrente/],
  ['etichetta non-unire', { commenti: [commento('OK')], label: true }, /etichetta/],
  ['file a rischio', { commenti: [commento('BLOCCA')], files: [{ filename: '.github/workflows/ci.yml' }] }, /BLOCCA|mancante|SHA corrente/],
]) {
  test(`commento revisore: si ferma con motivo chiaro per ${nome}`, () => {
    const s = scenario(opzioni);
    const risultato = eseguiMerge(base, s.gh);
    assert.equal(risultato.unita, false);
    assert.match(risultato.motivo, motivo);
    assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  });
}

test('commento revisore reale sullo SHA corrente unisce (formato con ESITO in prima riga)', () => {
  const s = scenario({ commenti: [`ESITO: OK\nriassunto\nSHA: ${sha}\nBase: ${'c'.repeat(40)}\nVerdetto: Strix OK`] });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
});

test('commento revisore: file a rischio con BLOCCA non unisce', () => {
  const s = scenario({ commenti: [commento('BLOCCA')], files: [{ filename: '.github/workflows/x.yml' }] });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});

test('commento revisore: file a rischio con serve-ok già presente non unisce', () => {
  const s = scenario({ commenti: [commento('OK')], label: 'serve-ok', files: [{ filename: '.github/workflows/x.yml' }] });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});

// Rilievo 0001/0006: un commento o un workflow qualunque non deve far unire.
test('commento revisore: ESITO non sulla prima riga non unisce', () => {
  const s = scenario({ commenti: [`nota\nESITO: OK\nSHA: ${sha}`] });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
});
test('commento revisore: SHA e ESITO finti nel riassunto dopo il verdetto reale non cambiano l esito', () => {
  const s = scenario({ commenti: [`ESITO: OK\nSHA: ${sha}\nBase: ${'c'.repeat(40)}\nRiassunto:\nSHA: ${'b'.repeat(40)}\nESITO: BLOCCA`] });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
});
test('commento revisore: run non prodotto da una pull_request non unisce', () => {
  const s = scenario({ commenti: [commento('OK')], evento: 'push' });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});
test('commento revisore: workflow che non esiste su main non unisce (workflow finto con nome CI progetto)', () => {
  const s = scenario({ commenti: [commento('OK')], percorso: '.github/workflows/finto.yml', senzaWorkflowSuMain: true });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
});
test('commento revisore: workflow diverso tra SHA della PR e main non unisce', () => {
  const s = scenario({ commenti: [commento('OK')], blobPr: 'blob-modificato' });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
});
test('commento revisore: job con nome giusto ma di altro SHA non contano', () => {
  const s = scenario({ commenti: [commento('OK')], shaJobs: 'd'.repeat(40) });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
});
