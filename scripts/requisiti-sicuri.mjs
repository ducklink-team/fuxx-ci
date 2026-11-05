import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { testoSicuro } from './licenze.mjs';

const OPZIONI_CON_ARGOMENTO = /^(--index-url|-i|--extra-index-url|--find-links|-f|--only-binary)(?:\s+|=)(\S+)$/;
const OPZIONI_NESTATE = /^-(?:r|-requirement|c|-constraint)(?:\s|=|$)/;
const OPERATORI_VERSIONE = '(?:===|==|!=|~=|<=|>=|<|>)';
const REQUISITO_NOME = new RegExp(
  `^[A-Za-z0-9._-]+(?:\\[[A-Za-z0-9._-]+(?:\\s*,\\s*[A-Za-z0-9._-]+)*\\])?` +
  `(?:\\s*${OPERATORI_VERSIONE}\\s*[^,;\\s]+(?:\\s*,\\s*${OPERATORI_VERSIONE}\\s*[^,;\\s]+)*)?$`,
);
const HASH = /(?:\s+--hash=[A-Za-z0-9][A-Za-z0-9._-]*:[0-9A-Fa-f]+)+$/;

function senzaCommento(testo) {
  return testo.replace(/\s+#.*$/, '').trim();
}

function validaRiga(testo) {
  if (testo.trim().startsWith('#')) return null;
  const riga = senzaCommento(testo);
  if (!riga) return null;
  if (/^(?:-e|--editable)(?:\s|=|$)/.test(riga)) return 'installazioni editable non ammesse';
  if (OPZIONI_NESTATE.test(riga)) return 'file annidati non ammessi, unisci le righe';
  if (/^--no-binary(?:\s|=|$)/.test(riga)) return 'opzione --no-binary non ammessa: forza il sorgente';
  if (riga === '--prefer-binary') return null;
  if (OPZIONI_CON_ARGOMENTO.test(riga)) return null;
  if (riga.startsWith('-')) return 'opzione non ammessa';

  let requisito = riga;
  const hash = requisito.match(HASH);
  if (hash) requisito = requisito.slice(0, hash.index).trim();
  const parti = requisito.split(';');
  if (parti.length > 2 || (parti.length === 2 && !parti[1].trim())) return 'marker non ammesso';
  requisito = parti[0].trim();
  if (REQUISITO_NOME.test(requisito)) return null;
  if (requisito.includes('@')) return 'riferimenti diretti non ammessi, usa solo il nome del pacchetto';
  if (/^(?:[A-Za-z]:[\\/]|[./\\]|(?:https?|file|git\+):)/i.test(requisito)) return 'percorsi e URL non ammessi';
  return 'requisito non ammesso: usa solo il nome del pacchetto';
}

export function validaRequirements(testo) {
  const righe = String(testo).split(/\r?\n/);
  const record = [];
  for (let i = 0; i < righe.length; i++) {
    const numero = i + 1;
    let testoRecord = righe[i];
    while (/\\\s*$/.test(testoRecord)) {
      testoRecord = testoRecord.replace(/\\\s*$/, ' ');
      if (i + 1 >= righe.length) {
        record.push({ numero, testo: testoRecord, motivo: 'continuazione incompleta' });
        break;
      }
      i++;
      testoRecord += ` ${righe[i]}`;
    }
    if (record.at(-1)?.numero === numero && record.at(-1)?.motivo) continue;
    const motivo = validaRiga(testoRecord);
    if (motivo) record.push({ numero, testo: testoRecord, motivo });
  }
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const errori = validaRequirements(readFileSync(process.argv[2], 'utf8'));
    for (const { numero, testo, motivo } of errori) {
      console.error(`riga ${numero} non ammessa: ${motivo} (${testoSicuro(testo)})`);
    }
    if (errori.length) process.exitCode = 1;
  } catch (error) {
    console.error(`requirements illeggibile: ${testoSicuro(error?.message ?? error)}`);
    process.exitCode = 1;
  }
}
