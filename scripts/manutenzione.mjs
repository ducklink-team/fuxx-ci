import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DAY = 24 * 60 * 60;
const RETENTION_DAYS = 14;
const PAGE_SIZE = 100;

async function command(file, args, options = {}) {
  return execFileAsync(file, args, { ...options, windowsHide: true });
}

function timestamp(value) {
  const result = Date.parse(value);
  if (Number.isNaN(result)) throw new Error(`data non valida: ${value}`);
  return result / 1000;
}

function branchRows(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, sha, data] = line.split('\t');
    if (!name || !sha || !data) throw new Error(`riferimento remoto non valido: ${line}`);
    return { name, sha, data: Number(data) };
  });
}

export async function cleanBranches({
  cwd,
  now = Math.floor(Date.now() / 1000),
  onBeforeDelete,
  runGit = (args) => command('git', args, { cwd }),
  log = console,
} = {}) {
  const threshold = now - RETENTION_DAYS * DAY;
  await runGit(['fetch', 'origin', '--prune']);
  const refs = branchRows((await runGit([
    'for-each-ref',
    '--format=%(refname:strip=3)\t%(objectname)\t%(committerdate:unix)',
    'refs/remotes/origin/',
  ])).stdout);
  const deleted = [];
  const changed = [];

  for (const { name, sha, data } of refs) {
    if (name === 'main' || name === 'HEAD' || data >= threshold) continue;
    const ancestor = await runGit(['merge-base', '--is-ancestor', sha, 'origin/main']).then(() => true).catch((error) => {
      if (error.code === 1) return false;
      throw error;
    });
    if (!ancestor) continue;
    await onBeforeDelete?.({ name, sha });
    const ref = `refs/heads/${name}`;
    try {
      await runGit(['push', 'origin', `--force-with-lease=${ref}:${sha}`, `:${ref}`]);
      deleted.push(name);
      log.log(`Cancello ramo unito e vecchio: ${name}`);
    } catch (error) {
      const current = (await runGit(['ls-remote', 'origin', ref])).stdout.trim().split(/\s+/)[0] ?? '';
      if (current !== sha) {
        changed.push(name);
        log.warn(`Ramo cambiato durante la pulizia, non cancellato: ${name}`);
        continue;
      }
      throw error;
    }
  }
  return { deleted, changed };
}

export async function cleanArtifacts({
  api,
  now = Math.floor(Date.now() / 1000),
  pageSize = PAGE_SIZE,
  log = console,
} = {}) {
  const threshold = now - RETENTION_DAYS * DAY;
  const candidates = new Map();
  let page = 1;
  while (true) {
    const response = await api.list(page, pageSize);
    const artifacts = Array.isArray(response?.artifacts) ? response.artifacts : [];
    for (const artifact of artifacts) {
      if (artifact?.id == null || timestamp(artifact.updated_at) >= threshold) continue;
      candidates.set(String(artifact.id), artifact.id);
    }
    if (artifacts.length < pageSize || page * pageSize >= Number(response?.total_count ?? 0)) break;
    page += 1;
    if (page > 10000) throw new Error('paginazione artefatti senza fine');
  }

  const deleted = [];
  const alreadyGone = [];
  for (const id of candidates.values()) {
    try {
      await api.remove(id);
      deleted.push(id);
      log.log(`Cancello artefatto vecchio: ${id}`);
    } catch (error) {
      if (error?.status === 404 || error?.code === 404) {
        alreadyGone.push(id);
        continue;
      }
      throw error;
    }
  }
  return { deleted, alreadyGone };
}

async function ghApi(repository, args) {
  const { stdout } = await command('gh', ['api', ...args], { env: process.env });
  return stdout.trim() === '' ? null : JSON.parse(stdout);
}

export async function main({ cwd = process.cwd(), repository = process.env.GITHUB_REPOSITORY } = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY mancante');
  const api = {
    list: (page, perPage) => ghApi(repository, [`repos/${repository}/actions/artifacts?per_page=${perPage}&page=${page}`]),
    remove: (id) => ghApi(repository, ['-X', 'DELETE', `repos/${repository}/actions/artifacts/${id}`]),
  };
  const branches = await cleanBranches({ cwd });
  const artifacts = await cleanArtifacts({ api });
  return { branches, artifacts };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  await main();
}
