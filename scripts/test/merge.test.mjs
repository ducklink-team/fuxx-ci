import test from 'node:test';
import assert from 'node:assert/strict';
import { fileARischio, eseguiMerge } from '../merge.mjs';

for (const nome of ['specs/uno/contratto-api.md', 'specs/uno/spec.md', 'supabase/migrations/a.sql', 'src/migrations/a.js', 'migrations/a.py', 'db/schema.json', 'src/auth/login.ts', 'auth/login.ts', 'middleware.ts', 'src/middleware.js', '.github/workflows/ci.yml', '.env.example', '.fuxx/ruoli.json', 'src/middleware/index.ts', 'src/db/schema.json', 'dbmigrations/001_init.sql', 'codeowners.bak', '.env.sample', 'a/b/.github/x', 'packages/app/.fuxx/y', 'specs/nested/deep/spec.md', 'x/specs/a/spec.md', 'SRC/Middleware/a.ts', 'src//db/./a.ts', 'src\\db\\a.ts', 'src/db./a.ts', '.semgrepignore', 'sub/.gitleaksignore', 'supabase/seed.psql', 'CODEOWNERS', '.github/CODEOWNERS']) {
  test(`file a rischio: ${nome}`, () => assert.equal(fileARischio({ filename: nome }), true));
}
for (const nome of ['src/page.tsx', 'README.md', 'src/author.ts', 'specs/uno/tasks.md']) {
  test(`file ordinario: ${nome}`, () => assert.equal(fileARischio({ filename: nome }), false));
}
test('SQL con policy anche maiuscola è a rischio', () => assert.equal(fileARischio({ filename: 'schema.sql', patch: '+CREATE POLICY utenti ON utenti;' }), true));
test('SQL senza policy non è a rischio', () => assert.equal(fileARischio({ filename: 'schema.sql', patch: '+CREATE TABLE utenti(id int);' }), false));
test('SQL senza patch si ferma per prudenza', () => assert.equal(fileARischio({ filename: 'schema.sql' }), true));
test('policy fuori dal diff è rilevata nel contenuto SQL completo', () => assert.equal(fileARischio({ filename: 'schema.sql', patch: '+-- commento', contenuto: 'CREATE POLICY accesso ON utenti;\n-- commento' }), true));
test('rinomina SQL in un file non SQL resta a rischio', () => assert.equal(fileARischio({ filename: 'schema.txt', previous_filename: 'schema.sql' }), true));
test('rinomina di un file a rischio non aggira il controllo', () => assert.equal(fileARischio({ filename: 'old.md', previous_filename: 'specs/a/spec.md' }), true));
const sha = 'a'.repeat(40);
const wf = '.github/workflows/ci.yml';
function scenario(opzioni = {}) {
  const comandi = [];
  let letture = 0;
  const pr = { number: 7, state: 'open', draft: false, labels: [], head: { sha, repo: { full_name: 'org/progetto' } }, base: { ref: 'main', repo: { full_name: 'org/progetto' } }, ...opzioni.pr };
  const gh = (args) => {
    comandi.push(args);
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') {
      if (args.includes('Accept: application/vnd.github.diff')) return opzioni.diff ?? '+ciao';
      letture++;
      return JSON.stringify(letture > 1 && opzioni.cambioSha ? { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } } : pr);
    }
    if (endpoint === 'repos/org/progetto/actions/runs/90') return JSON.stringify({ head_sha: sha, event: 'pull_request', head_repository: { full_name: 'org/progetto' }, path: `${wf}@refs/pull/7/merge`, ...opzioni.run });
    if (endpoint?.startsWith(`repos/org/progetto/contents/${wf}?ref=`)) return JSON.stringify({ sha: endpoint.endsWith(sha) && opzioni.workflowModificato ? 'blob-pr' : 'blob-base' });
    if (endpoint?.startsWith('repos/org/progetto/check-runs/')) return JSON.stringify({ app: { slug: opzioni.appFinta ? 'altra-app' : 'github-actions' }, head_sha: sha });
    if (endpoint?.endsWith('/files')) return JSON.stringify([opzioni.files ?? [{ filename: 'src/page.tsx' }]]);
    if (endpoint?.includes('/contents/')) return JSON.stringify({ encoding: 'base64', content: Buffer.from(opzioni.sql ?? 'CREATE TABLE utenti(id int);').toString('base64') });
    if (endpoint?.endsWith('/jobs')) return JSON.stringify([{ jobs: ['CI progetto', 'sicurezza / Sicurezza'].map((name, i) => ({ id: i + 1, run_id: 90, name, status: 'completed', conclusion: opzioni.ciRossa && i === 0 ? 'failure' : 'success' })) }]);
    if (endpoint === 'repos/org/progetto/actions/workflows/demo.yml') {
      if (opzioni.senzaDemo) { const e = new Error('HTTP 404: Not Found'); e.status = 404; throw e; }
      if (opzioni.erroreDemo) throw new Error('HTTP 403: Forbidden');
      return JSON.stringify({ state: 'active' });
    }
    return '';
  };
  const revisore = async (d) => { comandi.push(['revisore', d.diff]); return opzioni.revisione ?? { verdetto: 'OK', sha }; };
  return { comandi, gh, revisore };
}
const base = { repository: 'org/progetto', numero: 7, runId: 90, sha, controlli: ['CI progetto', 'sicurezza / Sicurezza'], workflowCi: wf, modello: 'm', chiave: 'k' };
for (const [nome, opzioni] of Object.entries({ bozza: { pr: { draft: true } }, 'non-unire': { pr: { labels: [{ name: 'non-unire' }] } }, 'serve-ok': { pr: { labels: [{ name: 'serve-ok' }] } }, BLOCK: { revisione: { verdetto: 'BLOCK', sha } }, 'revisione su altro SHA': { revisione: { verdetto: 'OK', sha: 'c'.repeat(40) } }, 'CI rossa': { ciRossa: true }, 'SHA cambiato': { cambioSha: true }, 'fork': { pr: { head: { sha, repo: { full_name: 'altro/fork' } } } }, 'workflow CI modificato dalla PR': { workflowModificato: true }, 'run di altro workflow': { run: { path: '.github/workflows/finto.yml@refs/pull/7/merge' } }, 'run di altro SHA': { run: { head_sha: 'd'.repeat(40) } }, 'check non emesso da GitHub Actions': { appFinta: true } })) {
  test(`niente merge: ${nome}`, async () => {
    const s = scenario(opzioni);
    assert.equal((await eseguiMerge(base, s.gh, s.revisore)).unita, false);
    assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  });
}
test('il diff è passato al revisore come dato', async () => {
  const s = scenario({ diff: '+x' });
  await eseguiMerge(base, s.gh, s.revisore);
  assert.ok(s.comandi.some(c => c[0] === 'revisore' && c[1] === '+x'));
});
test('file a rischio: etichetta e commento senza merge', async () => {
  const s = scenario({ files: [{ filename: '.github/workflows/ci.yml' }] });
  assert.equal((await eseguiMerge(base, s.gh, s.revisore)).unita, false);
  assert.ok(s.comandi.some(c => c.includes('serve-ok')));
  assert.ok(s.comandi.some(c => c.includes("serve l'OK del responsabile: .github/workflows/ci.yml")));
});
test('PR verde: merge squash vincolato allo SHA e dispatch demo', async () => {
  const s = scenario();
  assert.equal((await eseguiMerge(base, s.gh, s.revisore)).unita, true);
  assert.deepEqual(s.comandi.filter(c => c[0] === 'pr' && c[1] === 'merge')[0], ['pr', 'merge', '7', '--repo', 'org/progetto', '--squash', '--delete-branch', '--match-head-commit', sha]);
  assert.ok(s.comandi.some(c => c.join(' ') === 'workflow run demo.yml --repo org/progetto --ref main'));
});
test('demo assente: niente dispatch', async () => {
  const s = scenario({ senzaDemo: true });
  assert.equal((await eseguiMerge(base, s.gh, s.revisore)).demo, false);
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
});
test('errore API demo diverso da 404 non si nasconde', async () => {
  const s = scenario({ erroreDemo: true });
  await assert.rejects(eseguiMerge(base, s.gh, s.revisore), /403/);
});
test('policy nel SQL completo sospende il merge e richiede OK', async () => {
  const s = scenario({ files: [{ filename: 'schema.sql', patch: '+-- commento', status: 'modified' }], sql: 'CREATE POLICY accesso ON utenti;\n-- commento' });
  assert.equal((await eseguiMerge(base, s.gh, s.revisore)).unita, false);
  assert.ok(s.comandi.some(c => c.includes('serve-ok')));
  assert.ok(s.comandi.some(c => c[1] === `repos/org/progetto/contents/schema.sql?ref=${sha}`));
});
test('SQL privo di policy verificato per intero permette merge', async () => {
  const s = scenario({ files: [{ filename: 'schema.sql', patch: '+CREATE TABLE utenti(id int);', status: 'added' }] });
  assert.equal((await eseguiMerge(base, s.gh, s.revisore)).unita, true);
});
test('job obbligatorio assente non permette merge', async () => {
  const s = scenario();
  assert.equal((await eseguiMerge({ ...base, controlli: ['Inesistente'] }, s.gh, s.revisore)).unita, false);
});
test('input repository non valido non raggiunge gh', async () => {
  const s = scenario();
  await assert.rejects(eseguiMerge({ ...base, repository: '--altro' }, s.gh, s.revisore), /non validi/);
  assert.equal(s.comandi.length, 0);
});
