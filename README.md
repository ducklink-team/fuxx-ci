# fuxx-ci — CI centrale FUXX

Cartella pronta a diventare la radice di `ducklink-team/fuxx-ci`, dopo il merge della corsia G. Qui non sono stati creati repository, tag o impostazioni dell'organizzazione. Tutti gli esempi usano `@v1`: il tag dovrà esistere nel repository pubblicato. Gli script sono Node ESM, senza dipendenze del progetto.

## Contenuto e utilizzo

- `.github/workflows/sicurezza.yml`: gitleaks **8.30.1** con checksum, Semgrep CE, audit bloccante, inventario licenze con avvisi.
- `.github/workflows/merge-automatico.yml`: controlla PR e job dello stesso run/SHA, revisione AI eseguita da fuxx-ci, provenienza dei job, file a rischio; merge squash e dispatch della demo.
- `.github/workflows/controllo-sito.yml`: header, ZAP baseline passivo, riepilogo e rapporto conservato sette giorni.
- `scripts/`: decisioni verificabili con `node --test`; `renovate/default.json`: preset condiviso.

Copiare `esempi/ci-progetto.yml` in `.github/workflows/ci.yml` del progetto e **anche** `esempi/merge-progetto.yml` in `.github/workflows/merge.yml`. Servono due workflow: CI su `pull_request`, merge privilegiato su `workflow_run` concluso. Non usare `pull_request_target` per eseguire codice PR. Il workflow di merge deve essere già sul ramo predefinito e richiede il secret `OPENROUTER_API_KEY` e la variabile `MODELLO_REVISIONE`. Il progetto deve fornire gli script npm indicati nell'esempio; `scripts/revisione-ai.mjs` non serve più.

Per il controllo settimanale copiare `esempi/controllo-settimanale.yml`, impostare la variabile repository `DEMO_URL` con l'URL HTTPS della demo autorizzata. Il cron è lunedì alle 04:23 UTC. Un workflow solo `workflow_call` non si pianifica da sé.

Gli input `linguaggio: node|python`, `directory` (default `.`) e `requirements` (default `requirements.txt`, relativo alla directory progetto) configurano la sicurezza. Per Python usare il proprio job di test al posto del job npm nell'esempio. Audit Python blocca ogni vulnerabilità nota e la raccolta incompleta; audit Node blocca `high` e `critical`. Occorrono `package-lock.json` per Node oppure requirements installabili per Python, con tutte le dipendenze da verificare. I file di lock alternativi vanno esportati in requirements prima della chiamata.

L'inventario include dipendenze transitive e di sviluppo installate. Lista consentita: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0, Unlicense, Python-2.0. Espressioni SPDX AND/OR vengono valutate; nomi storici Python non riconosciuti, eccezioni WITH e licenze mancanti generano avvisi. Una licenza fuori lista **non** blocca; un inventario illeggibile o non eseguito blocca. È un controllo dei metadati, non una valutazione legale.

## Accesso privato e piano Free

**Sì: un repository privato di un'organizzazione GitHub Free può richiamare workflow di un altro repository privato della stessa organizzazione.** La documentazione ammette chiamante privato → centrale privato; Actions è disponibile sul piano Free. Non serve Team per questa condivisione. La prova con due repository privati reali resta da eseguire dopo la pubblicazione. Fonti: [accessibilità dei workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), [disponibilità di Actions](https://docs.github.com/en/actions/get-started/understand-github-actions).

Nel futuro repository centrale: **Settings → Actions → General → Access → Accessible from repositories in the 'ducklink-team' organization → Save**. Nel chiamante la policy Actions deve consentire workflow e azioni utilizzati. Per scaricare il workflow GitHub fornisce un token d'installazione temporaneo. [Istruzioni ufficiali di condivisione](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization).

**Scaricare il workflow e fare checkout degli script sono operazioni diverse.** Il normale `GITHUB_TOKEN` del chiamante è limitato al proprio repository: gli esempi passano il secret `LETTURA_CI` per il checkout di `ducklink-team/fuxx-ci`. Usare un token fine-grained con sola permission **Contents: read**, solo sul repository centrale e con scadenza, oppure un installation token di una GitHub App con lo stesso accesso. Configurarlo nei repository chiamanti; nessun valore va nei file. Il checkout disabilita `persist-credentials`. Vedi [checkout di un altro repository privato](https://github.com/actions/checkout#checkout-multiple-repos-private).

L'input `versione-ci` deve corrispondere al tag del workflow chiamato (default `v1`). Aggiornare insieme `uses: ...@vN`, checkout dell'adattatore AI ed eventuale input. Le azioni sono versionate per major; gli strumenti pip e il registro delle regole Semgrep sono aggiornati a ogni run. Renovate ne segnala gli aggiornamenti dove supportati.

GitHub Free per organizzazioni comprende una quota mensile di minuti/storage, non esecuzione privata illimitata. Prima dell'attivazione verificare il budget con Matteo e mantenere il limite di spesa a zero; nessun consumo è stato misurato da questa corsia. [Quote ufficiali Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Condizioni del merge automatico

Il chiamante di esempio aspetta l'intero workflow **CI progetto**. Lo script richiede i job esatti `CI progetto`, `sicurezza / Sicurezza` (input `controlli`), tutti `completed/success`. Se GitHub restituisce un nome diverso nel repository reale, controllarlo con `gh api repos/ducklink-team/NOME/actions/runs/ID/jobs --jq '.jobs[].name'` e aggiornare l'input `controlli` (array JSON). Un nome assente, duplicato o saltato sospende il merge.

**Revisione AI (cambiata, breaking).** La revisione non gira più nel workflow CI della PR e non esegue più alcuno script della PR. La esegue `scripts/revisione.mjs` di fuxx-ci dentro il job di merge (`workflow_run` sul ramo predefinito): scarica il diff della PR come semplice testo non attendibile, lo manda al modello OpenRouter e accetta solo la risposta esatta `VERDETTO: OK`; qualunque altra cosa, errore, timeout o diff oltre 150000 caratteri sospende il merge. `OPENROUTER_API_KEY` è un secret del solo workflow di merge e non è mai visibile a codice o workflow definiti dalla PR. Il modello è l'input obbligatorio `modello-revisione` (nessun default: lo sceglie il CEO). Resta un rischio residuo di prompt injection nel diff; per i file sensibili si ferma comunque il controllo a rischio sotto.

**Provenienza dei controlli.** Una PR esegue la CI definita nel proprio ramo, quindi i nomi dei job da soli non provano nulla. Il merge richiede: run con `event=pull_request` e SHA corrente, `path` uguale al workflow indicato in `workflow-ci` (default `.github/workflows/ci.yml`), file di quel workflow identico (stesso blob) allo SHA della PR e sul ramo `main`, ogni job obbligatorio unico, `completed/success`, con check-run emesso dall'app `github-actions` per lo stesso SHA. Per cambiare il workflow CI serve quindi passare dal controllo file a rischio (`.github/**`) e dall'OK del responsabile.

Si ferma su PR chiusa, bozza, fork, base diversa da `main`, `non-unire`, `serve-ok`, revisione BLOCK/assente, SHA cambiato, job mancanti/rossi. I file sono paginati; il limite GitHub di 3000 file provoca arresto conservativo. Controlla anche il nome precedente delle rinomine.

File a rischio (percorso normalizzato: maiuscole, `//`, `.`/`..`, backslash; a qualsiasi profondità): segmenti `db`, `auth`, `middleware`, `.github`, `.fuxx`; cartelle il cui nome contiene `migration`; `contratto-api.md`/`spec.md` sotto una cartella `specs`; file `middleware.*`, `codeowners*`, `.env*`, `.gitleaks*`, `.semgrep*`; SQL (`.sql`, `.psql`, `.pgsql`, `.ddl`) contenenti la parola `policy`. Per SQL non eliminati legge il contenuto completo allo SHA della PR, così una policy fuori dal diff viene rilevata. SQL eliminati senza patch, contenuti non disponibili e rinomine da SQL vengono fermati prudentemente.

Su file a rischio applica `serve-ok` e commenta **"serve l'OK del responsabile: <file>"**. Togliere l'etichetta non autorizza il bot a ignorare il rischio: il responsabile dovrà approvare e unire manualmente secondo D-51. Non esiste un comando bot per dare quell'OK.

Prima di unire rilegge la PR; `gh pr merge --squash --delete-branch --match-head-commit SHA` evita di unire un nuovo commit arrivato durante il controllo. Il merge è solo per PR dello stesso repository. Il workflow privilegiato scarica esclusivamente il codice centrale versionato: non esegue checkout, script o artefatti della PR. Permessi richiesti: `contents: write`, `pull-requests: write`, `issues: write`, `actions: write`.

Un merge effettuato con `GITHUB_TOKEN` **non genera una nuova esecuzione dei workflow su push**. Il codice verifica l'esistenza di `demo.yml`, poi dopo il merge esegue esplicitamente `gh workflow run demo.yml --ref main` nel repository progetto. `demo.yml` deve supportare `workflow_dispatch` (il modello lo supporta). Un 404 significa demo assente; altri errori non sono ignorati. Se il dispatch fallisce il workflow è rosso anche se il merge è già avvenuto: correggere il problema e rilanciare manualmente la demo, senza ripetere il merge. [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

## Scanner e fonti tecniche

- Gitleaks: binario e checksum dalla [release ufficiale 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), senza GitHub Action soggetta a licenza commerciale.
- [Semgrep CE](https://semgrep.dev/products/community-edition): scansione e regole comunitarie senza login. Usa `semgrep scan --config p/security-audit --error --metrics=off`; non serve account Semgrep né `SEMGREP_APP_TOKEN`. I finding bloccano; errori di rete/scanner non vengono trasformati in verde.
- [pip-audit](https://github.com/pypa/pip-audit): `--strict -r` verifica requirements; [license-checker-rseidelsohn](https://github.com/RSeidelsohn/license-checker-rseidelsohn) fornisce il JSON Node; [pip-licenses](https://github.com/raimon49/pip-licenses) usa `--python` per escludere dal report gli strumenti di audit installati in un altro venv. Il checker Node è fissato a **5.0.1**, verificata direttamente nel [registro npm](https://registry.npmjs.org/license-checker-rseidelsohn/5.0.1). La documentazione consultata annuncia 6.0.0 e la migrazione a `@lizenz/checker`, ma 6.0.0 non era disponibile nel registro durante questa verifica: non viene usata.
- [ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/): immagine ufficiale **`ghcr.io/zaproxy/zaproxy:stable`**, spider e analisi passiva. Esiti: 0 OK, 1 FAIL, 2 WARN, 3 errore. WARN viene riportato senza bloccare; FAIL/errori bloccano. Il rapporto è un artifact, il riepilogo finisce in `$GITHUB_STEP_SUMMARY`.

Gli header controllati sono HSTS con max-age positivo, nosniff, Referrer-Policy, X-Frame-Options valido oppure `frame-ancestors` nella CSP applicata, CSP applicata oppure Report-Only. La sola CSP Report-Only soddisfa la presenza della CSP ma non impone protezione frame. Si verifica la risposta finale HTTP valida su HTTPS. È un controllo minimo di presenza/valori, non un audit completo della policy.

## Renovate: attivazione da Matteo

1. Aprire la [GitHub App Renovate](https://github.com/apps/renovate), scegliere **Install**, poi `ducklink-team`. L'app è gratuita per repository pubblici e privati, senza piano a pagamento.
2. Selezionare i progetti e **anche il futuro repository privato `fuxx-ci`**: l'app deve poter leggere il preset. Completare l'onboarding nei progetti.
3. Nel `renovate.json` di ciascun progetto usare:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>ducklink-team/fuxx-ci//renovate/default"]
}
```

La sintassi `github>owner/repo//path/nome` risolve `path/nome.json`; qui risolve `renovate/default.json`. Su GitHub è equivalente a `local>ducklink-team/fuxx-ci//renovate/default`, forma raccomandata dalla documentazione per preset privati. Il repository privato del preset deve essere accessibile al token dell'app: non basta Actions → Access. Non inserire PAT nel preset. [Sintassi preset](https://docs.renovatebot.com/config-presets/), [preset privati e installazione dell'app nel repository centrale](https://docs.renovatebot.com/getting-started/private-packages/#private-config-presets).

Il preset propone aggiornamenti settimanali lunedì prima delle 06:00 Europe/Rome, raggruppa minor/patch, limita PR concorrenti e lascia `automerge: false`: decide il workflow FUXX. I major ricevono `serve-ok`. Prima di attivarlo su tutti i progetti verificare un onboarding reale e la risoluzione del preset.

## 2FA: controllo e impostazione manuale

Da un account Owner autenticato:

```powershell
gh api orgs/ducklink-team --jq .two_factor_requirement_enabled
```

Serve `true`; `null`, un campo assente o un errore di autorizzazione non dimostrano che sia attiva. Per attivarla: organizzazione **Settings → Authentication security → Two-factor authentication → Require two-factor authentication for everyone in your organization → Save**, quindi conferma dell'Owner. Verificare prima le persone coinvolte: gli outside collaborator senza 2FA perdono accesso. Questa corsia non ha modificato l'impostazione. [Guida ufficiale 2FA, disponibile anche su Free](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-two-factor-authentication-for-your-organization/requiring-two-factor-authentication-in-your-organization).

## Verifiche e integrazione

```powershell
node --test "fuxx-ci/scripts/test/*.test.mjs"
npm test
```

Il comando della radice **non include i test di `fuxx-ci`**: l'integratore deve aggiungere il primo comando alla suite dopo il merge. Non è stato modificato `package.json` della radice perché fuori corsia. Nel futuro repository standalone usare `npm test` dalla sua radice.

La verifica locale copre decisioni di merge con `gh` simulato che registra gli argomenti, header, licenze e adattatore AI. I sei YAML sono verificati con actionlint. Restano da provare realmente: accesso privato, nomi dei job Actions, esecuzione scanner Linux/Docker, revisione con chiave reale, merge e dispatch demo, onboarding Renovate, quota minuti. Nessun risultato locale simula una prova riuscita su GitHub.

## Scanner di sicurezza e file della PR

I file che la PR potrebbe usare per spegnere gli scanner non sono ammessi: il workflow `sicurezza` fallisce se il progetto traccia `.semgrepignore`, `.gitleaksignore`, `gitleaks*.toml`, `.semgrep.yml` o una cartella `__fuxx_ci` (a qualsiasi profondità). Gitleaks usa `config/gitleaks.toml` di fuxx-ci e `--ignore-gitleaks-allow`; Semgrep usa `--no-git-ignore` e `--disable-nosem`.

**Attenzione:** `--disable-nosem` rende inutili tutti i commenti `# nosemgrep` dei progetti: ogni finding Semgrep blocca, senza eccezioni locali. Un falso positivo va risolto cambiando il codice.

**Migrazione da versioni precedenti di @v1 (breaking).** In ogni progetto: togliere il job `revisione` da `ci.yml`; in `merge.yml` passare `modello-revisione` e il secret `OPENROUTER_API_KEY`; togliere l'input `revisione`; rimuovere eventuali `.semgrepignore`/`.gitleaksignore`. Il tag `v1` va riposizionato solo dopo la revisione umana di questa modifica.
