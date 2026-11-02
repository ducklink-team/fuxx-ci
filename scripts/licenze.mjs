import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const consentite = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'Python-2.0']);
export function licenzaConsentita(espressione) {
  // Piccolo parser SPDX: AND richiede entrambi, OR almeno un'alternativa.
  const token = String(espressione).match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  function atomo() {
    if (token[i] === '(') { i++; const v = oppure(); if (token[i++] !== ')') throw new Error(); return v; }
    const t = token[i++];
    if (!t || ['AND', 'OR', ')'].includes(t)) throw new Error();
    return consentite.has(t);
  }
  function e() { let v = atomo(); while (token[i] === 'AND') { i++; const b = atomo(); v = v && b; } return v; }
  function oppure() { let v = e(); while (token[i] === 'OR') { i++; const b = e(); v = v || b; } return v; }
  try { const ok = oppure(); return i === token.length && ok; } catch { return false; }
}
export function analizzaLicenze(pacchetti) { return pacchetti.filter(p => !licenzaConsentita(p.licenza)); }

// Dati di terzi: nomi e licenze finiscono solo dentro un blocco di codice recintato (nessun link,
// immagine o autolink viene interpretato) e mai in comandi di workflow. Il backtick è eliminato così
// il recinto non si può chiudere dall'interno; righe e lunghezza sono limitate.
export function testoSicuro(valore, massimo = 200) {
  return String(valore).replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029`]/g, ' ').slice(0, massimo);
}
export function riepilogo(totale, avvisi, massimoRighe = 200) {
  const righe = avvisi.slice(0, massimoRighe).map(p => `${testoSicuro(p.nome)}: ${testoSicuro(p.licenza)}`);
  const altri = avvisi.length - righe.length;
  return `## Licenze dipendenze\n${totale} pacchetti; ${avvisi.length} licenze da verificare (solo avviso).\n${righe.length ? `\`\`\`text\n${righe.join('\n')}${altri > 0 ? `\n... altri ${altri}` : ''}\n\`\`\`\n` : ''}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dati = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const pacchetti = process.env.LINGUAGGIO === 'python'
      ? dati.map(p => ({ nome: `${p.Name}@${p.Version}`, licenza: p.LicenseExpression || p.License || 'UNKNOWN' }))
      : Object.entries(dati).map(([nome, p]) => ({ nome, licenza: Array.isArray(p.licenses) ? p.licenses.join(' OR ') : p.licenses ?? 'UNKNOWN' }));
    const avvisi = analizzaLicenze(pacchetti);
    const testo = riepilogo(pacchetti.length, avvisi);
    if (avvisi.length) console.log('::warning::Licenze fuori lista o sconosciute: consultare il riepilogo.');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, testo);
  } catch { console.error('Report licenze illeggibile: controllo non eseguito'); process.exitCode = 1; }
}
