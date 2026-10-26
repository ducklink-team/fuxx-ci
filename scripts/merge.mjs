import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function fileARischio(file) {
  const percorso = nome => /^(specs\/(?:.*\/)?(?:contratto-api|spec)\.md|db\/|\.github\/|\.fuxx\/)/i.test(nome)
    || /(^|\/)(migrations|auth)\//i.test(nome)
    || /(^|\/)(middleware\.[^/]+|CODEOWNERS|\.env\.example)$/i.test(nome);
  return [file.filename, file.previous_filename].filter(Boolean).some(percorso)
    || /\.sql$/i.test(file.previous_filename ?? '')
    || (/\.sql$/i.test(file.filename) && (typeof (file.contenuto ?? file.patch) !== 'string' || /\bpolicy\b/i.test(file.contenuto ?? file.patch)));
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

function ghReale(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (errore) {
    // Non stampare log della revisione o contenuti remoti, potenzialmente sensibili.
    const e = new Error('Chiamata GitHub CLI fallita');
    if (/HTTP 404/.test(String(errore.stderr))) e.status = 404;
    throw e;
  }
}

export function eseguiMerge(dati, gh = ghReale) {
  const { repository, numero, runId, sha, controlli, revisione } = dati;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(numero)) || !/^\d+$/.test(String(runId)) || !/^[a-f\d]{40}$/.test(sha)) throw new Error('Identificativi PR non validi');
  if (!Array.isArray(controlli) || !controlli.length || !revisione) throw new Error('Controlli obbligatori mancanti');
  const api = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`]));
  const pagine = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`, '--paginate', '--slurp']));
  const ferma = motivo => ({ unita: false, motivo });
  const pr = api(`pulls/${numero}`);
  const ammessa = p => p.state === 'open' && !p.draft && p.head.sha === sha && p.head.repo?.full_name === repository && p.base.repo?.full_name === repository && p.base.ref === 'main'
    && !p.labels.some(l => ['non-unire', 'serve-ok'].includes(l.name));
  if (!ammessa(pr)) return ferma('PR non ammessa, SHA cambiato, bozza, fork o etichetta di arresto');
  const files = pagine(`pulls/${numero}/files`).flat();
  if (!files.length || files.length >= 3000) return ferma('Elenco file assente o potenzialmente troncato');
  for (const file of files.filter(f => /\.sql$/i.test(f.filename) && f.status !== 'removed')) {
    const percorso = file.filename.split('/').map(encodeURIComponent).join('/');
    const contenuto = api(`contents/${percorso}?ref=${sha}`);
    if (contenuto.encoding !== 'base64' || typeof contenuto.content !== 'string') return ferma('Contenuto SQL non verificabile');
    file.contenuto = Buffer.from(contenuto.content, 'base64').toString('utf8');
  }
  const rischiosi = files.filter(fileARischio);
  if (rischiosi.length) {
    gh(['label', 'create', 'serve-ok', '--repo', repository, '--color', 'D93F0B', '--description', 'Richiede OK del responsabile', '--force']);
    gh(['pr', 'edit', String(numero), '--repo', repository, '--add-label', 'serve-ok']);
    gh(['pr', 'comment', String(numero), '--repo', repository, '--body', `serve l'OK del responsabile: ${rischiosi.map(f => f.filename).join(', ')}`]);
    return ferma('File a rischio: serve OK del responsabile');
  }
  const jobs = pagine(`actions/runs/${runId}/jobs`).flatMap(p => p.jobs);
  for (const nome of [...controlli, revisione]) {
    const trovati = jobs.filter(j => j.name === nome);
    if (trovati.length !== 1 || trovati[0].status !== 'completed' || trovati[0].conclusion !== 'success') return ferma(`Controllo non verde: ${nome}`);
  }
  const job = jobs.find(j => j.name === revisione);
  if (leggiRevisione(gh(['api', `repos/${repository}/actions/jobs/${job.id}/logs`]), sha) !== 'OK') return ferma('Revisione BLOCK, mancante o non riferita allo SHA corrente');
  if (!ammessa(api(`pulls/${numero}`))) return ferma('PR cambiata durante i controlli');
  // Leggere prima del merge: un 403 non è equivalente a "demo assente".
  let demo = true;
  try { api('actions/workflows/demo.yml'); } catch (e) { if (e.status === 404) demo = false; else throw e; }
  gh(['pr', 'merge', String(numero), '--repo', repository, '--squash', '--delete-branch', '--match-head-commit', sha]);
  // GITHUB_TOKEN non innesca push: workflow_dispatch è un'eccezione documentata.
  if (demo) gh(['workflow', 'run', 'demo.yml', '--repo', repository, '--ref', 'main']);
  return { unita: true, demo };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evento = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const run = evento.workflow_run;
    if (!run || run.event !== 'pull_request' || run.conclusion !== 'success' || run.repository?.full_name && run.repository.full_name !== process.env.GITHUB_REPOSITORY) throw new Error('Richiesta ammessa solo dopo workflow_run PR concluso con successo');
    const risultati = (run.pull_requests ?? []).map(pr => eseguiMerge({
      repository: process.env.GITHUB_REPOSITORY, numero: pr.number, runId: run.id, sha: run.head_sha,
      controlli: JSON.parse(process.env.CONTROLLI_OBBLIGATORI), revisione: process.env.NOME_REVISIONE,
    }));
    const testo = risultati.length ? risultati.map(r => r.unita ? `Merge eseguito; demo: ${r.demo ? 'avviata' : 'assente'}` : `Merge sospeso: ${r.motivo}`).join('\n') : 'Nessuna PR associata: nessun merge';
    console.log(testo);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${testo}\n`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
