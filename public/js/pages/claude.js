import { api, html, mount, toast, download, todayRome } from '../util.js';
import { AXES } from './profile.js';

export const PROMPT = `Sei il "maestro del gioco" di Castelfranco il cuore, il mio diario geo-sociale privato.
Ti allego un file JSON con i miei eventi non ancora valutati.

Il tuo unico compito sono i punti: non proporre oggetti né attività.
Per ogni evento assegna punti (interi da 0 a 3, raramente di più) su questi assi, solo dove servono:
- outrovert: ho passato tempo con gli altri, sono uscita
- cuisine: abbiamo mangiato o bevuto insieme, ho cucinato
- intimate: abbiamo parlato di famiglia o cose personali
- vulnerability: mi sono aperta, ho condiviso una fragilità
- integration: ho fatto qualcosa che mi integra in Italia (lingua, lavoro, usanze)
- brightness: ho fatto qualcosa che mi rasserena (es. meditazione)
- be_seen: qualcuno mi ha riconosciuta, mi sono sentita vista o brava in qualcosa
- rooted_italy: mi sono sentita a casa in Italia
- rooted_vietnam: mi sono sentita a casa / legata al Vietnam
- integrity: ho mantenuto un impegno, ho fatto il mio lavoro o il mio dovere con serietà (es. un turno al Nido)
Misura l'intensità: un caffè veloce vale poco (outrovert 1, cuisine 1); un pranzo o una cena insieme, soprattutto in famiglia, vale di più (cuisine 2-3).
Per ogni asse con punti scrivi un motivo breve.

Rispondi SOLO con un JSON valido in questo formato, senza testo prima o dopo:
{
  "eventi": [
    {
      "id": 12,
      "punti": { "outrovert": 1, "cuisine": 1 },
      "motivi": { "outrovert": "siete uscite insieme", "cuisine": "macchiato e cornetto" }
    }
  ]
}`;

const axisColor = Object.fromEntries(AXES.map((a) => [a.key, a.c]));

export async function claudePage(view) {
  const { autoScoring } = await api('/config');
  let busy = '';
  let includePrivate = false;
  let preview = null;
  let parseError = '';

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1 style="color:var(--violet)">CICLO CON CLAUDE</h1>
        </div>
        <div class="wrap">
          ${autoScoring
            ? html`<div class="panel callout" style="border-color:var(--violet)">
                <h2 style="color:var(--violet)">VALUTAZIONE AUTOMATICA ATTIVA</h2>
                <span class="small soft">Ogni evento che salvi viene valutato da Claude da solo. Gli eventi privati restano fuori, a meno che tu non li invii dalla pagina Eventi.</span>
                <button type="button" class="btn violet" data-score-all ${busy ? 'disabled' : ''}>${busy || 'VALUTA GLI EVENTI IN SOSPESO'}</button>
              </div>
              <h2 class="section-label">OPPURE A MANO</h2>`
            : html`<div class="small muted">La valutazione automatica non è attiva: aggiungi la chiave API su Render (ANTHROPIC_API_KEY). Intanto puoi usare il copia e incolla.</div>`}
          <div class="panel">
            <div class="row"><span class="btn gold small-btn" aria-hidden="true">1</span><span class="px" style="font-size:9px">SCARICA GLI EVENTI</span></div>
            <span class="small soft">Solo quelli non ancora valutati.</span>
            <label class="row small"><input type="checkbox" data-priv ${includePrivate ? 'checked' : ''}> includi anche gli eventi privati</label>
            <button type="button" class="btn" data-export>SCARICA .JSON</button>
          </div>

          <div class="panel">
            <div class="row"><span class="btn gold small-btn" aria-hidden="true">2</span><span class="px" style="font-size:9px">DALLO A CLAUDE</span></div>
            <span class="small soft">Copia il prompt, apri una chat con Claude, incolla il prompt e allega il file.</span>
            <button type="button" class="btn" data-copy style="border-color:var(--gold);color:var(--gold)">COPIA PROMPT</button>
            <details><summary class="small muted">vedi il prompt</summary><pre class="json">${PROMPT}</pre></details>
          </div>

          <div class="panel">
            <div class="row"><span class="btn gold small-btn" aria-hidden="true">3</span><span class="px" style="font-size:9px">CARICA LA RISPOSTA</span></div>
            <span class="small soft">Salva la risposta di Claude in un file .json, oppure incollala qui sotto.</span>
            <input type="file" accept="application/json,.json" data-file aria-label="File JSON di Claude">
            <textarea data-paste rows="4" placeholder='{"eventi": [ … ]}' aria-label="Incolla il JSON di Claude"></textarea>
            <button type="button" class="btn" data-parse>LEGGI</button>
            ${parseError ? html`<div class="err-text" role="alert">${parseError}</div>` : ''}
          </div>

          ${preview
            ? html`<div class="panel callout" style="border-color:var(--violet)">
                <h2 style="color:var(--violet)">PROPOSTA · ${preview.eventi.length} EVENTI</h2>
                ${preview.eventi.map(
                  (ev) => html`<div style="display:flex;flex-direction:column;gap:4px;border-bottom:2px dashed var(--line);padding-bottom:6px">
                    <span class="tiny muted">evento #${ev.id}</span>
                    <div class="row wrap-row">${Object.entries(ev.punti ?? {}).map(
                      ([k, v]) => html`<span class="chip static" title="${ev.motivi?.[k] ?? ''}" style="border-color:${axisColor[k] ?? '#6E6A8E'};color:${axisColor[k] ?? '#A8A3C2'}">${v > 0 ? '+' : ''}${v} ${k}</span>`,
                    )}</div>
                  </div>`,
                )}
                <div class="row">
                  <button type="button" class="btn" data-cancel style="flex:1">ANNULLA</button>
                  <button type="button" class="btn violet" data-apply style="flex:1">ACCETTA</button>
                </div>
              </div>`
            : ''}
        </div>`,
    );

  const readJson = (text) => {
    parseError = '';
    preview = null;
    try {
      const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const j = JSON.parse(cleaned);
      if (!Array.isArray(j.eventi)) throw new Error('manca "eventi"');
      preview = j;
    } catch (err) {
      parseError = `Il JSON non è valido: ${err.message}`;
    }
    draw();
  };

  view.addEventListener('change', async (e) => {
    if (e.target.matches('[data-priv]')) includePrivate = e.target.checked;
    if (e.target.matches('[data-file]') && e.target.files[0]) readJson(await e.target.files[0].text());
  });

  view.addEventListener('click', async (e) => {
    if (e.target.closest('[data-score-all]') && !busy) {
      const { events } = await api('/events');
      const todo = events.filter((ev) => !ev.scored_at && !ev.is_private);
      if (!todo.length) {
        toast('Nessun evento in sospeso.');
        return;
      }
      let ok = 0;
      for (const [i, ev] of todo.entries()) {
        busy = `VALUTO ${i + 1}/${todo.length}…`;
        draw();
        try {
          await api(`/events/${ev.id}/score`, { method: 'POST', body: {} });
          ok += 1;
        } catch (err) {
          toast(err.message, true);
          if (err.status === 400 || err.status === 429) break;
        }
      }
      busy = '';
      draw();
      toast(`Valutati ${ok} eventi su ${todo.length}.`, false, ok ? 'levelup' : 'ok');
      return;
    }
    if (e.target.closest('[data-export]')) {
      const data = await api(`/claude/export${includePrivate ? '?private=1' : ''}`);
      if (data.eventi.length === 0) {
        toast('Nessun evento da valutare.');
        return;
      }
      download(`eventi_${todayRome()}.json`, data);
      toast(`${data.eventi.length} eventi scaricati.`);
    }
    if (e.target.closest('[data-copy]')) {
      try {
        await navigator.clipboard.writeText(PROMPT);
        toast('Prompt copiato.');
      } catch {
        toast('Copia non riuscita: apri "vedi il prompt" e copialo a mano.', true);
      }
    }
    if (e.target.closest('[data-parse]')) readJson(view.querySelector('[data-paste]').value);
    if (e.target.closest('[data-cancel]')) {
      preview = null;
      draw();
    }
    if (e.target.closest('[data-apply]') && preview) {
      try {
        const r = await api('/claude/import', { method: 'POST', body: { eventi: preview.eventi } });
        toast(`Fatto: ${r.events} eventi valutati.${r.skipped.length ? ` Saltati: ${r.skipped.join(', ')}` : ''}`, false, 'levelup');
        preview = null;
        draw();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  draw();
}
