import { pathToFileURL } from 'node:url';

const UBUNTU = JSON.stringify('ubuntu-latest');
const SELF_HOSTED = JSON.stringify(['self-hosted', 'fuxx-pc']);
const SELF_HOSTED_ORG = JSON.stringify(['self-hosted', 'fuxx-org']);
const SELF_HOSTED_CI = JSON.stringify(['self-hosted', 'fuxx-ci']);

function fallbackJson(fallback) {
  if (typeof fallback !== 'string' || !fallback.trim()) return UBUNTU;
  try {
    const valore = JSON.parse(fallback);
    if (typeof valore === 'string' && valore.trim()) return JSON.stringify(valore);
    if (Array.isArray(valore) && valore.length && valore.every((item) => typeof item === 'string' && item.trim())) {
      return JSON.stringify(valore);
    }
  } catch {}
  return UBUNTU;
}

export function scegliRunner({ fork = false, token, runners, runnersOrg, fallback, nomeRepo }) {
  if (fork) return UBUNTU;
  if (typeof token !== 'string' || !token) return fallbackJson(fallback);
  const prefisso = typeof nomeRepo === 'string' && nomeRepo ? `pc-${nomeRepo}` : null;
  if (Array.isArray(runners) && prefisso && runners.some((runner) => (runner?.name === prefisso || runner?.name?.startsWith(`${prefisso}-`))
    && runner.status === 'online' && runner.busy === false)
  ) return SELF_HOSTED;
  const orgDisponibile = Array.isArray(runnersOrg);
  const orgLibero = orgDisponibile && runnersOrg.some((runner) => runner?.status === 'online'
    && runner.busy === false
    && Array.isArray(runner.labels)
    && runner.labels.some((label) => label?.name === 'fuxx-org'));
  if (orgLibero) return SELF_HOSTED_ORG;
  const ciDisponibile = Array.isArray(runners) && runners.some((runner) => runner?.status === 'online'
    && Array.isArray(runner.labels)
    && runner.labels.some((label) => label?.name === 'fuxx-ci'));
  if (ciDisponibile) return SELF_HOSTED_CI;
  if (orgDisponibile && runnersOrg.some((runner) => runner?.status === 'online'
    && Array.isArray(runner.labels)
    && runner.labels.some((label) => label?.name === 'fuxx-org'))) return SELF_HOSTED_ORG;
  if (Array.isArray(runners) && runners.length === 0 && !orgDisponibile) return fallbackJson(fallback);
  return UBUNTU;
}

async function leggiRunner(repository, token) {
  const base = process.env.GITHUB_API_URL;
  if (!base) throw new Error('API non configurata');
  const url = new URL(`repos/${repository}/actions/runners?per_page=100`, `${base.replace(/\/$/, '')}/`);
  const risposta = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!risposta.ok) throw new Error('API non disponibile');
  const corpo = await risposta.json();
  return corpo?.runners;
}

export async function leggiRunnerOrg(owner, token, fetchImpl = fetch) {
  const base = process.env.GITHUB_API_URL;
  if (!base) throw new Error('API non configurata');
  const url = new URL(`orgs/${owner}/actions/runners?per_page=100`, `${base.replace(/\/$/, '')}/`);
  const risposta = await fetchImpl(url, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!risposta.ok) return undefined;
  const corpo = await risposta.json();
  return corpo?.runners;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const nomeRepo = repository.split('/').at(-1);
  const fork = process.env.FORK === 'true';
  const token = process.env.RUNNER_LETTURA;
  const fallback = process.env.FALLBACK_RUNNER;
  let runners;
  let runnersOrg;
  if (!fork && token) {
    try { runners = await leggiRunner(repository, token); } catch {}
    const owner = repository.split('/')[0];
    if (owner) {
      try { runnersOrg = await leggiRunnerOrg(owner, token); } catch {}
    }
  }
  console.log(scegliRunner({ fork, token, runners, runnersOrg, fallback, nomeRepo }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => console.log(UBUNTU));
}
