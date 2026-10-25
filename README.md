# Castelfranco il cuore

Diario geo-sociale privato in stile 8-bit: le persone della mia vita tra Castelfranco e Hải Phòng, gli eventi vissuti con loro, i punti sugli assi sociali, la collezione di cose fatte insieme, più igiene e faccende di casa.

## Stack

- Node 20+ / TypeScript / Express, Postgres (Neon)
- Frontend senza build: ES modules in `public/`
- Meteo: MET Norway (riserva Open-Meteo). Notizie: ANSA RSS, VnExpress RSS (riserva GDELT). Font self-hosted (Press Start 2P, VT323, OFL) — nessuna chiamata a Google.

## Sicurezza

- Account solo con codice d'invito monouso (nel DB è salvato solo l'hash).
- Password con bcrypt, sessioni con token casuale in cookie `httpOnly`/`secure`/`SameSite=Lax` (nel DB solo l'hash).
- Ogni rotta `/api` richiede la sessione; ogni query filtra per `user_id` (niente IDOR).
- Le richieste che modificano dati devono avere l'header `X-Cuore: 1` (protezione CSRF).
- CSP con helmet; tutto il testo dell'utente è escapato nel template `html`.

## Comandi

```bash
npm install
DATABASE_URL=postgres://... npm run dev     # sviluppo
npm test                                     # test della logica (carry-over, cuori)
DATABASE_URL=postgres://... npm run invite   # crea un nuovo codice d'invito (stampato una volta)
npm run build && npm start                   # produzione
```

## Regole

- **Cuori (calore)**: outrovert + intimate + cuisine degli eventi con quella persona, pesati per relazione (famiglia ×1,25, amici e professionisti ×0,5; max 5 cuori): una cena in famiglia riempie i cuori, un caffè con un'amica ne dà circa 2. Ogni punto dura 30 giorni, sbiadisce negli ultimi 7.
- **Igiene**: doccia 1/giorno, capelli 1 ogni 2 giorni, denti 3/giorno. Quello che manca passa al periodo dopo (al massimo un periodo in più).
- **Faccende**: scopa, mocio, piante, bagno 1/settimana (lun–dom); se salti, la settimana dopo vale ×2.
- **Ciclo con Claude**: con `ANTHROPIC_API_KEY` impostata sul server, ogni evento salvato riceve in automatico i punti sui 10 assi da Claude Haiku (solo i punti: oggetti raccolti e idee li scegli tu nel modulo) (`ANTHROPIC_MODEL` per cambiare modello). Gli eventi privati partono solo se li invii tu dalla pagina Eventi. Senza chiave resta il copia e incolla: esporta il JSON, dallo a Claude col prompt dell'app, ricarica la risposta.
- **Eliminare un evento** annulla i suoi punti, gli oggetti raccolti e i suggerimenti che aveva generato.

## Servizi esterni

Tutte le chiamate partono dal server, mai dal browser: il tuo IP resta privato. Elenco e stato in app: `#/servizi`.

| Servizio | Uso | Come rispettiamo i termini |
|---|---|---|
| MET Norway (api.met.no) | meteo | User-Agent identificativo, coordinate a 4 decimali, `Expires` e `If-Modified-Since` salvati in Neon (`http_cache`), credito CC BY 4.0 |
| Open-Meteo | meteo di riserva | solo se MET Norway fallisce, cache 30 min, uso non commerciale, credito CC BY 4.0 |
| ANSA RSS | notizie mondo/Italia/Europa/Veneto | uso personale, titolo + link alla fonte, cache 30 min |
| VnExpress RSS | notizie Vietnam | uso personale, titolo + link alla fonte, cache 30 min |
| GDELT | notizie Vietnam di riserva | cache 1 h |
| Anthropic API | punteggio eventi | solo quando salvi un evento |

Il meteo si aggiorna solo mentre la pagina profilo è aperta e visibile; all'avvio il server non chiama nulla.

Pause per servizio (tabella `service_state`, sopravvive ai riavvii):
- quota giornaliera esaurita (429 "daily") → pausa fino alle 00:05 UTC;
- `Retry-After` → rispettato, massimo 1 giorno;
- 403 → "you are blocked": pausa 1 h, poi 1 giorno, poi stop finché non premi RIPROVA;
- 5xx, timeout, rete → 1, 2, 4 … 60 min;
- 400/404 per una singola risorsa → nessuna pausa.
Durante una pausa si mostra l'ultima copia in cache, se c'è.
