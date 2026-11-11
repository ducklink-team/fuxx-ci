# fuxx-ci — CI centrale FUXX

Cartella pronta a diventare la radice di `ducklink-team/fuxx-ci`, dopo il merge della corsia G. Il repository pubblicato usa il tag stabile `v4` per i workflow riusabili. Gli script sono Node ESM, senza dipendenze del progetto.

## Contenuto e utilizzo

- `.github/workflows/sicurezza.yml`: gitleaks **8.30.1** con checksum, Semgrep CE, audit bloccante, inventario licenze con avvisi.
- `.github/workflows/merge-automatico.yml`: controlla PR e job dello stesso run/SHA, revisione esplicita, file a rischio; merge squash e dispatch della demo.
- `.github/workflows/controllo-sito.yml`: header, ZAP baseline passivo, riepilogo e rapporto conservato sette giorni.
- `scripts/`: decisioni verificabili con `node --test`; `renovate/default.json`: preset condiviso.

Copiare `esempi/ci-progetto.yml` in `.github/workflows/ci.yml` del progetto e **anche** `esempi/merge-progetto.yml` in `.github/workflows/merge.yml`. Servono due workflow: CI su `pull_request`, merge privilegiato su `workflow_run` concluso. Non usare `pull_request_target` per eseguire codice PR. Il workflow di merge deve essere già sul ramo predefinito. Il progetto deve fornire gli script npm indicati nell'esempio. L'esempio CI non contiene più alcun job di revisione: la revisione la fa il revisore locale con `modo: commento-revisore`. Il job legacy di revisione in CI (`modo: job-ci`) è **sconsigliato**: il suo codice e il suo log li scrive la PR, quindi non dà garanzia (vedi "Sicurezza").

Per il controllo settimanale copiare `esempi/controllo-settimanale.yml`, impostare la variabile repository `DEMO_URL` con l'URL HTTPS della demo autorizzata. Il cron è lunedì alle 04:23 UTC. Un workflow solo `workflow_call` non si pianifica da sé.

Gli input `linguaggio: node|python`, `directory` (default `.`) e `requirements` (default `requirements.txt`, relativo alla directory progetto) configurano la sicurezza. Per Python usare il proprio job di test al posto del job npm nell'esempio. Audit Python blocca ogni vulnerabilità nota e la raccolta incompleta; audit Node blocca `high` e `critical`. Occorrono `package-lock.json` per Node oppure requirements installabili per Python, con tutte le dipendenze da verificare. I file di lock alternativi vanno esportati in requirements prima della chiamata.

L'input `runner` (stringa JSON, default `"ubuntu-latest"`) sceglie il runner dei tre workflow riusabili, per esempio `runner: ${{ vars.CI_RUNNER || '"ubuntu-latest"' }}` con `["self-hosted","fuxx-vps"]` in `CI_RUNNER`. `controllo-sito` usa docker: sui runner `fuxx-vps` senza socket Docker non funziona, quindi lasciarlo su `ubuntu-latest`.

L'inventario include dipendenze transitive e di sviluppo installate. Lista consentita: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0, Unlicense, Python-2.0. Espressioni SPDX AND/OR vengono valutate; nomi storici Python non riconosciuti, eccezioni WITH e licenze mancanti generano avvisi. Una licenza fuori lista **non** blocca; un inventario illeggibile o non eseguito blocca. È un controllo dei metadati, non una valutazione legale.

## Accesso privato e piano Free

**Sì: un repository privato di un'organizzazione GitHub Free può richiamare workflow di un altro repository privato della stessa organizzazione.** La documentazione ammette chiamante privato → centrale privato; Actions è disponibile sul piano Free. Non serve Team per questa condivisione. La prova con due repository privati reali resta da eseguire dopo la pubblicazione. Fonti: [accessibilità dei workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), [disponibilità di Actions](https://docs.github.com/en/actions/get-started/understand-github-actions).

Nel futuro repository centrale: **Settings → Actions → General → Access → Accessible from repositories in the 'ducklink-team' organization → Save**. Nel chiamante la policy Actions deve consentire workflow e azioni utilizzati. Per scaricare il workflow GitHub fornisce un token d'installazione temporaneo. [Istruzioni ufficiali di condivisione](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization).

**Scaricare il workflow e fare checkout degli script sono operazioni diverse.** `ducklink-team/fuxx-ci` è pubblico, quindi il workflow riusabile funziona anche senza `LETTURA_CI`; se il secret è configurato lo usa ancora, altrimenti usa il token del workflow. Per un repository centrale privato usare un token fine-grained con sola permission **Contents: read**, solo sul repository centrale e con scadenza, oppure un installation token di una GitHub App con lo stesso accesso. Configurarlo nei repository chiamanti; nessun valore va nei file. Il checkout disabilita `persist-credentials`. Vedi [checkout di un altro repository privato](https://github.com/actions/checkout#checkout-multiple-repos-private).

L'input `versione-ci` deve corrispondere al tag del workflow chiamato (default `v6`). Aggiornare insieme `uses: ...@vN`, checkout dell'adattatore AI ed eventuale input. Le azioni sono versionate per major; gli strumenti pip e il registro delle regole Semgrep sono aggiornati a ogni run. Renovate ne segnala gli aggiornamenti dove supportati.

GitHub Free per organizzazioni comprende una quota mensile di minuti/storage, non esecuzione privata illimitata. Prima dell'attivazione verificare il budget con Matteo e mantenere il limite di spesa a zero; nessun consumo è stato misurato da questa corsia. [Quote ufficiali Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Condizioni del merge automatico

Il chiamante di esempio aspetta l'intero workflow **CI progetto**. Lo script richiede i job esatti `CI progetto`, `sicurezza / Sicurezza` e, con `modo: job-ci` (default), il job indicato da `revisione` (default `Revisione AI`): tutti devono essere `completed/success`. La modalità consigliata `modo: commento-revisore` usa invece l'ultimo commento di `doubledrag33` che contiene una riga `ESITO:`: il verdetto è la prima riga (`ESITO: OK`) e lo SHA è la prima riga `SHA:`, che deve essere uguale allo SHA completo della PR. Il revisore scrive queste due righe per prime; il riassunto e i nomi dei file della PR vengono dopo e non contano.

In `commento-revisore` il merge verifica anche la provenienza dei controlli: il run deve essere una `pull_request` sullo SHA corrente, il file del workflow che l'ha eseguito deve esistere su `main` ed essere identico allo SHA della PR, e i job devono avere lo stesso SHA. Un workflow nuovo della PR con lo stesso nome di **CI progetto** non fa unire. Se GitHub restituisce un nome diverso nel repository reale, controllarlo con `gh api repos/ducklink-team/NOME/actions/runs/ID/jobs --jq '.jobs[].name'` e aggiornare gli input `controlli` (array JSON) e `revisione`. Un nome assente, duplicato o saltato sospende il merge.

`scripts/revisione-ai.mjs` del modello restituisce 0 con `verdetto: OK`, 1 con BLOCK e diagnostica `BLOCK file:riga`; può anche saltare la revisione tramite `REVISIONE_FACOLTATIVA`. L'adattatore `scripts/revisione.mjs` richiede la chiave, imposta `REVISIONE_FACOLTATIVA=0`, elimina `FUXX_OPENROUTER_FINTO`, controlla l'esito e pubblica una sola riga `FUXX_REVISIONE={"verdetto":"OK","sha":"..."}`. In `modo: job-ci`, `Revisione AI` resta obbligatorio per impostazione predefinita e il log deve contenere il marcatore sullo SHA corrente; non basta il job verde. Nell'esempio si usa `modo: commento-revisore` con `ESITO` e `SHA`. La chiave `OPENROUTER_API_KEY` resta quella del progetto, con tetto già concordato. Nessuna chiamata a pagamento è stata eseguita per verificare questa corsia.

Si ferma su PR chiusa, bozza, fork, base diversa da `main`, `non-unire`, `serve-ok`, revisione BLOCK/assente, SHA cambiato, job mancanti/rossi. I file sono paginati; il limite GitHub di 3000 file provoca arresto conservativo. Controlla anche il nome precedente delle rinomine.

File a rischio (il percorso è normalizzato: separatori `/` e `\`, `.` e `..` risolti, minuscole; vale a qualsiasi profondità): cartelle `db`, `auth`, `.github`, `.fuxx`, `__fuxx_ci` e cartelle il cui nome contiene `migration`; `contratto-api.md` o `spec.md` sotto una cartella `specs`; file `middleware.*`, `CODEOWNERS` (anche in minuscolo), `.env*`, `.gitleaks*`, `.semgrep*` (incluse le config e le ignore degli scanner); SQL (`.sql`, `.psql`, `.pgsql`, `.ddl`) contenenti la parola `policy`. Per SQL non eliminati legge il contenuto completo allo SHA della PR, così una policy fuori dal diff viene rilevata. SQL eliminati senza patch, contenuti non disponibili e rinomine da SQL vengono fermati prudentemente.

Su file a rischio applica `serve-ok` e commenta **"serve l'OK del responsabile: <file>"** in `modo: job-ci`, il comportamento precedente senza revisore locale. In `modo: commento-revisore` i file a rischio non fermano il merge (D-93): l'OK del revisore locale li copre perché viene scritto solo con Codex OK, Sicurezza Sonnet OK e nessuna migrazione distruttiva. Togliere manualmente `serve-ok` non autorizza il bot a ignorare l'etichetta di arresto: il responsabile dovrà approvare e unire manualmente secondo D-51. Non esiste un comando bot per dare quell'OK.

Prima di unire rilegge la PR. In `job-ci` resta `gh pr merge --squash --delete-branch --match-head-commit SHA`; in `commento-revisore` usa il commit costruito sulla coppia approvata come descritto sotto. Dopo l'unione cancella il ramo della PR solo nello stesso repository. Il workflow privilegiato scarica esclusivamente il codice centrale versionato: non esegue checkout, script o artefatti della PR. Permessi richiesti: `contents: write`, `pull-requests: write`, `issues: write`, `actions: write`.

Base della PR (D-93): in `commento-revisore` l'OK vale solo se la riga `Base:` coincide con la base riletta subito prima del merge. Il vincolo è nel codice anche sui repository privati Free: crea `fuxx-merge/<numero>-<sha8>` sulla base approvata, costruisce via API il commit di unione e verifica i genitori `[base, SHA]`, poi aggiorna atomicamente `main` a quel commit con un avanzamento veloce (`PATCH` del ref, `force: false`). Un avanzamento concorrente di `main` esterno a quella storia fa rifiutare il PATCH: il merge si ferma e riprova al giro dopo. Il ramo temporaneo viene cancellato in `finally`, anche in errore; una pulizia fallita produce un avviso e conserva l'esito precedente. Dopo un merge riuscito, la pulizia del ramo PR è separata: usa esclusivamente la mutazione GraphQL [`updateRefs`](https://docs.github.com/en/graphql/reference/git#updaterefs), con `beforeOid` uguale allo SHA approvato, `afterOid` a 40 zeri e `force: false`. Il confronto e la cancellazione sono atomici: un push successivo conserva il ramo. Se `updateRefs` fallisce o non è disponibile, il ramo viene lasciato con un motivo nel log; nessun DELETE REST sul ramo PR e nessuna pulizia sui fork. Conflitto (409) o niente da unire (204) fermano il merge. Se il PATCH viene rifiutato per protezioni, ripiega su `gh pr merge --merge --match-head-commit SHA` solo dopo aver letto `required_status_checks.strict === true` dalla protezione del ramo; altrimenti si ferma con `merge non vincolabile alla base: serve OK`. Questa lettura richiede un token con permesso repository **Administration: read**, non configurabile tra i permessi di `GITHUB_TOKEN`: senza accesso il ripiego si ferma. [API merges](https://docs.github.com/en/rest/branches/branches#merge-a-branch), [API refs](https://docs.github.com/en/rest/git/refs#update-a-reference), [API protezione](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection). Il controllo fast-forward non è un confronto atomico dello SHA corrente con `Base:`: se `main` avanza a un antenato del commit costruito, il PATCH può ancora riuscire; per vietare anche quel caso serve un'operazione con confronto esplicito del vecchio SHA.

Un merge effettuato con `GITHUB_TOKEN` **non genera una nuova esecuzione dei workflow su push**. Il codice verifica l'esistenza di `demo.yml`, poi dopo il merge esegue esplicitamente `gh workflow run demo.yml --ref main` nel repository progetto. `demo.yml` deve supportare `workflow_dispatch` (il modello lo supporta). Un 404 significa demo assente; altri errori non sono ignorati. In `commento-revisore`, il dispatch viene tentato anche se una o entrambe le pulizie falliscono. Se il dispatch fallisce, il merge resta riuscito (uscita 0): il log e il riepilogo riportano demo non avviata e un avviso per rilanciarla manualmente su main. Anche un errore di scrittura del riepilogo dopo il merge produce solo un avviso nel log. Il modo `job-ci` conserva il comportamento precedente, compreso il fallimento del comando in caso di errore di dispatch. [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

## Sicurezza

Cosa blocca ora (da attivare con il tag pubblicato `v4`):

- **Revisione AI:** l'esempio CI non contiene più il job con `OPENROUTER_API_KEY`, quindi nessun codice della PR la riceve. Il job legacy `modo: job-ci` è sconsigliato: il suo log lo scrive la PR.
- **Gitleaks:** il workflow scrive una config con sole regole predefinite (non dipende dal checkout di `versione-ci`): l'allowlist di `.gitleaks.toml` del progetto e i commenti `gitleaks:allow` non spengono la scansione. Un `.gitleaksignore` del progetto resta valido, ma una PR che lo aggiunge o lo modifica va all'OK del responsabile.
- **Semgrep:** `--disable-nosem` (i commenti `# nosemgrep` non disattivano i finding) e `--no-git-ignore`. Un `.semgrepignore` aggiunto o modificato dalla PR va all'OK del responsabile.
- **Merge `commento-revisore`:** il commento del revisore deve avere `ESITO` come prima riga e il primo `SHA:` deve coincidere con lo SHA della PR; il run deve essere una `pull_request` sullo SHA corrente; il file del workflow deve essere identico a quello su `main`.

Migrazione: non ci sono input o secret nuovi. Un progetto che oggi usa `# nosemgrep` o `gitleaks:allow` vede tornare rosso il controllo sicurezza finché il finding non è corretto. Nei repository locali non risultano chiamanti di `sicurezza.yml` né soppressioni di questo tipo.

Limiti: Semgrep non è stato eseguito in locale (non installato); gitleaks sì, con la config e i flag sopra. Nessuna prova è stata fatta su GitHub reale.

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
