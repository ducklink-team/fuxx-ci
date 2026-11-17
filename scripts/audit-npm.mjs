import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LIVELLI_BLOCCANTI = new Set(['high', 'critical']);
const ID_GHSA = /^GHSA-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/i;
const ID_DA_URL = /GHSA-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+/i;

function dataUtc(testo, nome) {
  if (typeof testo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(testo)) {
    throw new Error(`${nome} non valida: usare AAAA-MM-GG`);
  }
  const [anno, mese, giorno] = testo.split('-').map(Number);
  const data = new Date(Date.UTC(anno, mese - 1, giorno));
  if (data.getUTCFullYear() !== anno || data.getUTCMonth() !== mese - 1 || data.getUTCDate() !== giorno) {
    throw new Error(`${nome} non valida: usare una data reale AAAA-MM-GG`);
  }
  return data;
}

function oggiUtc() {
  const data = new Date();
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

export function validaEccezioni(eccezioni, oggi = oggiUtc()) {
  if (!Array.isArray(eccezioni)) throw new Error('audit-eccezioni.json deve contenere un array');
  const usate = new Map();
  const limite = new Date(oggi.getTime() + 90 * 24 * 60 * 60 * 1000);
  for (const [indice, eccezione] of eccezioni.entries()) {
    if (!eccezione || typeof eccezione !== 'object' || Array.isArray(eccezione)) {
      throw new Error(`eccezione ${indice + 1} malformata: deve essere un oggetto`);
    }
    const id = typeof eccezione.id === 'string' ? eccezione.id.toUpperCase() : '';
    if (!ID_GHSA.test(id)) throw new Error(`eccezione ${indice + 1}: id deve essere un GHSA`);
    const scadenza = dataUtc(eccezione.scadenza, `eccezione ${indice + 1}: scadenza`);
    if (scadenza < oggi) throw new Error(`eccezione ${id} scaduta il ${eccezione.scadenza}`);
    if (scadenza > limite) throw new Error(`eccezione ${id}: scadenza oltre 90 giorni da oggi`);
    if (typeof eccezione.motivo !== 'string' || !eccezione.motivo.trim()) {
      throw new Error(`eccezione ${id}: motivo vuoto`);
    }
    if (usate.has(id)) throw new Error(`eccezione ${id} duplicata`);
    usate.set(id, { id, scadenza: eccezione.scadenza, motivo: eccezione.motivo.trim() });
  }
  return usate;
}

function idDaVia(via) {
  return typeof via?.url === 'string' ? via.url.match(ID_DA_URL)?.[0]?.toUpperCase() : undefined;
}

function severitaBloccata(severita) {
  return LIVELLI_BLOCCANTI.has(String(severita).toLowerCase());
}

function auditNonIgnorati(vulnerabilita, eccezioni, usate) {
  const memo = new Map();
  const inCorso = new Set();
  const ignorata = nome => {
    if (memo.has(nome)) return memo.get(nome);
    if (inCorso.has(nome)) return false;
    const vulnerabilitaPacchetto = vulnerabilita[nome];
    if (!vulnerabilitaPacchetto || !severitaBloccata(vulnerabilitaPacchetto.severity)) return true;
    inCorso.add(nome);
    const via = Array.isArray(vulnerabilitaPacchetto.via) ? vulnerabilitaPacchetto.via : [];
    const tuttoIgnorato = via.length > 0 && via.every(elemento => {
      if (typeof elemento === 'string') return ignorata(elemento);
      if (!elemento || typeof elemento !== 'object') return false;
      const id = idDaVia(elemento);
      const severita = elemento.severity ?? vulnerabilitaPacchetto.severity;
      return severitaBloccata(severita) && Boolean(id && eccezioni.has(id));
    });
    inCorso.delete(nome);
    memo.set(nome, tuttoIgnorato);
    if (tuttoIgnorato) {
      for (const elemento of via) {
        const id = typeof elemento === 'object' ? idDaVia(elemento) : undefined;
        if (id) usate.add(id);
      }
    }
    return tuttoIgnorato;
  };

  return Object.entries(vulnerabilita)
    .filter(([nome, valore]) => severitaBloccata(valore?.severity) && !ignorata(nome))
    .map(([nome, valore]) => {
      const ids = (Array.isArray(valore.via) ? valore.via : []).map(idDaVia).filter(Boolean);
      return { nome, severita: String(valore.severity).toLowerCase(), id: ids.join(', ') || 'advisory non identificato' };
    });
}

export function valutaAudit(audit, eccezioni = [], oggi = oggiUtc()) {
  const eccezioniValide = validaEccezioni(eccezioni, oggi);
  const usate = new Set();
  const vulnerabilita = audit?.vulnerabilities;
  if (!vulnerabilita || typeof vulnerabilita !== 'object' || Array.isArray(vulnerabilita)) {
    throw new Error('output npm audit privo di vulnerabilities valido');
  }
  return { avvisi: auditNonIgnorati(vulnerabilita, eccezioniValide, usate), usate, eccezioni: eccezioniValide };
}

function leggiJson(percorso, descrizione) {
  try { return JSON.parse(readFileSync(percorso, 'utf8')); }
  catch (errore) { throw new Error(`${descrizione} illeggibile: ${errore.message}`); }
}

export function esegui({ cwd = process.cwd(), fileAudit } = {}) {
  const audit = fileAudit
    ? leggiJson(path.resolve(cwd, fileAudit), 'file audit')
    : (() => {
        const comando = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const risultato = spawnSync(comando, ['audit', '--json'], { cwd, encoding: 'utf8' });
        if (risultato.error) throw new Error(`npm audit non eseguibile: ${risultato.error.message}`);
        try { return JSON.parse(risultato.stdout); }
        catch (errore) { throw new Error(`npm audit non ha prodotto JSON valido: ${errore.message}`); }
      })();
  const eccezioniPath = path.join(cwd, '.fuxx', 'audit-eccezioni.json');
  const eccezioni = existsSync(eccezioniPath) ? leggiJson(eccezioniPath, 'audit-eccezioni.json') : [];
  const oggiTest = process.env.AUDIT_NPM_OGGI;
  const oggi = oggiTest ? dataUtc(oggiTest, 'AUDIT_NPM_OGGI') : oggiUtc();
  const risultato = valutaAudit(audit, eccezioni, oggi);
  for (const id of risultato.usate) console.log(`eccezione usata: ${id} (scadenza ${risultato.eccezioni.get(id).scadenza})`);
  for (const avviso of risultato.avvisi) console.log(`audit: ${avviso.id} · ${avviso.nome} · ${avviso.severita}`);
  return risultato.avvisi.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const indice = process.argv.indexOf('--da-file');
    if (indice !== -1 && !process.argv[indice + 1]) throw new Error('manca il percorso dopo --da-file');
    process.exitCode = esegui({ fileAudit: indice === -1 ? undefined : process.argv[indice + 1] });
  } catch (errore) {
    console.error(`audit npm: ${errore.message}`);
    process.exitCode = 1;
  }
}
