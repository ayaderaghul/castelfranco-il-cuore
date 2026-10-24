# Castelfranco il cuore

Diario geo-sociale privato in stile 8-bit: le persone della mia vita tra Castelfranco e Hải Phòng, gli eventi vissuti con loro, i punti sugli assi sociali, la collezione di cose fatte insieme, più igiene e faccende di casa.

## Stack

- Node 20+ / TypeScript / Express, Postgres (Neon)
- Frontend senza build: ES modules in `public/`
- Meteo: Open-Meteo (senza chiave). Notizie: Google News RSS.

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

- **Cuori (calore)**: outrovert + intimate + cuisine degli eventi con quella persona; ogni punto dura 30 giorni, sbiadisce negli ultimi 7.
- **Igiene**: doccia 1/giorno, capelli 1 ogni 2 giorni, denti 3/giorno. Quello che manca passa al periodo dopo (al massimo un periodo in più).
- **Faccende**: scopa, mocio, piante, bagno 1/settimana (lun–dom); se salti, la settimana dopo vale ×2.
- **Ciclo con Claude**: con `ANTHROPIC_API_KEY` impostata sul server, ogni evento salvato viene valutato in automatico da Claude Haiku (`ANTHROPIC_MODEL` per cambiare modello). Gli eventi privati partono solo se li invii tu dalla pagina Eventi. Senza chiave resta il copia e incolla: esporta il JSON, dallo a Claude col prompt dell'app, ricarica la risposta.
- **Eliminare un evento** annulla i suoi punti, gli oggetti raccolti e i suggerimenti che aveva generato.
