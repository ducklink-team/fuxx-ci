import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { eseguiRevisione } from './revisione.mjs';

// Normalizza un percorso come farebbe un checkout: separatori, maiuscole, "." e "..", punti/spazi finali.
export function segmentiPercorso(nome) {
  const pezzi = String(nome ?? '').normalize('NFKC').replace(/[\u0000-\u001f]/g, '').replace(/\\/g, '/').toLowerCase().split('/');
  const out = [];
  for (const p of pezzi) {
    if (p === '' || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(/^\.+$/.test(p) ? p : p.replace(/[. ]+$/, ''));
  }
  return out;
}

const ESTENSIONE_SQL = /\.(sql|psql|pgsql|ddl)$/i;
const CARTELLE_RISCHIO = new Set(['.github', '.fuxx', 'db', 'auth', 'middleware']);
const FILE_SPEC = new Set(['contratto-api.md', 'spec.md']);

function percorsoARischio(nome) {
  const seg = segmentiPercorso(nome);
  if (!seg.length) return true; // percorso non interpretabile: prudenza
  const file = seg.at(-1);
  const cartelle = seg.slice(0, -1);
  return seg.some(s => CARTELLE_RISCHIO.has(s))
    || cartelle.some(s => s.includes('migration'))
    || (cartelle.includes('specs') && FILE_SPEC.has(file))
    || /^middleware\./.test(file)
    || /^codeowners/.test(file)
    || /^\.env/.test(file)
    || /^\.?(gitleaks|semgrep)/.test(file);
}

export function fileARischio(file) {
  const nomi = [file.filename, file.previous_filename].filter(Boolean);
  if (!nomi.length || nomi.some(percorsoARischio)) return true;
  if (ESTENSIONE_SQL.test(file.previous_filename ?? '')) return true;
  if (!ESTENSIONE_SQL.test(file.filename)) return false;
  const testo = file.contenuto ?? file.patch;
  return typeof testo !== 'string' || /\bpolicy\b/i.test(testo);
}

function ghReale(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (errore) {
    // Non stampare log o contenuti remoti, potenzialmente sensibili.
    const e = new Error('Chiamata GitHub CLI fallita');
    if (/HTTP 404/.test(String(errore.stderr))) e.status = 404;
    throw e;
  }
}

export async function eseguiMerge(dati, gh = ghReale, revisore = eseguiRevisione) {
  const { repository, numero, runId, sha, controlli, workflowCi, modello, chiave } = dati;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(numero)) || !/^\d+$/.test(String(runId)) || !/^[a-f\d]{40}$/.test(sha)) throw new Error('Identificativi PR non validi');
  if (!Array.isArray(controlli) || !controlli.length || controlli.some(c => typeof c !== 'string' || !c)) throw new Error('Controlli obbligatori mancanti');
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(workflowCi ?? '')) throw new Error('Percorso del workflow CI non valido');
  const api = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`]));
  const pagine = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`, '--paginate', '--slurp']));
  const ferma = motivo => ({ unita: false, motivo });
  const pr = api(`pulls/${numero}`);
  const ammessa = p => p.state === 'open' && !p.draft && p.head.sha === sha && p.head.repo?.full_name === repository && p.base.repo?.full_name === repository && p.base.ref === 'main'
    && !p.labels.some(l => ['non-unire', 'serve-ok'].includes(l.name));
  if (!ammessa(pr)) return ferma('PR non ammessa, SHA cambiato, bozza, fork o etichetta di arresto');
  const files = pagine(`pulls/${numero}/files`).flat();
  if (!files.length || files.length >= 3000) return ferma('Elenco file assente o potenzialmente troncato');
  for (const file of files.filter(f => ESTENSIONE_SQL.test(f.filename) && f.status !== 'removed')) {
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
  // Provenienza: la CI di una PR gira con la definizione del ramo della PR. I nomi dei job valgono solo
  // se il run è del workflow atteso, il file è identico a quello del ramo base e i job sono check di GitHub Actions.
  const run = api(`actions/runs/${runId}`);
  if (run.head_sha !== sha || run.event !== 'pull_request' || run.head_repository?.full_name !== repository || String(run.path ?? '').split('@')[0] !== workflowCi) return ferma('Run CI non riferito al workflow atteso e allo SHA corrente');
  const blob = ref => api(`contents/${workflowCi}?ref=${ref}`).sha;
  const blobPr = blob(sha);
  if (typeof blobPr !== 'string' || blobPr !== blob(pr.base.ref)) return ferma('Il workflow CI della PR differisce da quello del ramo base');
  const jobs = pagine(`actions/runs/${runId}/jobs`).flatMap(p => p.jobs);
  for (const nome of controlli) {
    const trovati = jobs.filter(j => j.name === nome);
    if (trovati.length !== 1 || trovati[0].status !== 'completed' || trovati[0].conclusion !== 'success' || String(trovati[0].run_id) !== String(runId)) return ferma(`Controllo non verde: ${nome}`);
    const check = api(`check-runs/${trovati[0].id}`);
    if (check.app?.slug !== 'github-actions' || check.head_sha !== sha) return ferma(`Controllo non emesso da GitHub Actions per questo SHA: ${nome}`);
  }
  // Revisione AI: eseguita qui, con codice del repository fuxx-ci, sul diff trattato come dato.
  const diff = gh(['api', `repos/${repository}/pulls/${numero}`, '-H', 'Accept: application/vnd.github.diff']);
  const esito = await revisore({ diff, sha, chiave, modello });
  if (esito.verdetto !== 'OK' || esito.sha !== sha) {
    if (esito.dettaglio) console.log(`Dettaglio revisione: ${JSON.stringify(esito.dettaglio)}`);
    return ferma('Revisione BLOCK o non riferita allo SHA corrente');
  }
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
    const risultati = [];
    for (const pr of run.pull_requests ?? []) {
      risultati.push(await eseguiMerge({
        repository: process.env.GITHUB_REPOSITORY, numero: pr.number, runId: run.id, sha: run.head_sha,
        controlli: JSON.parse(process.env.CONTROLLI_OBBLIGATORI), workflowCi: process.env.WORKFLOW_CI,
        modello: process.env.MODELLO_REVISIONE, chiave: process.env.OPENROUTER_API_KEY,
      }));
    }
    const testo = risultati.length ? risultati.map(r => r.unita ? `Merge eseguito; demo: ${r.demo ? 'avviata' : 'assente'}` : `Merge sospeso: ${r.motivo}`).join('\n') : 'Nessuna PR associata: nessun merge';
    console.log(testo);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${testo}\n`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
