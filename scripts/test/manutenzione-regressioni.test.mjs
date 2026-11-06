import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function git(cwd, args, options = {}) {
  try {
    return await execFileAsync('git', args, { cwd, ...options });
  } catch (error) {
    error.stdout = error.stdout ?? '';
    error.stderr = error.stderr ?? '';
    throw error;
  }
}

async function makeRepository() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manutenzione-regressioni-'));
  tempDirs.push(dir);
  const bare = path.join(dir, 'remote.git');
  const a = path.join(dir, 'clone-a');
  const b = path.join(dir, 'clone-b');
  await git(dir, ['init', '--bare', bare]);
  await git(dir, ['clone', bare, a]);
  await git(a, ['config', 'user.email', 'test@example.invalid']);
  await git(a, ['config', 'user.name', 'Regression Test']);
  await fs.writeFile(path.join(a, 'README.md'), 'main\n');
  await git(a, ['add', 'README.md']);
  await git(a, ['commit', '-m', 'main']);
  await git(a, ['branch', '-M', 'main']);
  await git(a, ['push', '-u', 'origin', 'main']);
  await git(dir, ['clone', bare, b]);
  for (const clone of [b]) {
    await git(clone, ['config', 'user.email', 'test@example.invalid']);
    await git(clone, ['config', 'user.name', 'Regression Test']);
  }
  return { dir, bare, a, b };
}

async function createBranch(clone, name, message, { merged = false, age = '2000-01-01T00:00:00Z' } = {}) {
  await git(clone, ['checkout', 'main']);
  await git(clone, ['checkout', '-B', name]);
  await fs.writeFile(path.join(clone, `${name.replaceAll('/', '-')}.txt`), `${message}\n`);
  await git(clone, ['add', '.']);
  await git(clone, ['-c', `commit.gpgSign=false`, 'commit', '--date', age, '-m', message], {
    env: { ...process.env, GIT_AUTHOR_DATE: age, GIT_COMMITTER_DATE: age },
  });
  await git(clone, ['push', '-u', 'origin', name]);
  if (merged) {
    await git(clone, ['checkout', 'main']);
    await git(clone, ['merge', '--no-ff', name, '-m', `merge ${name}`]);
    await git(clone, ['push', 'origin', 'main']);
  }
}

test('il workflow invoca il modulo effettivamente testato e conserva trigger, ruoli e passi', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/manutenzione.yml'), 'utf8');
  const roles = JSON.parse(await fs.readFile(path.join(root, '.fuxx/ruoli.json'), 'utf8')).ruoli;
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron:\s*['"]0 4 \* \* 1['"]/);
  assert.match(workflow, /node scripts\/manutenzione\.mjs/);
  assert.match(workflow, /- name: Aggiornamento e controllo dipendenze/);
  assert.match(workflow, /- name: Controllo sicurezza con npm audit/);
  assert.match(workflow, /- name: Pulizia rami uniti e artefatti vecchi/);
  for (const role of ['dipendenze', 'sicurezza', 'pulizia']) {
    assert.equal(roles[role]?.prova?.valore, '.github/workflows/manutenzione.yml');
  }
});

test('la cancellazione dei rami usa lo SHA osservato e lascia vivo un push concorrente', async () => {
  const { a, b } = await makeRepository();
  await createBranch(a, 'vecchio-unito', 'A', { merged: true });
  await createBranch(a, 'vecchio-immutato', 'old', { merged: true });
  await createBranch(a, 'recente', 'recent', { age: '2026-11-05T00:00:00Z' });
  await createBranch(a, 'non-unito', 'unmerged', { age: '2000-01-01T00:00:00Z' });
  const maintenance = await import('../manutenzione.mjs');
  let raced = false;
  const result = await maintenance.cleanBranches({
    cwd: a,
    now: Date.parse('2026-11-06T00:00:00Z') / 1000,
    onBeforeDelete: async ({ name }) => {
      if (name === 'vecchio-unito' && !raced) {
        raced = true;
        await git(b, ['checkout', '-B', name, 'origin/main']);
        await fs.writeFile(path.join(b, 'B.txt'), 'B\n');
        await git(b, ['add', 'B.txt']);
        await git(b, ['commit', '-m', 'B']);
        await git(b, ['push', '--force', 'origin', name]);
      }
    },
  });
  assert.deepEqual(result.deleted, ['vecchio-immutato']);
  assert.deepEqual(result.changed, ['vecchio-unito']);
  assert.deepEqual((await git(a, ['ls-remote', 'origin', 'refs/heads/vecchio-unito'])).stdout.trim().split(/\s+/)[0].length, 40);
  for (const name of ['recente', 'non-unito', 'main']) {
    assert.notEqual((await git(a, ['ls-remote', 'origin', `refs/heads/${name}`])).stdout.trim(), '', `${name} deve restare`);
  }
});

test('la pulizia raccoglie tutte le pagine prima di cancellare e deduplica gli ID', async () => {
  const old = '2000-01-01T00:00:00Z';
  const recent = '2026-11-05T00:00:00Z';
  const artifacts = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, updated_at: old }));
  const deleted = [];
  const api = {
    async list(page, perPage) {
      const live = artifacts.filter((artifact) => !deleted.includes(artifact.id));
      const start = (page - 1) * perPage;
      return { total_count: live.length, artifacts: live.slice(start, start + perPage) };
    },
    async remove(id) {
      assert.equal(deleted.includes(id), false, `ID ${id} cancellato due volte`);
      deleted.push(id);
    },
  };
  const maintenance = await import('../manutenzione.mjs');
  const result = await maintenance.cleanArtifacts({ api, now: Date.parse('2026-11-06T00:00:00Z') / 1000 });
  assert.equal(result.deleted.length, 200);
  assert.equal(new Set(deleted).size, 200);
});

test('la paginazione gestisce misti, pagina finale corta, vuoto, artefatto gia rimosso ed errore API', async () => {
  const maintenance = await import('../manutenzione.mjs');
  const old = '2000-01-01T00:00:00Z';
  const recent = '2026-11-05T00:00:00Z';
  const source = Array.from({ length: 205 }, (_, index) => ({ id: index + 1, updated_at: index % 2 ? recent : old }));
  const deleted = [];
  const api = {
    async list(page, perPage) {
      const live = source.filter(({ id }) => !deleted.includes(id));
      const artifacts = live.slice((page - 1) * perPage, page * perPage);
      if (page === 3 && artifacts.length > 0) artifacts.push(artifacts[0]);
      return { total_count: live.length, artifacts };
    },
    async remove(id) {
      if (id === 1) throw Object.assign(new Error('not found'), { status: 404 });
      deleted.push(id);
    },
  };
  const result = await maintenance.cleanArtifacts({ api, now: Date.parse('2026-11-06T00:00:00Z') / 1000 });
  assert.equal(result.deleted.length, 102);
  assert.equal(result.alreadyGone.length, 1);
  assert.ok(deleted.every((id) => id % 2 === 1));
  assert.deepEqual(await maintenance.cleanArtifacts({ api: { list: async () => ({ total_count: 0, artifacts: [] }), remove: async () => assert.fail('non chiamare') }, now: 0 }), { deleted: [], alreadyGone: [] });
  await assert.rejects(() => maintenance.cleanArtifacts({ api: { list: async () => { throw new Error('API down'); }, remove: async () => {} }, now: 0 }), /API down/);
});

test('l adattatore gh riconosce il 404 dallo stderr e non dal codice di uscita', async () => {
  const maintenance = await import('../manutenzione.mjs');
  await assert.rejects(
    () => maintenance.ghApi(['repos/ducklink-team/fuxx-ci/actions/artifacts/1'], {
      runCommand: async () => {
        throw Object.assign(new Error('processo gh fallito'), {
          code: 1,
          stderr: 'gh: Not Found (HTTP 404)',
        });
      },
    }),
    (error) => {
      assert.equal(error.status, 404);
      assert.notEqual(error.code, 404);
      return true;
    },
  );
});

test('la pulizia rifiuta input e risposte API vuote o con date impossibili', async () => {
  const maintenance = await import('../manutenzione.mjs');
  const emptyApi = { list: async () => ({ total_count: 0, artifacts: [] }), remove: async () => {} };
  await assert.rejects(() => maintenance.cleanArtifacts({ api: emptyApi, pageSize: 0 }), /pageSize non valido/);
  await assert.rejects(() => maintenance.cleanArtifacts({ api: emptyApi, now: Number.NaN }), /ora non valida/);
  await assert.rejects(
    () => maintenance.cleanArtifacts({
      api: { list: async () => ({ total_count: 1 }), remove: async () => {} },
      now: Date.parse('2026-11-06T00:00:00Z') / 1000,
    }),
    /risposta artefatti non valida/,
  );
  await assert.rejects(
    () => maintenance.cleanArtifacts({
      api: { list: async () => ({ total_count: 1, artifacts: [{ id: 1, updated_at: '2026-02-30T00:00:00Z' }] }), remove: async () => {} },
      now: Date.parse('2026-11-06T00:00:00Z') / 1000,
    }),
    /data non valida/,
  );
});
