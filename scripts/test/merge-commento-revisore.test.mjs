import test from 'node:test';
import assert from 'node:assert/strict';
import { eseguiMerge } from '../merge.mjs';

const sha = 'a'.repeat(40);
const baseApprovata = 'c'.repeat(40);
const commitUnione = 'f'.repeat(40);
const temporaneo = `fuxx-merge/7-${sha.slice(0, 8)}`;
const refTemporaneo = `repos/org/progetto/git/refs/heads/${temporaneo}`;
const refMain = 'repos/org/progetto/git/refs/heads/main';

function campi(args) {
  const dati = {};
  for (let i = 0; i < args.length; i++) {
    if (!['-f', '-F', '--raw-field', '--field'].includes(args[i])) continue;
    const tipo = args[i];
    const [chiave, ...valore] = args[++i].split('=');
    const testo = valore.join('=');
    dati[chiave] = ['-F', '--field'].includes(tipo) && ['false', 'true'].includes(testo) ? testo === 'true' : testo;
  }
  return dati;
}

function risposta(status, body) { return `HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n${body === undefined ? '' : JSON.stringify(body)}`; }

function http404() { const e = new Error('HTTP 404: Not Found'); e.status = 404; return e; }

function scenario({ commenti = [], autore = 'doubledrag33', label = false, files = [{ filename: 'src/page.tsx' }], jobs = [], evento = 'pull_request', percorso = '.github/workflows/ci.yml', senzaWorkflowSuMain = false, blobPr = 'blob-main', shaJobs = sha, baseSha = baseApprovata, baseShaFinal = baseSha, baseRiletta = baseShaFinal, mergeStatus = 201, patchStatus = 200, patchProtezione = false, protezione = {}, erroreProtezione, createStatus = 201, erroreMerge = false, errorePulizia = false, erroreRipiego = false, parents = [baseShaFinal, sha], titolo = 'Pagina nuova', headRef = 'feat/pagina' } = {}) {
  const comandi = [];
  let prLette = 0;
  const gh = (args) => {
    comandi.push(args);
    if (erroreRipiego && args[0] === 'pr' && args[1] === 'merge') throw new Error('Ripiego rifiutato');
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') {
      return JSON.stringify({
        number: 7,
        title: titolo,
        state: 'open',
        draft: false,
        labels: label ? [{ name: label === true ? 'non-unire' : label }] : [],
        head: { sha, ref: headRef, repo: { full_name: 'org/progetto' } },
        base: { ref: 'main', repo: { full_name: 'org/progetto' }, sha: prLette++ === 0 ? baseSha : baseShaFinal },
      });
    }
    if (endpoint === 'repos/org/progetto/git/refs' && args.includes('POST')) return risposta(createStatus, { ref: `refs/heads/${temporaneo}` });
    if (endpoint === 'repos/org/progetto/merges' && args.includes('POST')) {
      if (erroreMerge) throw new Error('Rete non disponibile');
      return risposta(mergeStatus, mergeStatus === 204 ? undefined : { sha: commitUnione, parents: parents.map(sha => ({ sha })) });
    }
    if (endpoint === refMain && args.includes('PATCH')) return risposta(patchStatus, patchStatus === 200 ? { object: { sha: commitUnione } } : { message: patchProtezione ? 'Protected branch update failed. Changes must be made through a pull request.' : 'Update is not a fast forward' });
    if (endpoint === refTemporaneo && args.includes('DELETE')) {
      if (errorePulizia) throw new Error('Pulizia fallita');
      return risposta(204);
    }
    if (endpoint === 'repos/org/progetto/git/refs/heads/feat/pagina' && args.includes('DELETE')) return risposta(204);
    if (endpoint === 'repos/org/progetto/git/ref/heads/main') return JSON.stringify({ object: { sha: baseRiletta } });
    if (endpoint === 'repos/org/progetto/branches/main/protection') {
      if (erroreProtezione) { const e = new Error(`HTTP ${erroreProtezione}`); e.status = erroreProtezione; throw e; }
      return JSON.stringify(protezione);
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
    if (args[0] !== 'api') return '';
    throw new Error(`API inattesa: ${args.join(' ')}`);
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
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  const creazione = s.comandi.find(c => c[1] === 'repos/org/progetto/git/refs' && c.includes('POST'));
  assert.deepEqual(campi(creazione), { ref: `refs/heads/${temporaneo}`, sha: baseApprovata });
  const unione = s.comandi.find(c => c[1] === 'repos/org/progetto/merges');
  assert.deepEqual(campi(unione), { base: temporaneo, head: sha, commit_message: 'Merge PR #7: Pagina nuova (revisore OK su aaaaaaaa, base cccccccc)' });
  const aggiorna = s.comandi.find(c => c[1] === refMain && c.includes('PATCH'));
  assert.deepEqual(campi(aggiorna), { sha: commitUnione, force: false });
  const pulizia = s.comandi.findIndex(c => c[1] === refTemporaneo && c.includes('DELETE'));
  const cancellaPr = s.comandi.findIndex(c => c[1] === 'repos/org/progetto/git/refs/heads/feat/pagina' && c.includes('DELETE'));
  const demo = s.comandi.findIndex(c => c.join(' ') === 'workflow run demo.yml --repo org/progetto --ref main');
  assert.ok(s.comandi.indexOf(creazione) < s.comandi.indexOf(unione));
  assert.ok(s.comandi.indexOf(unione) < s.comandi.indexOf(aggiorna));
  assert.ok(pulizia > s.comandi.indexOf(aggiorna));
  assert.ok(cancellaPr > pulizia);
  assert.ok(demo > cancellaPr);
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

function senzaUnione(s, motivo) {
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, false);
  assert.match(risultato.motivo, motivo);
  assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
  assert.equal(s.comandi.some(c => c[1] === 'repos/org/progetto/git/refs/heads/feat/pagina' && c.includes('DELETE')), false);
  assert.equal(s.comandi.filter(c => c[1] === refTemporaneo && c.includes('DELETE')).length, 1);
}

test('FX3: main avanzato durante il PATCH si ferma e cancella il temporaneo', () => {
  const s = scenario({ commenti: [commento('OK')], patchStatus: 422 });
  senzaUnione(s, /^main avanzato durante il merge: riprovo al giro dopo$/);
  assert.equal(s.comandi.some(c => c[1]?.endsWith('/protection')), false);
});

for (const [mergeStatus, motivo] of [[409, /conflitto/], [204, /niente da unire/]]) {
  test(`FX3: merges ${mergeStatus} si ferma e pulisce senza spostare main`, () => {
    const s = scenario({ commenti: [commento('OK')], mergeStatus });
    senzaUnione(s, motivo);
    assert.equal(s.comandi.some(c => c[1] === refMain && c.includes('PATCH')), false);
  });
}

for (const patchStatus of [403, 422]) {
  test(`FX3: protezione PATCH ${patchStatus} con strict=true usa solo merge vincolato alla testa`, () => {
    const s = scenario({ commenti: [commento('OK')], patchStatus, patchProtezione: true, protezione: { required_status_checks: { strict: true } } });
    assert.equal(eseguiMerge(base, s.gh).unita, true);
    assert.deepEqual(s.comandi.filter(c => c[0] === 'pr' && c[1] === 'merge'), [
      ['pr', 'merge', '7', '--repo', 'org/progetto', '--merge', '--match-head-commit', sha],
    ]);
    assert.ok(s.comandi.some(c => c[1] === refTemporaneo && c.includes('DELETE')));
    const indiceProtezione = s.comandi.findIndex(c => c[1]?.endsWith('/protection'));
    assert.ok(indiceProtezione > s.comandi.findIndex(c => c[1] === refMain && c.includes('PATCH')));
    assert.ok(indiceProtezione < s.comandi.findIndex(c => c[0] === 'pr' && c[1] === 'merge'));
  });
}

for (const [nome, protezione] of [
  ['assente', {}], ['checks assenti', { required_status_checks: null }],
  ['false', { required_status_checks: { strict: false } }],
  ['stringa true', { required_status_checks: { strict: 'true' } }],
]) {
  test(`FX3: protezione senza strict booleano true (${nome}) ferma il ripiego`, () => {
    senzaUnione(scenario({ commenti: [commento('OK')], patchStatus: 422, patchProtezione: true, protezione }), /^merge non vincolabile alla base: serve OK$/);
  });
}

for (const erroreProtezione of [403, 404]) {
  test(`FX3: protezione non leggibile (${erroreProtezione}) ferma il ripiego`, () => {
    senzaUnione(scenario({ commenti: [commento('OK')], patchStatus: 403, patchProtezione: true, erroreProtezione }), /^merge non vincolabile alla base: serve OK$/);
  });
}

test('FX3: 403 generico non autorizza il ripiego nemmeno con strict=true', () => {
  const s = scenario({ commenti: [commento('OK')], patchStatus: 403, protezione: { required_status_checks: { strict: true } } });
  senzaUnione(s, /^merge non vincolabile alla base: serve OK$/);
  assert.equal(s.comandi.some(c => c[1]?.endsWith('/protection')), false);
});

test('FX3: creazione sempre sulla base approvata anche se una lettura di main darebbe altro', () => {
  const baseDiversa = 'e'.repeat(40);
  const s = scenario({ commenti: [commento('OK')], baseSha: 'd'.repeat(40), baseShaFinal: baseApprovata, baseRiletta: baseDiversa });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
  const creazione = s.comandi.find(c => c[1] === 'repos/org/progetto/git/refs' && c.includes('POST'));
  assert.equal(campi(creazione).sha, baseApprovata);
});

test('FX3: nessuna richiesta usa force true, nemmeno nel ripiego', () => {
  for (const opzioni of [{}, { patchStatus: 422, patchProtezione: true, protezione: { required_status_checks: { strict: true } } }]) {
    const s = scenario({ commenti: [commento('OK')], ...opzioni });
    assert.equal(eseguiMerge(base, s.gh).unita, true);
    const patch = s.comandi.filter(c => c.includes('PATCH'));
    assert.equal(patch.length, 1);
    assert.equal(campi(patch[0]).force, false);
    assert.equal(s.comandi.some(c => [true, 'true'].includes(campi(c).force)), false);
  }
});

test('FX3: errore di rete dopo la creazione pulisce il temporaneo', () => {
  const s = scenario({ commenti: [commento('OK')], erroreMerge: true });
  assert.throws(() => eseguiMerge(base, s.gh), /Rete non disponibile/);
  assert.ok(s.comandi.some(c => c[1] === refTemporaneo && c.includes('DELETE')));
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
});

test('FX3: collisione sul temporaneo non cancella un ramo altrui', () => {
  const s = scenario({ commenti: [commento('OK')], createStatus: 422 });
  assert.throws(() => eseguiMerge(base, s.gh));
  assert.equal(s.comandi.some(c => c.includes('DELETE') || c[1] === refMain || c[1] === 'repos/org/progetto/merges'), false);
});

test('FX3: errore nella pulizia non viene nascosto', () => {
  const s = scenario({ commenti: [commento('OK')], errorePulizia: true });
  assert.throws(() => eseguiMerge(base, s.gh), /Pulizia fallita/);
});

test('FX3: ripiego rifiutato pulisce il temporaneo senza cancellare la testa o avviare demo', () => {
  const s = scenario({ commenti: [commento('OK')], patchStatus: 422, patchProtezione: true, protezione: { required_status_checks: { strict: true } }, erroreRipiego: true });
  assert.throws(() => eseguiMerge(base, s.gh), /Ripiego rifiutato/);
  assert.ok(s.comandi.some(c => c[1] === refTemporaneo && c.includes('DELETE')));
  assert.equal(s.comandi.some(c => c[1] === 'repos/org/progetto/git/refs/heads/feat/pagina' && c.includes('DELETE')), false);
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
});

for (const parents of [[sha], ['d'.repeat(40), sha], [baseApprovata, 'b'.repeat(40)]]) {
  test(`FX3: commit senza i genitori approvati ${parents.map(p => p.slice(0, 8)).join(',')} non raggiunge main`, () => {
    const s = scenario({ commenti: [commento('OK')], parents });
    senzaUnione(s, /genitori/);
    assert.equal(s.comandi.some(c => c[1] === refMain && c.includes('PATCH')), false);
  });
}

test('FX3: titolo remoto passato letteralmente nel messaggio via raw-field', () => {
  const titolo = '@file $(echo segreto) `comando` = fine\nseconda riga';
  const s = scenario({ commenti: [commento('OK')], titolo });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
  const richiesta = s.comandi.find(c => c[1] === 'repos/org/progetto/merges');
  const indice = richiesta.findIndex(c => c.startsWith('commit_message='));
  assert.ok(['-f', '--raw-field'].includes(richiesta[indice - 1]));
  assert.equal(campi(richiesta).commit_message, `Merge PR #7: ${titolo} (revisore OK su aaaaaaaa, base cccccccc)`);
});
