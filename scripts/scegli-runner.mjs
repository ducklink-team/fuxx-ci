import { pathToFileURL } from 'node:url';

const UBUNTU = JSON.stringify('ubuntu-latest');
const SELF_HOSTED = JSON.stringify(['self-hosted', 'fuxx-pc']);
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

export function scegliRunner({ fork = false, token, runners, fallback, nomeRepo }) {
  if (fork) return UBUNTU;
  if (typeof token !== 'string' || !token) return fallbackJson(fallback);
  if (!Array.isArray(runners) || typeof nomeRepo !== 'string' || !nomeRepo) return UBUNTU;
  const prefisso = `pc-${nomeRepo}`;
  if (runners.some((runner) => (runner?.name === prefisso || runner?.name?.startsWith(`${prefisso}-`))
    && runner.status === 'online' && runner.busy === false)
  ) return SELF_HOSTED;
  return runners.some((runner) => runner?.status === 'online'
    && Array.isArray(runner.labels)
    && runner.labels.some((label) => label?.name === 'fuxx-ci')) ? SELF_HOSTED_CI : UBUNTU;
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

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const nomeRepo = repository.split('/').at(-1);
  const fork = process.env.FORK === 'true';
  const token = process.env.RUNNER_LETTURA;
  const fallback = process.env.FALLBACK_RUNNER;
  let runners;
  if (!fork && token) {
    try { runners = await leggiRunner(repository, token); } catch {}
  }
  console.log(scegliRunner({ fork, token, runners, fallback, nomeRepo }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => console.log(UBUNTU));
}
