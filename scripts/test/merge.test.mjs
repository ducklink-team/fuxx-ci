import test from 'node:test';
import assert from 'node:assert/strict';
import { fileARischio, leggiRevisione, eseguiMerge } from '../merge.mjs';

for (const nome of ['specs/uno/contratto-api.md', 'specs/uno/spec.md', 'supabase/migrations/a.sql', 'src/migrations/a.js', 'migrations/a.py', 'db/schema.json', 'src/auth/login.ts', 'auth/login.ts', 'middleware.ts', 'src/middleware.js', '.github/workflows/ci.yml', '.env.example', '.fuxx/ruoli.json', 'CODEOWNERS', '.github/CODEOWNERS']) {
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
test('revisione BLOCK prevale anche su OK', () => assert.equal(leggiRevisione('FUXX_REVISIONE={"verdetto":"OK","sha":"abc"}\nBLOCK src/a:1\n', 'abc'), 'BLOCK'));
test('revisione OK deve essere esplicita e sullo SHA giusto', () => {
  assert.equal(leggiRevisione('FUXX_REVISIONE={"verdetto":"OK","sha":"abc"}', 'abc'), 'OK');
  assert.equal(leggiRevisione('FUXX_REVISIONE={"verdetto":"OK","sha":"vecchio"}', 'abc'), 'SCONOSCIUTA');
  assert.equal(leggiRevisione('revisione saltata', 'abc'), 'SCONOSCIUTA');
});

const sha = 'a'.repeat(40);
function scenario(opzioni = {}) {
  const comandi = [];
  let letture = 0;
  const pr = { number: 7, state: 'open', draft: false, labels: [], head: { sha, repo: { full_name: 'org/progetto' } }, base: { ref: 'main', repo: { full_name: 'org/progetto' } }, ...opzioni.pr };
  const gh = (args) => {
    comandi.push(args);
    const endpoint = args[1];
    if (endpoint === 'repos/org/progetto/pulls/7') {
      letture++;
      return JSON.stringify(letture > 1 && opzioni.cambioSha ? { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } } : pr);
    }
    if (endpoint?.endsWith('/files')) return JSON.stringify([opzioni.files ?? [{ filename: 'src/page.tsx' }]]);
    if (endpoint?.includes('/contents/')) return JSON.stringify({ encoding: 'base64', content: Buffer.from(opzioni.sql ?? 'CREATE TABLE utenti(id int);').toString('base64') });
    if (endpoint?.endsWith('/jobs')) return JSON.stringify([{ jobs: ['CI progetto', 'sicurezza / Sicurezza', 'Revisione AI'].map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: opzioni.ciRossa && i === 0 ? 'failure' : 'success' })) }]);
    if (endpoint?.endsWith('/logs')) return opzioni.logs ?? `FUXX_REVISIONE={"verdetto":"OK","sha":"${sha}"}`;
    if (endpoint === 'repos/org/progetto/actions/workflows/demo.yml') {
      if (opzioni.senzaDemo) { const e = new Error('HTTP 404: Not Found'); e.status = 404; throw e; }
      if (opzioni.erroreDemo) throw new Error('HTTP 403: Forbidden');
      return JSON.stringify({ state: 'active' });
    }
    return '';
  };
  return { comandi, gh };
}
const base = { repository: 'org/progetto', numero: 7, runId: 90, sha, controlli: ['CI progetto', 'sicurezza / Sicurezza'], revisione: 'Revisione AI' };
for (const [nome, opzioni] of Object.entries({ bozza: { pr: { draft: true } }, 'non-unire': { pr: { labels: [{ name: 'non-unire' }] } }, 'serve-ok': { pr: { labels: [{ name: 'serve-ok' }] } }, BLOCK: { logs: 'BLOCK src/a:1' }, 'revisione assente': { logs: 'nessuna chiave: saltata' }, 'CI rossa': { ciRossa: true }, 'SHA cambiato': { cambioSha: true }, 'fork': { pr: { head: { sha, repo: { full_name: 'altro/fork' } } } } })) {
  test(`niente merge: ${nome}`, () => {
    const s = scenario(opzioni);
    assert.equal(eseguiMerge(base, s.gh).unita, false);
    assert.equal(s.comandi.some(c => c[0] === 'pr' && c[1] === 'merge'), false);
  });
}
test('file a rischio: etichetta e commento senza merge', () => {
  const s = scenario({ files: [{ filename: '.github/workflows/ci.yml' }] });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.ok(s.comandi.some(c => c.includes('serve-ok')));
  assert.ok(s.comandi.some(c => c.includes("serve l'OK del responsabile: .github/workflows/ci.yml")));
});
test('PR verde: merge squash vincolato allo SHA e dispatch demo', () => {
  const s = scenario();
  assert.equal(eseguiMerge(base, s.gh).unita, true);
  assert.deepEqual(s.comandi.filter(c => c[0] === 'pr' && c[1] === 'merge')[0], ['pr', 'merge', '7', '--repo', 'org/progetto', '--squash', '--delete-branch', '--match-head-commit', sha]);
  assert.ok(s.comandi.some(c => c.join(' ') === 'workflow run demo.yml --repo org/progetto --ref main'));
});
test('demo assente: niente dispatch', () => {
  const s = scenario({ senzaDemo: true });
  assert.equal(eseguiMerge(base, s.gh).demo, false);
  assert.equal(s.comandi.some(c => c[0] === 'workflow'), false);
});
test('errore API demo diverso da 404 non si nasconde', () => {
  const s = scenario({ erroreDemo: true });
  assert.throws(() => eseguiMerge(base, s.gh), /403/);
});
test('policy nel SQL completo sospende il merge e richiede OK', () => {
  const s = scenario({ files: [{ filename: 'schema.sql', patch: '+-- commento', status: 'modified' }], sql: 'CREATE POLICY accesso ON utenti;\n-- commento' });
  assert.equal(eseguiMerge(base, s.gh).unita, false);
  assert.ok(s.comandi.some(c => c.includes('serve-ok')));
  assert.ok(s.comandi.some(c => c[1] === `repos/org/progetto/contents/schema.sql?ref=${sha}`));
});
test('SQL privo di policy verificato per intero permette merge', () => {
  const s = scenario({ files: [{ filename: 'schema.sql', patch: '+CREATE TABLE utenti(id int);', status: 'added' }] });
  assert.equal(eseguiMerge(base, s.gh).unita, true);
});
test('job obbligatorio assente non permette merge', () => {
  const s = scenario();
  assert.equal(eseguiMerge({ ...base, controlli: ['Inesistente'] }, s.gh).unita, false);
});
test('input repository non valido non raggiunge gh', () => {
  const s = scenario();
  assert.throws(() => eseguiMerge({ ...base, repository: '--altro' }, s.gh), /non validi/);
  assert.equal(s.comandi.length, 0);
});
