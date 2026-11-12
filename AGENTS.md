# AGENTS.md — regole di questo progetto

Le leggono Claude Code (tramite `CLAUDE.md`), Codex e gli altri agenti. Valgono anche per le persone che mantengono questo repository di workflow riusabili.

## Scopo del repository

`fuxx-ci` contiene workflow GitHub Actions, script Node ESM di supporto, esempi e preset Renovate condivisi dai progetti Duck Link. Non contiene un'applicazione, un'interfaccia utente o un database.

## Metodo di lavoro

1. Lavorare su un ramo dedicato, mai direttamente su `main`.
2. Prima di scrivere, controllare stato, ramo e base del worktree; prima di un aggiornamento remoto usare `git pull --ff-only`.
3. Limitare ogni modifica allo scopo dichiarato. Non cambiare workflow, script, esempi o configurazione se il compito richiede soltanto documentazione.
4. Prima del commit eseguire i test del repository e controllare il diff. Non dichiarare fatto ciò che non è stato verificato.
5. Le note di lavoro nella PR seguono il formato `fatto · manca · prossimo`.

## Workflow e compatibilità

- I riferimenti a `ducklink-team/fuxx-ci/...` usano sempre il tag major `@v6`; quando presente, `versione-ci` vale `v6`.
- Nei workflow non usare `--with-deps`; per Playwright usare `npx playwright install chromium`.
- Non introdurre `pull_request_target` per eseguire codice della PR.
- Mantenere permessi GitHub Actions minimi e non inserire token o credenziali nei file.
- Il workflow `.github/workflows/manutenzione.yml`, se presente, deve rispettare lo schema di manutenzione del modello di progetto e superare il verificatore dedicato.

## Sicurezza

- Mai segreti, password, token, dati personali o credenziali nei commit, nei test, negli esempi o nei log.
- Non disattivare controlli di sicurezza per ottenere un esito verde.
- Prima del commit controllare soltanto i file in staging con gli strumenti disponibili; se uno scanner non è installato, segnalarlo senza inventare l'esito.
- Le azioni di GitHub vanno mantenute a versioni verificabili secondo le regole del repository.

## Test e comandi

Dalla radice:

```powershell
npm test
node "C:\Users\Matteo\Projects\.worktree\111-norma\bin\controlla-manutenzione.mjs" .github/workflows/manutenzione.yml
```

Per una modifica ai workflow verificare anche YAML, riferimenti `@v6`, `versione-ci: v6` e l'assenza di `--with-deps`. Una modifica agli script deve conservare o aggiornare i test corrispondenti senza indebolirli.

## Commit e consegna

Un commit deve descrivere una sola unità di lavoro. Ogni commit contiene il trailer `Scritto-da: codex`; per le corsie che lo richiedono, l'ultimo trailer è `Scritto-da: codex-gpt-reserve`.

Non pubblicare dati sensibili. Push e PR si eseguono solo quando richiesti dal compito e senza force push; se rete o sandbox li impediscono, conservare il commit locale e riportare l'errore esatto.
