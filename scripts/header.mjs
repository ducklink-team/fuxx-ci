import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function controllaUrl(testo) {
  const url = new URL(testo);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('La demo richiede un URL HTTPS senza credenziali');
  return url.href;
}
export function controllaHeader(h) {
  const csp = h.get('content-security-policy') ?? '';
  return [
    { nome: 'HSTS', ok: /(?:^|;)\s*max-age\s*=\s*[1-9]\d*/i.test(h.get('strict-transport-security') ?? '') },
    { nome: 'nosniff', ok: h.get('x-content-type-options')?.toLowerCase() === 'nosniff' },
    { nome: 'Referrer-Policy', ok: /^(no-referrer|no-referrer-when-downgrade|origin|origin-when-cross-origin|same-origin|strict-origin|strict-origin-when-cross-origin|unsafe-url)$/i.test(h.get('referrer-policy') ?? '') },
    { nome: 'Protezione frame', ok: /^(DENY|SAMEORIGIN)$/i.test(h.get('x-frame-options') ?? '') || /(?:^|;)\s*frame-ancestors\s+[^;]+/i.test(csp) },
    { nome: 'CSP', ok: Boolean(csp.trim() || h.get('content-security-policy-report-only')?.trim()) },
  ];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = controllaUrl(process.env.DEMO_URL);
    const risposta = await fetch(url, { signal: AbortSignal.timeout(30000) });
    controllaUrl(risposta.url);
    if (!risposta.ok) throw new Error(`Demo non disponibile: HTTP ${risposta.status}`);
    const risultati = controllaHeader(risposta.headers);
    const testo = `## Header sicurezza demo\n${risultati.map(r => `- ${r.ok ? 'OK' : 'MANCANTE/INVALIDO'}: ${r.nome}`).join('\n')}\n`;
    console.log(testo);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, testo);
    await risposta.body?.cancel();
    if (risultati.some(r => !r.ok)) process.exitCode = 1;
  } catch (e) {
    console.error('Controllo header fallito');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Header sicurezza demo\nERRORE: demo non raggiungibile o URL non valido.\n');
    process.exitCode = 1;
  }
}
