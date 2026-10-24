import { api, html, mount, modal, toast, fmtDate, todayRome, relative } from '../util.js';
import { sprite, CATEGORY_COLOR } from '../sprites.js';
import { AXES } from './profile.js';

const WHEN = [
  ['oggi', 'oggi'],
  ['ieri', 'ieri'],
  ['giorni', 'qualche giorno fa'],
  ['settimane', 'settimane fa'],
  ['tempo_fa', 'tempo fa'],
  ['esatta', 'data esatta…'],
];

export async function eventPage(view, { params }) {
  const [peopleData, coll, config] = await Promise.all([api('/people'), api('/collection'), api('/config')]);
  const auto = config.autoScoring;
  const people = peopleData.people;
  const items = coll.categories.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.name })));
  const preset = params.get('persona');
  const st = {
    personIds: new Set(preset ? [Number(preset)] : []),
    itemIds: new Set(),
    when: 'oggi',
    exact: todayRome(),
    what: '',
    positive: '',
    idea: '',
    priv: false,
  };

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1>NUOVO EVENTO</h1>
        </div>
        <form class="wrap" id="f">
          <div class="field"><span class="field-label">CON CHI</span>
            <div class="row wrap-row">
              ${people.length === 0 ? html`<span class="small muted">Nessuna persona ancora. <a href="#/persona/new">Aggiungine una</a>.</span>` : ''}
              ${people.map(
                (p) => html`<button type="button" class="chip" data-person="${p.id}" aria-pressed="${st.personIds.has(p.id)}" style="${st.personIds.has(p.id) ? `background:${CATEGORY_COLOR[p.category]};border-color:${CATEGORY_COLOR[p.category]}` : ''}">${p.name}</button>`,
              )}
            </div>
            <span class="tiny muted">Nessuno selezionato = evento da sola (es. lavoro al Nido).</span>
          </div>

          <div class="field"><span class="field-label">QUANDO</span>
            <div class="row wrap-row">${WHEN.map(([k, l]) => html`<button type="button" class="chip" data-when="${k}" aria-pressed="${st.when === k}">${l}</button>`)}</div>
            ${st.when === 'esatta' ? html`<input type="date" name="exact" value="${st.exact}" max="${todayRome()}" aria-label="Data esatta">` : ''}
          </div>

          <label class="field"><span>COSA È SUCCESSO</span><textarea name="what" rows="5" maxlength="5000">${st.what}</textarea></label>
          <label class="field"><span>COSA DI POSITIVO HO RICEVUTO</span><textarea name="positive" rows="3" maxlength="3000">${st.positive}</textarea></label>
          <label class="field"><span>IDEA CON QUESTA PERSONA</span><textarea name="idea" rows="2" maxlength="2000">${st.idea}</textarea></label>

          <div class="field"><span class="field-label">OGGETTI RACCOLTI INSIEME (facoltativo)</span>
            <div class="row wrap-row">
              ${items.length === 0 ? html`<span class="small muted">La collezione è vuota: <a href="#/collezione">crea il primo oggetto</a>.</span>` : ''}
              ${items.map(
                (i) => html`<button type="button" class="chip" data-item="${i.id}" aria-pressed="${st.itemIds.has(i.id)}">${sprite(i.sprite, 2)} ${i.name}</button>`,
              )}
            </div>
          </div>

          <div class="panel" style="border-color:var(--blue);flex-direction:row;align-items:center">
            <div style="flex:1"><span class="px" style="font-size:8px;color:var(--blue)">PRIVATO</span><br><span class="small soft">Non viene esportato per Claude, a meno che tu non lo scelga.</span></div>
            <button type="button" class="btn ${st.priv ? 'blue' : ''}" data-priv aria-pressed="${st.priv}">${st.priv ? 'ON' : 'OFF'}</button>
          </div>

          ${auto
            ? html`<div class="tiny muted" style="text-align:center">${st.priv ? 'Evento privato: non viene inviato a Claude.' : 'Appena salvi, Claude assegna i punti da solo.'}</div>
                <button class="btn gold big" type="submit" data-go="eventi">SALVA</button>`
            : html`<div class="tiny muted" style="text-align:center">I punti non li scegli qui: li propone Claude.</div>
                <div class="row">
                  <button class="btn" type="submit" data-go="eventi" style="flex:1">SALVA</button>
                  <button class="btn gold" type="submit" data-go="claude" style="flex:1.4">SALVA + CLAUDE</button>
                </div>`}
        </form>`,
    );

  const readForm = () => {
    const f = view.querySelector('#f');
    st.what = f.what.value;
    st.positive = f.positive.value;
    st.idea = f.idea.value;
    if (f.exact) st.exact = f.exact.value;
  };

  view.addEventListener('click', (e) => {
    const p = e.target.closest('[data-person]');
    const w = e.target.closest('[data-when]');
    const i = e.target.closest('[data-item]');
    const pr = e.target.closest('[data-priv]');
    if (!p && !w && !i && !pr) return;
    readForm();
    if (p) {
      const id = Number(p.dataset.person);
      st.personIds.has(id) ? st.personIds.delete(id) : st.personIds.add(id);
    }
    if (w) st.when = w.dataset.when;
    if (i) {
      const id = Number(i.dataset.item);
      st.itemIds.has(id) ? st.itemIds.delete(id) : st.itemIds.add(id);
    }
    if (pr) st.priv = !st.priv;
    draw();
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    const go = e.submitter?.dataset.go ?? 'eventi';
    if (!st.what.trim()) {
      toast('Scrivi cosa è successo.', true);
      return;
    }
    if (st.itemIds.size && !st.personIds.size) {
      toast('Gli oggetti si raccolgono con qualcuno: scegli almeno una persona.', true);
      return;
    }
    try {
      await api('/events', {
        method: 'POST',
        body: {
          personIds: [...st.personIds],
          itemIds: [...st.itemIds],
          when_kind: st.when,
          exact: st.when === 'esatta' ? st.exact : undefined,
          what: st.what,
          positive: st.positive,
          idea: st.idea,
          is_private: st.priv,
        },
      });
      toast(auto && !st.priv ? 'Evento salvato. Claude lo sta valutando…' : 'Evento salvato.');
      location.hash = `#/${go}`;
    } catch (err) {
      toast(err.message, true);
    }
  });

  draw();
}

const axisColor = Object.fromEntries(AXES.map((a) => [a.key, a.c]));
const axisName = Object.fromEntries(AXES.map((a) => [a.key, a.name.replace(' point', '')]));

export async function diaryPage(view) {
  let data = await api('/events');
  const scoring = new Set(); // events being scored right now from this page
  let polls = 0;

  // Saved in the last 2 minutes and not scored yet: the server is still working on it.
  const isPending = (ev) =>
    data.autoScoring && !ev.scored_at && !ev.score_error && !ev.is_private && Date.now() - Date.parse(ev.created_at) < 120000;
  const status = (ev) => {
    if (ev.scored_at) return 'nessun punto';
    if (scoring.has(ev.id)) return 'Claude sta valutando…';
    if (ev.is_private) return data.autoScoring ? 'privato · non inviato a Claude' : 'privato';
    if (ev.score_error) return 'valutazione non riuscita';
    if (isPending(ev)) return 'Claude sta valutando…';
    return 'da valutare con Claude';
  };

  // While the server scores freshly saved events in the background, refresh every few seconds.
  const poll = () => {
    if (!view.isConnected || polls > 20) return;
    if (!data.events.some(isPending)) return;
    polls += 1;
    setTimeout(async () => {
      if (!view.isConnected) return;
      data = await api('/events');
      draw();
      poll();
    }, 3000);
  };

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1>EVENTI</h1>
          <div class="right"><a class="btn gold small-btn" href="#/evento">+ EVENTO</a></div>
        </div>
        <div class="wrap">
          ${data.events.length === 0 ? html`<div class="empty-state">Ancora nessun evento.</div>` : ''}
          ${data.events.map(
            (ev) => html`<div class="panel">
              <div class="row between">
                <span class="px" style="font-size:8px">${fmtDate(ev.event_date)}${ev.when_kind !== 'esatta' && ev.when_kind !== 'oggi' && ev.when_kind !== 'ieri' ? ' ~' : ''}</span>
                <span class="tiny muted">${relative(ev.event_date, !['esatta', 'oggi', 'ieri'].includes(ev.when_kind))}${ev.is_private ? ' · privato' : ''}</span>
              </div>
              ${ev.people.length
                ? html`<div class="row wrap-row">${ev.people.map((p) => html`<span class="chip static" style="border-color:${CATEGORY_COLOR[p.category]};color:${CATEGORY_COLOR[p.category]}">${p.name}</span>`)}</div>`
                : html`<span class="tiny muted">da sola</span>`}
              <div style="white-space:pre-wrap">${ev.what}</div>
              ${ev.positive ? html`<div class="small soft">+ ${ev.positive}</div>` : ''}
              ${ev.idea ? html`<div class="small gold">▸ ${ev.idea}</div>` : ''}
              <div class="row wrap-row">
                ${ev.points.length
                  ? ev.points.map(
                      (pt) => html`<span class="chip static" title="${pt.reason}" style="border-color:${axisColor[pt.axis] ?? '#A8A3C2'};color:${axisColor[pt.axis] ?? '#A8A3C2'}">${pt.delta > 0 ? '+' : ''}${pt.delta} ${axisName[pt.axis] ?? pt.axis}</span>`,
                    )
                  : html`<span class="tiny muted">${status(ev)}</span>`}
              </div>
              ${ev.score_error && !ev.scored_at ? html`<div class="err-text small">Claude: ${ev.score_error}</div>` : ''}
              <div class="row wrap-row">
                ${data.autoScoring && !scoring.has(ev.id) && !isPending(ev)
                  ? html`<button type="button" class="btn small-btn" data-score="${ev.id}" data-private="${ev.is_private}" style="border-color:var(--violet);color:var(--violet)">${ev.scored_at ? 'RIVALUTA' : ev.is_private ? 'INVIA A CLAUDE' : ev.score_error ? 'RIPROVA' : 'VALUTA ORA'}</button>`
                  : ''}
                <button type="button" class="btn danger small-btn" style="margin-left:auto" data-del="${ev.id}">ELIMINA</button>
              </div>
            </div>`,
          )}
        </div>`,
    );

  view.addEventListener('click', async (e) => {
    const sc = e.target.closest('[data-score]');
    if (sc) {
      const id = Number(sc.dataset.score);
      const priv = sc.dataset.private === 'true';
      if (priv) {
        const ok = await modal(
          html`<h2>INVIARE A CLAUDE UN EVENTO PRIVATO?</h2>
            <p class="small soft">Il testo dell’evento va all’API di Claude per essere valutato.</p>
            <div class="row"><button type="button" class="btn" data-close>ANNULLA</button><button type="button" class="btn violet" data-ok>INVIA</button></div>`,
          (m, close) => m.querySelector('[data-ok]').addEventListener('click', () => close(true)),
        );
        if (!ok) return;
      }
      scoring.add(id);
      draw();
      try {
        const r = await api(`/events/${id}/score`, { method: 'POST', body: { includePrivate: priv } });
        toast(`Valutato: ${r.points > 0 ? '+' : ''}${r.points} punti, ${r.collected} oggetti, ${r.suggestions} suggerimenti.`);
      } catch (err) {
        toast(err.message, true);
      }
      scoring.delete(id);
      data = await api('/events');
      draw();
      return;
    }
    const d = e.target.closest('[data-del]');
    if (!d) return;
    const ev = data.events.find((x) => String(x.id) === d.dataset.del);
    if (!ev) return;
    const undo = [
      ...ev.points.map((pt) => `${pt.delta > 0 ? '−' : '+'}${Math.abs(pt.delta)} ${axisName[pt.axis] ?? pt.axis}`),
      ev.collected ? `−${ev.collected} oggetti raccolti` : '',
      ev.suggestions ? `−${ev.suggestions} suggerimenti` : '',
    ].filter(Boolean);
    const ok = await modal(
      html`<h2>ELIMINARE L’EVENTO DEL ${fmtDate(ev.event_date).toUpperCase()}?</h2>
        ${undo.length
          ? html`<p class="small soft">Verrà annullato:</p><div class="row wrap-row">${undo.map((u) => html`<span class="chip static">${u}</span>`)}</div>`
          : html`<p class="small soft">Non ha ancora punti: sparisce solo dal diario.</p>`}
        <p class="tiny muted">I cuori sulla mappa si aggiornano da soli.</p>
        <div class="row"><button type="button" class="btn" data-close>ANNULLA</button><button type="button" class="btn danger" data-ok>ELIMINA</button></div>`,
      (m, close) => m.querySelector('[data-ok]').addEventListener('click', () => close(true)),
    );
    if (!ok) return;
    await api(`/events/${ev.id}`, { method: 'DELETE', body: {} });
    toast(undo.length ? `Evento eliminato: ${undo.join(', ')}` : 'Evento eliminato.');
    data = await api('/events');
    draw();
  });

  draw();
  poll();
}
