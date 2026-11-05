import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Estensioni SQL da leggere per intero e da trattare come SQL.
export const SQL = /\.(sql|psql|pgsql|ddl)$/i;
export const PERCORSI_A_RISCHIO = [
  'src/lib/sicurezza/**', 'src/proxy.ts', 'middleware.*', 'proxy.*',
  'src/lib/permessi/**', 'tests/permessi/**', 'scripts/controlli/permessi.mjs',
  '.fuxx/mattoni.json', '.fuxx/creazione.json',
];

// Percorso normalizzato per i controlli: separatori /, niente . e //, risoluzione di .., minuscole.
export function normalizzaPercorso(nome) {
  const pezzi = String(nome ?? '').replace(/\\/g, '/').split('/').filter(p => p !== '' && p !== '.');
  const risolti = [];
  for (const p of pezzi) { if (p === '..') risolti.pop(); else risolti.push(p); }
  return risolti.join('/').toLowerCase();
}

function percorsoARischio(nome) {
  const normalizzato = normalizzaPercorso(nome);
  if (PERCORSI_A_RISCHIO.some(modello => {
    const m = modello.toLowerCase();
    if (m.endsWith('/**')) return normalizzato.startsWith(m.slice(0, -2));
    if (m.endsWith('.*') && !m.includes('/')) return !normalizzato.includes('/') && normalizzato.startsWith(`${m.slice(0, -2)}.`);
    return normalizzato === m;
  })) return true;
  const pezzi = normalizzato.split('/');
  const base = pezzi.at(-1);
  const cartelle = pezzi.slice(0, -1);
  return cartelle.some(c => ['db', 'auth', '.github', '.fuxx', '__fuxx_ci'].includes(c) || c.includes('migration'))
    || (cartelle.includes('specs') && /^(contratto-api|spec)\.md$/.test(base))
    || /^middleware\.[^/]+$/.test(base)
    || /^codeowners/.test(base)
    || /^\.env/.test(base)
    || /^\.?(gitleaks|semgrep)/.test(base);
}

export function fileARischio(file) {
  return [file.filename, file.previous_filename].filter(Boolean).some(percorsoARischio)
    || SQL.test(file.previous_filename ?? '')
    || (SQL.test(file.filename) && (typeof (file.contenuto ?? file.patch) !== 'string' || /\bpolicy\b/i.test(file.contenuto ?? file.patch)));
}

export function leggiRevisione(log, sha) {
  // revisione-ai.mjs: OK esce 0, BLOCK esce 1 e scrive "BLOCK file:riga".
  if (/\bBLOCK\b/.test(log)) return 'BLOCK';
  const righe = [...log.matchAll(/FUXX_REVISIONE=(\{[^\r\n]*\})/g)];
  if (righe.length !== 1) return 'SCONOSCIUTA';
  try {
    const r = JSON.parse(righe[0][1]);
    return r.verdetto === 'OK' && r.sha === sha ? 'OK' : 'SCONOSCIUTA';
  } catch { return 'SCONOSCIUTA'; }
}

export function leggiCommentoRevisore(commenti, sha, base) {
  const candidati = commenti.filter(commento => commento?.user?.login === 'doubledrag33'
    && typeof commento.body === 'string'
    && commento.body.split(/\r?\n/).some(riga => /^ESITO:/.test(riga)));
  const ultimo = candidati.at(-1);
  if (!ultimo) return 'SCONOSCIUTA';
  // Il revisore scrive ESITO sulla prima riga e poi la prima riga SHA, costruita dal codice; dopo vengono
  // il riassunto del modello e i nomi dei file della PR, che possono contenere righe ESITO o SHA finte.
  // Quindi si legge il verdetto dalla prima riga e lo SHA dalla prima riga SHA, mai "una qualunque".
  const righe = ultimo.body.split(/\r?\n/);
  if (!/^ESITO:/.test(righe[0])) return 'SCONOSCIUTA';
  const esito = righe[0].match(/^ESITO:\s*(OK|BLOCCA)\s*$/)?.[1];
  const commentoSha = righe.find(riga => /^SHA:/.test(riga))?.match(/^SHA:\s*(\S+)\s*$/)?.[1];
  const commentoBase = righe.find(riga => /^Base:/.test(riga))?.match(/^Base:\s*(\S+)\s*$/)?.[1];
  return esito === 'OK' && commentoSha === sha && commentoBase === base ? 'OK' : (esito === 'BLOCCA' ? 'BLOCCA' : 'SCONOSCIUTA');
}

function ghReale(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (errore) {
    // Con --include anche gh non-zero conserva su stdout stato e corpo REST.
    // Il chiamante li interpreta senza stampare messaggi remoti.
    if (args.includes('--include') && /^HTTP\/\S+ \d{3}/.test(String(errore.stdout))) return String(errore.stdout);
    // Non stampare log della revisione o contenuti remoti, potenzialmente sensibili.
    const e = new Error('Chiamata GitHub CLI fallita');
    const status = String(errore.stderr).match(/HTTP (\d{3})/);
    if (status) e.status = Number(status[1]);
    throw e;
  }
}

// --raw-field mantiene letterali SHA, ref e titolo; --field serializza i booleani JSON.
function scriviApi(gh, repository, metodo, endpoint, dati = {}, leggiCorpo = false) {
  const args = ['api', `repos/${repository}/${endpoint}`, '--method', metodo, '--include'];
  for (const [nome, valore] of Object.entries(dati)) args.push(typeof valore === 'boolean' ? '-F' : '-f', `${nome}=${valore}`);
  const risposta = gh(args);
  const status = Number(risposta.match(/^HTTP\/\S+ (\d{3})\b/)?.[1]);
  const testo = risposta.split(/\r?\n\r?\n/).slice(1).join('\n\n');
  if (!status) throw new Error('Risposta API GitHub senza stato HTTP');
  if (status >= 400) {
    const e = new Error('Chiamata API GitHub fallita');
    e.status = status;
    e.protezione = /protected branch|branch protection|repository rule|rule violations|GH006|GH013/i.test(testo);
    throw e;
  }
  // Un corpo non usato o troncato non deve annullare un effetto remoto già riuscito.
  return { status, dati: leggiCorpo && testo.trim() ? JSON.parse(testo) : null };
}

function mergeCommentoRevisore(repository, numero, sha, pr, gh, api, ferma, avvisa) {
  // Base già confrontata con la prima riga Base: del commento approvato.
  const base = pr.base.sha;
  const temporaneo = `fuxx-merge/${numero}-${sha.slice(0, 8)}`;
  const refTemporaneo = `git/refs/heads/${temporaneo}`;
  const ramo = pr.base.ref.split('/').map(encodeURIComponent).join('/');
  const scrivi = (metodo, endpoint, dati, leggiCorpo) => scriviApi(gh, repository, metodo, endpoint, dati, leggiCorpo);
  // Se la creazione fallisce (anche per collisione), non cancellare un ref altrui.
  scrivi('POST', 'git/refs', { ref: `refs/heads/${temporaneo}`, sha: base });
  try {
    let unione;
    try {
      unione = scrivi('POST', 'merges', {
        base: temporaneo, head: sha,
        commit_message: `Merge PR #${numero}: ${pr.title} (revisore OK su ${sha.slice(0, 8)}, base ${base.slice(0, 8)})`,
      }, true);
    } catch (e) {
      if (e.status === 409) return ferma('conflitto durante il merge sulla base approvata');
      throw e;
    }
    if (unione.status === 204) return ferma('niente da unire sulla base approvata');
    if (unione.status !== 201 || !/^[a-f\d]{40}$/.test(unione.dati?.sha)) return ferma('commit di unione non verificabile');
    const genitori = unione.dati.parents;
    if (!Array.isArray(genitori) || genitori.length !== 2 || genitori[0].sha !== base || genitori[1].sha !== sha) return ferma('genitori del commit di unione diversi dalla coppia approvata');
    try {
      // Il fast-forward rifiuta avanzamenti di main esterni alla storia approvata.
      scrivi('PATCH', `git/refs/heads/${ramo}`, { sha: unione.dati.sha, force: false });
    } catch (e) {
      if (![403, 422].includes(e.status)) throw e;
      if (!e.protezione) return ferma(e.status === 422 ? 'main avanzato durante il merge: riprovo al giro dopo' : 'merge non vincolabile alla base: serve OK');
      let protezione;
      try { protezione = api(`branches/${ramo}/protection`); }
      catch (errore) { if (![403, 404].includes(errore.status)) throw errore; }
      if (protezione?.required_status_checks?.strict !== true) return ferma('merge non vincolabile alla base: serve OK');
      gh(['pr', 'merge', String(numero), '--repo', repository, '--merge', '--match-head-commit', sha]);
    }
  } finally {
    try { scrivi('DELETE', refTemporaneo); }
    catch { avvisa('ramo temporaneo lasciato: pulizia fallita'); }
  }
  if (pr.head.repo?.full_name === repository && pr.head.ref && pr.head.ref !== pr.base.ref) {
    try {
      if (typeof pr.base.repo.node_id !== 'string' || !pr.base.repo.node_id) {
        avvisa('ramo lasciato: identificativo GraphQL del repository assente');
      } else {
        // beforeOid e cancellazione sono un solo effetto atomico: mai un DELETE REST.
        // Schema: https://docs.github.com/en/graphql/reference/git#updaterefs
        const query = `mutation($repositoryId: ID!, $name: GitRefname!, $beforeOid: GitObjectID!, $afterOid: GitObjectID!, $force: Boolean!) {
          updateRefs(input: { repositoryId: $repositoryId, refUpdates: [{ name: $name, beforeOid: $beforeOid, afterOid: $afterOid, force: $force }] }) { clientMutationId }
        }`;
        const risposta = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`,
          '-f', `repositoryId=${pr.base.repo.node_id}`, '-f', `name=refs/heads/${pr.head.ref}`,
          '-f', `beforeOid=${sha}`, '-f', `afterOid=${'0'.repeat(40)}`, '-F', 'force=false']));
        // GraphQL può restituire errori anche con HTTP 200; nessun ripiego non condizionato.
        if (risposta?.errors?.length || !risposta?.data?.updateRefs) throw new Error('updateRefs non confermato');
      }
    } catch {
      avvisa('ramo lasciato: updateRefs rifiutato o non disponibile');
    }
  }
  return null;
}

export function eseguiMerge(dati, gh = ghReale) {
  const { repository, numero, runId, sha, controlli, revisione, modo = 'job-ci' } = dati;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(numero)) || !/^\d+$/.test(String(runId)) || !/^[a-f\d]{40}$/.test(sha)) throw new Error('Identificativi PR non validi');
  if (!Array.isArray(controlli) || !controlli.length || !revisione || !['job-ci', 'commento-revisore'].includes(modo)) throw new Error('Controlli obbligatori o modo di revisione non validi');
  const api = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`]));
  const pagine = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`, '--paginate', '--slurp']));
  const ferma = motivo => ({ unita: false, motivo });
  const pr = api(`pulls/${numero}`);
  const ammessa = p => p.state === 'open' && !p.draft && p.head.sha === sha && p.head.repo?.full_name === repository && p.base.repo?.full_name === repository && p.base.ref === 'main'
    && !p.labels.some(l => ['non-unire', 'serve-ok'].includes(l.name));
  if (!ammessa(pr)) return ferma('PR non ammessa, SHA cambiato, bozza, fork o etichetta di arresto');
  const files = pagine(`pulls/${numero}/files`).flat();
  if (!files.length || files.length >= 3000) return ferma('Elenco file assente o potenzialmente troncato');
  for (const file of files.filter(f => SQL.test(f.filename) && f.status !== 'removed')) {
    const percorso = file.filename.split('/').map(encodeURIComponent).join('/');
    const contenuto = api(`contents/${percorso}?ref=${sha}`);
    if (contenuto.encoding !== 'base64' || typeof contenuto.content !== 'string') return ferma('Contenuto SQL non verificabile');
    file.contenuto = Buffer.from(contenuto.content, 'base64').toString('utf8');
  }
  const rischiosi = files.filter(fileARischio);
  if (rischiosi.length && modo === 'job-ci') {
    gh(['label', 'create', 'serve-ok', '--repo', repository, '--color', 'D93F0B', '--description', 'Richiede OK del responsabile', '--force']);
    gh(['pr', 'edit', String(numero), '--repo', repository, '--add-label', 'serve-ok']);
    gh(['pr', 'comment', String(numero), '--repo', repository, '--body', `serve l'OK del responsabile: ${rischiosi.map(f => f.filename).join(', ')}`]);
    return ferma('File a rischio: serve OK del responsabile');
  }
  let commenti;
  if (modo === 'commento-revisore') {
    // Il nome dei job non prova nulla: un workflow qualunque con lo stesso nome li produrrebbe.
    // Il run deve venire da una pull_request con lo SHA corrente e il file del workflow deve essere
    // identico a quello su main (un workflow nuovo della PR non esiste su main e viene fermato).
    const run = api(`actions/runs/${runId}`);
    if (run.event !== 'pull_request' || run.head_sha !== sha || typeof run.path !== 'string') return ferma('Run dei controlli non riferito a una pull_request con lo SHA corrente');
    const percorso = run.path.split('@')[0].split('/').map(encodeURIComponent).join('/');
    const blob = ref => { try { return api(`contents/${percorso}?ref=${ref}`).sha; } catch (e) { if (e.status === 404) return null; throw e; } };
    const suMain = blob('main');
    if (!suMain || suMain !== blob(sha)) return ferma('Workflow dei controlli assente da main o diverso dallo SHA della PR');
  }
  const jobs = pagine(`actions/runs/${runId}/jobs`).flatMap(p => p.jobs).filter(j => modo === 'job-ci' || j.head_sha === sha);
  for (const nome of [...controlli, ...(modo === 'job-ci' ? [revisione] : [])]) {
    const trovati = jobs.filter(j => j.name === nome);
    if (trovati.length !== 1 || trovati[0].status !== 'completed' || trovati[0].conclusion !== 'success') return ferma(`Controllo non verde: ${nome}`);
  }
  if (modo === 'commento-revisore') {
    commenti = pagine(`issues/${numero}/comments`).flat();
  } else {
    const job = jobs.find(j => j.name === revisione);
    if (leggiRevisione(gh(['api', `repos/${repository}/actions/jobs/${job.id}/logs`]), sha) !== 'OK') return ferma('Revisione BLOCK, mancante o non riferita allo SHA corrente');
  }
  // Leggere prima del merge: un 403 non è equivalente a "demo assente".
  let demo = true;
  try { api('actions/workflows/demo.yml'); } catch (e) { if (e.status === 404) demo = false; else throw e; }
  const prFinale = api(`pulls/${numero}`);
  if (!ammessa(prFinale)) return ferma('PR cambiata durante i controlli');
  if (modo === 'commento-revisore' && leggiCommentoRevisore(commenti, sha, prFinale.base?.sha) !== 'OK') return ferma('Revisione commento mancante, BLOCCA o non riferita allo SHA corrente o alla base corrente');
  const avvisi = [];
  const avvisa = motivo => { avvisi.push(motivo); console.warn(`Avviso: ${motivo}`); };
  if (modo === 'commento-revisore') {
    const arresto = mergeCommentoRevisore(repository, numero, sha, prFinale, gh, api, ferma, avvisa);
    if (arresto) return arresto;
  } else {
    gh(['pr', 'merge', String(numero), '--repo', repository, '--squash', '--delete-branch', '--match-head-commit', sha]);
  }
  // GITHUB_TOKEN non innesca push: workflow_dispatch è un'eccezione documentata.
  let demoFallita = false;
  if (demo) {
    try { gh(['workflow', 'run', 'demo.yml', '--repo', repository, '--ref', 'main']); }
    catch (e) {
      if (modo !== 'commento-revisore') throw e;
      demo = false;
      demoFallita = true;
      avvisa('demo non avviata: dispatch fallito; rilanciare demo.yml manualmente su main');
    }
  }
  return { unita: true, demo, ...(demoFallita ? { demoFallita } : {}), ...(avvisi.length ? { avvisi } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evento = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const run = evento.workflow_run;
    if (!run || run.event !== 'pull_request' || run.conclusion !== 'success' || run.repository?.full_name && run.repository.full_name !== process.env.GITHUB_REPOSITORY) throw new Error('Richiesta ammessa solo dopo workflow_run PR concluso con successo');
    const risultati = (run.pull_requests ?? []).map(pr => eseguiMerge({
      repository: process.env.GITHUB_REPOSITORY, numero: pr.number, runId: run.id, sha: run.head_sha,
      controlli: JSON.parse(process.env.CONTROLLI_OBBLIGATORI), revisione: process.env.NOME_REVISIONE, modo: process.env.MODO_REVISIONE,
    }));
    const testo = risultati.length ? risultati.map(r => [r.unita ? `Merge eseguito; demo: ${r.demo ? 'avviata' : r.demoFallita ? 'non avviata' : 'assente'}` : `Merge sospeso: ${r.motivo}`, ...(r.avvisi ?? []).map(a => `Avviso: ${a}`)].join('\n')).join('\n') : 'Nessuna PR associata: nessun merge';
    console.log(testo);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${testo}\n`); }
      catch (e) {
        if (process.env.MODO_REVISIONE !== 'commento-revisore' || !risultati.some(r => r.unita)) throw e;
        console.warn('Avviso: riepilogo non scritto; il merge è già eseguito, consultare il log');
      }
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
