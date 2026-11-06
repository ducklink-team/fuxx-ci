import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DAY = 24 * 60 * 60;
const RETENTION_DAYS = 14;
const PAGE_SIZE = 100;
const GH_API_TIMEOUT_MS = 60_000;

async function command(file, args, options = {}) {
  return execFileAsync(file, args, { ...options, windowsHide: true });
}

function unixSeconds(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} non valida`);
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('data non valida');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) throw new Error(`data non valida: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`data non valida: ${value}`);
  }
  const result = Date.parse(value);
  if (Number.isNaN(result)) throw new Error(`data non valida: ${value}`);
  return result / 1000;
}

function branchRows(stdout) {
  if (typeof stdout !== 'string') throw new Error('riferimenti remoti non validi');
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, sha, data] = line.split('\t');
    if (!name || !sha || !data) throw new Error(`riferimento remoto non valido: ${line}`);
    if (!/^[a-f\d]{40}$/i.test(sha)) throw new Error(`SHA remoto non valido: ${sha}`);
    const timestamp = Number(data);
    if (!Number.isSafeInteger(timestamp)) throw new Error(`data remota non valida: ${data}`);
    return { name, sha, data: timestamp };
  });
}

export async function cleanBranches({
  cwd,
  now = Math.floor(Date.now() / 1000),
  onBeforeDelete,
  runGit = (args) => command('git', args, { cwd }),
  log = console,
} = {}) {
  const threshold = unixSeconds(now, 'ora') - RETENTION_DAYS * DAY;
  await runGit(['fetch', 'origin', '--prune']);
  const refResult = await runGit([
    'for-each-ref',
    '--format=%(refname:strip=3)\t%(objectname)\t%(committerdate:unix)',
    'refs/remotes/origin/',
  ]);
  const refs = branchRows(refResult?.stdout);
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
  if (!api || typeof api.list !== 'function' || typeof api.remove !== 'function') throw new Error('API artefatti non valida');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('pageSize non valido');
  const threshold = unixSeconds(now, 'ora') - RETENTION_DAYS * DAY;
  const candidates = new Map();
  let page = 1;
  while (true) {
    const response = await api.list(page, pageSize);
    if (!response || !Array.isArray(response.artifacts) || !Number.isSafeInteger(response.total_count) || response.total_count < 0) {
      throw new Error('risposta artefatti non valida');
    }
    const artifacts = response.artifacts;
    if (artifacts.length > pageSize) throw new Error('pagina artefatti non valida');
    for (const artifact of artifacts) {
      if (!artifact || !Number.isSafeInteger(artifact.id) || artifact.id < 1) throw new Error('artefatto non valido');
      if (timestamp(artifact.updated_at) >= threshold) continue;
      candidates.set(String(artifact.id), artifact.id);
    }
    const hasMore = page * pageSize < response.total_count;
    if (!hasMore) break;
    if (artifacts.length < pageSize) throw new Error('paginazione artefatti incoerente');
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
      if (error?.status === 404) {
        alreadyGone.push(id);
        continue;
      }
      throw error;
    }
  }
  return { deleted, alreadyGone };
}

export async function ghApi(args, { runCommand = command } = {}) {
  let result;
  try {
    result = await runCommand('gh', ['api', ...args], {
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: GH_API_TIMEOUT_MS,
    });
  } catch (error) {
    const status = String(error?.stderr ?? '').match(/\bHTTP\s+(\d{3})\b/i);
    const failure = new Error('Chiamata gh api fallita');
    if (status) failure.status = Number(status[1]);
    throw failure;
  }
  if (!result || typeof result.stdout !== 'string') throw new Error('Risposta gh api non valida');
  const { stdout } = result;
  return stdout.trim() === '' ? null : JSON.parse(stdout);
}

export async function main({ cwd = process.cwd(), repository = process.env.GITHUB_REPOSITORY } = {}) {
  if (typeof repository !== 'string' || !/^[^\s/]+\/[^\s/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY non valido');
  const api = {
    list: (page, perPage) => ghApi([`repos/${repository}/actions/artifacts?per_page=${perPage}&page=${page}`]),
    remove: (id) => ghApi(['-X', 'DELETE', `repos/${repository}/actions/artifacts/${id}`]),
  };
  const branches = await cleanBranches({ cwd });
  const artifacts = await cleanArtifacts({ api });
  return { branches, artifacts };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  await main();
}
