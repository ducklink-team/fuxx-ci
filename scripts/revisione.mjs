import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function eseguiRevisione(script, sha, ambiente = process.env, avvia = spawnSync) {
  if (!ambiente.OPENROUTER_API_KEY) throw new Error('Manca chiave revisione AI: vietato saltare il controllo');
  const env = { ...ambiente, REVISIONE_FACOLTATIVA: '0' };
  delete env.FUXX_OPENROUTER_FINTO;
  const r = avvia(process.execPath, [script], { env, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 });
  if (r.error || r.signal || ![0, 1].includes(r.status)) throw new Error('Revisione AI non eseguita correttamente');
  return { verdetto: r.status === 0 && !/\bBLOCK\b/.test(`${r.stdout}\n${r.stderr}`) ? 'OK' : 'BLOCK', sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = eseguiRevisione(process.argv[2] ?? 'scripts/revisione-ai.mjs', process.env.PR_SHA);
    console.log(`FUXX_REVISIONE=${JSON.stringify(r)}`);
    if (r.verdetto !== 'OK') process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
