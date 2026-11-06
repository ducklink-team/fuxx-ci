import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

function scenario({ commenti = [], autore = 'doubledrag33', label = false, files = [{ filename: 'src/page.tsx' }], jobs = [], evento = 'pull_request', percorso = '.github/workflows/ci.yml', senzaWorkflowSuMain = false, blobPr = 'blob-main', shaJobs = sha, baseSha = baseApprovata, baseShaFinal = baseSha, baseRiletta = baseShaFinal, mergeStatus = 201, patchStatus = 200, patchProtezione = false, protezione = {}, erroreProtezione, createStatus = 201, erroreMerge = false, errorePulizia = false, erroreRipiego = false, parents = [baseShaFinal, sha], titolo = 'Pagina nuova', headRef = 'feat/pagina', headRepo = 'org/progetto', repositoryId = 'R_progetto', pushDopoApprovazione = false, erroreUpdateRefs = false, rispostaUpdateRefs, erroreDispatch = false, senzaDemo = false, corpoCreazione = undefined, corpoPatch = undefined } = {}) {
  const comandi = [];
  let prLette = 0;
  let ramoPrSha = sha;
  let ramoPrPresente = true;
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
        head: { sha, ref: headRef, repo: { full_name: headRepo } },
        base: { ref: 'main', repo: { full_name: 'org/progetto', node_id: repositoryId }, sha: prLette++ === 0 ? baseSha : baseShaFinal },
      });
    }
    if (endpoint === 'repos/org/progetto/git/refs' && args.includes('POST')) return corpoCreazione === undefined ? risposta(createStatus, { ref: `refs/heads/${temporaneo}` }) : `HTTP/2.0 ${createStatus}\r\n\r\n${corpoCreazione}`;
    if (endpoint === 'repos/org/progetto/merges' && args.includes('POST')) {
      if (erroreMerge) throw new Error('Rete non disponibile');
      return risposta(mergeStatus, mergeStatus === 204 ? undefined : { sha: commitUnione, parents: parents.map(sha => ({ sha })) });
    }
    if (endpoint === refMain && args.includes('PATCH')) {
      if (pushDopoApprovazione) ramoPrSha = 'b'.repeat(40);
      if (corpoPatch !== undefined) return `HTTP/2.0 ${patchStatus}\r\n\r\n${corpoPatch}`;
      return risposta(patchStatus, patchStatus === 200 ? { object: { sha: commitUnione } } : { message: patchProtezione ? 'Protected branch update failed. Changes must be made through a pull request.' : 'Update is not a fast forward' });
    }
    if (endpoint === refTemporaneo && args.includes('DELETE')) {
      if (errorePulizia) throw new Error('Pulizia fallita');
      return risposta(204);
    }
    if (endpoint === 'repos/org/progetto/git/refs/heads/feat/pagina' && args.includes('DELETE')) {
      ramoPrPresente = false;
      return risposta(204);
    }
    if (endpoint === 'graphql') {
      if (erroreUpdateRefs) throw new Error('updateRefs non disponibile');
      if (rispostaUpdateRefs !== undefined) return JSON.stringify(rispostaUpdateRefs);
      if (campi(args).beforeOid !== ramoPrSha) return JSON.stringify({ data: { updateRefs: null }, errors: [{ message: 'Reference does not match beforeOid' }] });
      ramoPrPresente = false;
      return JSON.stringify({ data: { updateRefs: { clientMutationId: null } } });
    }
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
    if (endpoint === 'repos/org/progetto/actions/workflows/demo.yml') {
      if (senzaDemo) throw http404();
      return JSON.stringify({ state: 'active' });
    }
    if (erroreDispatch && args[0] === 'workflow') throw new Error('Dispatch fallito');
    if (args[0] !== 'api') return '';
    throw new Error(`API inattesa: ${args.join(' ')}`);
  };
  return { comandi, gh, get ramoPrPresente() { return ramoPrPresente; } };
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
  const cancellaPr = s.comandi.findIndex(c => c[1] === 'graphql' && campi(c).query.includes('updateRefs'));
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

test('FX3: errore nella pulizia non viene nascosto', t => {
  const s = scenario({ commenti: [commento('OK')], errorePulizia: true });
  unitaConAvviso(s, t, /ramo temporaneo lasciato:.*pulizia/);
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

function demoLanciata(s) {
  assert.equal(s.comandi.filter(c => c.join(' ') === 'workflow run demo.yml --repo org/progetto --ref main').length, 1);
}

function nessunDeletePr(s) {
  assert.equal(s.comandi.some(c => c[0] === 'api' && c.includes('DELETE') && c[1] !== refTemporaneo), false);
}

test('FX4: ramo di fork non viene toccato', () => {
  const s = scenario({ commenti: [commento('OK')], headRepo: 'altro/fork' });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.equal(s.ramoPrPresente, true);
  assert.equal(s.comandi.some(c => c[1] === 'graphql' || c.includes('DELETE') || c.includes('PATCH') || c.includes('POST')), false);
});

for (const erroreDispatch of [false, true]) {
  test(`FX4: job-ci invariato con errore dispatch ${erroreDispatch}`, () => {
    const s = scenario({ jobs: [{ id: 123, name: 'Revisione AI', status: 'completed', conclusion: 'success' }], erroreDispatch });
    const gh = args => args[1]?.endsWith('/logs') ? `FUXX_REVISIONE={"verdetto":"OK","sha":"${sha}"}` : s.gh(args);
    if (erroreDispatch) assert.throws(() => eseguiMerge({ ...base, modo: 'job-ci' }, gh), /Dispatch fallito/);
    else assert.deepEqual(eseguiMerge({ ...base, modo: 'job-ci' }, gh), { unita: true, demo: true });
    assert.deepEqual(s.comandi.filter(c => c[0] === 'pr' && c[1] === 'merge'), [
      ['pr', 'merge', '7', '--repo', 'org/progetto', '--squash', '--delete-branch', '--match-head-commit', sha],
    ]);
    assert.equal(s.comandi.some(c => c[1] === 'graphql' || c.includes('DELETE') || c.includes('PATCH') || c.includes('POST')), false);
  });
}

test('FX4: demo assente non viene lanciata neppure dopo un avviso di pulizia', t => {
  const s = scenario({ commenti: [commento('OK')], senzaDemo: true, errorePulizia: true });
  t.mock.method(console, 'warn', () => {});
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(risultato.demo, false);
  assert.equal(risultato.demoFallita, undefined);
  assert.match(risultato.avvisi.join('\n'), /ramo temporaneo lasciato:/);
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
});

test('FX4: ramo PR cancellato solo con updateRefs e confronto atomico dello SHA approvato', () => {
  const s = scenario({ commenti: [commento('OK')] });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
  nessunDeletePr(s);
  const richieste = s.comandi.filter(c => c[1] === 'graphql');
  assert.equal(richieste.length, 1);
  const { query, ...variabili } = campi(richieste[0]);
  assert.match(query, /mutation\b/);
  assert.match(query, /updateRefs\(input:\s*\{\s*repositoryId:\s*\$repositoryId,\s*refUpdates:\s*\[\{\s*name:\s*\$name,\s*beforeOid:\s*\$beforeOid,\s*afterOid:\s*\$afterOid,\s*force:\s*\$force\s*\}\]\s*\}\)/);
  assert.deepEqual(variabili, { repositoryId: 'R_progetto', name: 'refs/heads/feat/pagina', beforeOid: sha, afterOid: '0'.repeat(40), force: false });
  assert.equal(s.ramoPrPresente, false);
  demoLanciata(s);
});

test('FX4: push sulla PR dopo l approvazione conserva il ramo e lancia demo dopo il merge', () => {
  const s = scenario({ commenti: [commento('OK')], pushDopoApprovazione: true });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(s.ramoPrPresente, true);
  assert.match(risultato.avvisi.join('\n'), /ramo lasciato:.*updateRefs/);
  nessunDeletePr(s);
  demoLanciata(s);
});

test('FX4: updateRefs non disponibile lascia il ramo e lancia demo', () => {
  const s = scenario({ commenti: [commento('OK')], erroreUpdateRefs: true });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(s.ramoPrPresente, true);
  assert.match(risultato.avvisi.join('\n'), /ramo lasciato:.*updateRefs/);
  nessunDeletePr(s);
  demoLanciata(s);
});

test('FX4: errori GraphQL nel corpo HTTP 200 sono segnalati senza ripiego DELETE', () => {
  const s = scenario({ commenti: [commento('OK')], rispostaUpdateRefs: { data: { updateRefs: null }, errors: [{ message: 'Field updateRefs does not exist' }] } });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(s.ramoPrPresente, true);
  assert.match(risultato.avvisi.join('\n'), /ramo lasciato:.*updateRefs/);
  nessunDeletePr(s);
  demoLanciata(s);
});

test('FX4: repository senza node_id lascia il ramo con motivo e lancia demo', () => {
  const s = scenario({ commenti: [commento('OK')], repositoryId: null });
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.equal(s.ramoPrPresente, true);
  assert.match(risultato.avvisi.join('\n'), /ramo lasciato:.*identificativo/);
  assert.equal(s.comandi.some(c => c[1] === 'graphql'), false);
  nessunDeletePr(s);
  demoLanciata(s);
});

function unitaConAvviso(s, t, motivo) {
  const log = [];
  t.mock.method(console, 'warn', messaggio => log.push(messaggio));
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, true);
  assert.match(risultato.avvisi.join('\n'), motivo);
  assert.match(log.join('\n'), motivo);
  demoLanciata(s);
  return risultato;
}

test('FX4: pulizia temporaneo fallita dopo il PATCH non impedisce pulizia PR e demo', t => {
  const s = scenario({ commenti: [commento('OK')], errorePulizia: true });
  const risultato = unitaConAvviso(s, t, /ramo temporaneo lasciato:.*pulizia/);
  assert.equal(risultato.demo, true);
  assert.equal(s.ramoPrPresente, false);
  assert.equal(s.comandi.filter(c => c[1] === 'graphql').length, 1);
});

test('FX4: fallimenti di entrambe le pulizie producono due avvisi e non saltano demo', t => {
  const s = scenario({ commenti: [commento('OK')], errorePulizia: true, erroreUpdateRefs: true });
  const risultato = unitaConAvviso(s, t, /ramo temporaneo lasciato:/);
  assert.equal(risultato.avvisi.length, 2);
  assert.match(risultato.avvisi[1], /ramo lasciato:.*updateRefs/);
  assert.equal(s.ramoPrPresente, true);
  nessunDeletePr(s);
});

test('FX4: dispatch demo fallito conserva il merge e avvisa di rilanciarlo manualmente', t => {
  const s = scenario({ commenti: [commento('OK')], erroreDispatch: true });
  const risultato = unitaConAvviso(s, t, /demo non avviata:.*dispatch.*manual/);
  assert.equal(risultato.demo, false);
  assert.equal(risultato.demoFallita, true);
});

test('FX4: anche dopo ripiego riuscito la pulizia fallita lascia il merge riuscito e lancia demo', t => {
  const s = scenario({ commenti: [commento('OK')], patchStatus: 422, patchProtezione: true, protezione: { required_status_checks: { strict: true } }, errorePulizia: true });
  unitaConAvviso(s, t, /ramo temporaneo lasciato:/);
  assert.equal(s.ramoPrPresente, false);
});

test('FX4: errore di pulizia non sostituisce l errore originale prima del merge', t => {
  const s = scenario({ commenti: [commento('OK')], erroreMerge: true, errorePulizia: true });
  const log = [];
  t.mock.method(console, 'warn', messaggio => log.push(messaggio));
  assert.throws(() => eseguiMerge(base, s.gh), /Rete non disponibile/);
  assert.match(log.join('\n'), /ramo temporaneo lasciato:/);
  assert.equal(s.ramoPrPresente, true);
  assert.equal(s.comandi.some(c => c[1] === 'graphql' || c[0] === 'workflow'), false);
});

test('FX4: errore di pulizia non sostituisce il motivo di sospensione prima del merge', t => {
  const s = scenario({ commenti: [commento('OK')], patchStatus: 422, errorePulizia: true });
  const log = [];
  t.mock.method(console, 'warn', messaggio => log.push(messaggio));
  const risultato = eseguiMerge(base, s.gh);
  assert.equal(risultato.unita, false);
  assert.match(risultato.motivo, /main avanzato/);
  assert.match(log.join('\n'), /ramo temporaneo lasciato:/);
  assert.equal(s.ramoPrPresente, true);
  assert.equal(s.comandi.some(c => c[1] === 'graphql' || c[0] === 'workflow'), false);
});

for (const campo of ['corpoCreazione', 'corpoPatch']) {
  test(`FX4: ${campo} non JSON con stato HTTP riuscito non perde pulizia o demo`, () => {
    const s = scenario({ commenti: [commento('OK')], [campo]: '{troncato' });
    assert.equal(eseguiMerge(base, s.gh).unita, true);
    assert.equal(s.comandi.filter(c => c[1] === refTemporaneo && c.includes('DELETE')).length, 1);
    demoLanciata(s);
  });
}

for (const riepilogoNonScrivibile of [false, true]) {
  test(riepilogoNonScrivibile ? 'FX4: errore scrittura riepilogo dopo il merge è solo avviso' : 'FX4: CLI esce 0 con merge eseguito e avvisi anche se pulizia e dispatch falliscono', () => {
    const directory = mkdtempSync(fileURLToPath(new URL('./.fx4-', import.meta.url)));
    try {
      const evento = `${directory}/evento.json`;
      const summary = `${directory}/${riepilogoNonScrivibile ? 'directory-assente/' : ''}summary.txt`;
      const stub = `${directory}/gh.mjs`;
      writeFileSync(evento, JSON.stringify({ workflow_run: { id: 90, event: 'pull_request', conclusion: 'success', head_sha: sha, pull_requests: [{ number: 7 }] } }));
      // Isola solo il confine gh: viene eseguito il vero ingresso CLI, compreso lo step summary.
      writeFileSync(stub, `import childProcess from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        const sha = ${JSON.stringify(sha)};
        const baseApprovata = ${JSON.stringify(baseApprovata)};
        const commitUnione = ${JSON.stringify(commitUnione)};
        const temporaneo = ${JSON.stringify(temporaneo)};
        const refTemporaneo = ${JSON.stringify(refTemporaneo)};
        const refMain = ${JSON.stringify(refMain)};
        ${campi.toString()}
        ${risposta.toString()}
        ${http404.toString()}
        ${scenario.toString()}
        const s = scenario({ commenti: [${JSON.stringify(commento('OK'))}], errorePulizia: true, erroreDispatch: true });
        childProcess.execFileSync = (comando, args) => {
          if (comando !== 'gh') throw new Error('Comando inatteso');
          return s.gh(args);
        };
        syncBuiltinESMExports();`);
      const processo = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, fileURLToPath(new URL('../merge.mjs', import.meta.url))], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, GITHUB_EVENT_PATH: evento, GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY: base.repository, CONTROLLI_OBBLIGATORI: JSON.stringify(base.controlli), NOME_REVISIONE: base.revisione, MODO_REVISIONE: base.modo },
      });
      assert.ifError(processo.error);
      assert.equal(processo.status, 0, processo.stderr);
      assert.match(processo.stdout, /Merge eseguito; demo: non avviata/);
      assert.match(processo.stderr, /Avviso: ramo temporaneo lasciato:/);
      assert.match(processo.stderr, /Avviso: demo non avviata:/);
      if (riepilogoNonScrivibile) {
        assert.match(processo.stderr, /Avviso: riepilogo non scritto/);
      } else {
        const riepilogo = readFileSync(summary, 'utf8');
        assert.match(riepilogo, /Merge eseguito; demo: non avviata/);
        assert.match(riepilogo, /ramo temporaneo lasciato:/);
        assert.match(riepilogo, /demo non avviata:/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
