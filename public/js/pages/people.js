import { api, html, mount, modal, confirmBox, toast, relative, hearts, expiryText } from '../util.js';
import { sprite, CATEGORY_COLOR } from '../sprites.js';

export const CATEGORIES = [
  ['amici', 'Amici e parenti'],
  ['famiglia', 'Famiglia'],
  ['pro', 'Professionisti'],
];

const PENCIL = html`<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12 L2 9 L9 2 L12 5 L5 12 Z"/></svg>`;

export async function peoplePage(view, { params }) {
  let cat = params.get('tab') ?? 'amici';
  let data = await api('/people');
  let editing = null; // id of the person whose "prossima volta" note is open

  const draw = () => {
    const list = data.people.filter((p) => p.category === cat);
    const count = (k) => data.people.filter((p) => p.category === k).length;
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1>PERSONE</h1>
          <div class="right">
            <a class="btn small-btn" href="#/collezione" style="border-color:var(--gold);color:var(--gold)">COLLEZIONE</a>
            <a class="btn gold small-btn" href="#/persona/new?cat=${cat}">+ PERSONA</a>
          </div>
        </div>
        <div class="wrap">
          <div class="tabs" role="group" aria-label="Categorie">
            ${CATEGORIES.map(([k, l]) => html`<button type="button" data-cat="${k}" aria-pressed="${cat === k}">${l} (${count(k)})</button>`)}
          </div>
          ${list.length === 0 ? html`<div class="empty-state">Nessuno qui. Aggiungi una persona con + PERSONA.</div>` : ''}
          ${list.map((p) => {
            const color = CATEGORY_COLOR[p.category];
            return html`<div class="person">
              <div class="avatar" style="background:${color}">${p.name.slice(0, 1).toUpperCase()}</div>
              <div class="body">
                <div class="row">
                  <span class="name">${p.name.toUpperCase()}</span>
                  <span class="small muted" style="min-width:0">${[p.role, p.city].filter(Boolean).join(' · ')}</span>
                  <a class="icon-btn" style="margin-left:auto" href="#/persona/${p.id}" aria-label="Modifica ${p.name}">${PENCIL}</a>
                </div>
                <div class="small"><span class="px muted" style="font-size:7px">ULTIMA VOLTA</span> ${p.last ? relative(p.last.date, p.last.approx) : 'mai registrata'}</div>
                <div class="small">${hearts(p.warmth)} <span class="muted">${expiryText(p.warmth)}</span></div>
                ${editing === p.id
                  ? html`<div class="field">
                      <label class="field-label" for="note-${p.id}">PROSSIMA VOLTA</label>
                      <textarea id="note-${p.id}" data-note-input rows="3" maxlength="2000" placeholder="es. chiedere se il figlio è andato dalla famiglia della fidanzata">${p.next_note}</textarea>
                      <div class="row">
                        <button type="button" class="btn small-btn" data-note-cancel>ANNULLA</button>
                        <button type="button" class="btn gold small-btn" data-note-save="${p.id}">SALVA</button>
                      </div>
                    </div>`
                  : p.next_note
                    ? html`<button type="button" class="note" data-note-edit="${p.id}" aria-label="Modifica nota per la prossima volta con ${p.name}">
                        <span class="px gold" style="font-size:7px">PROSSIMA VOLTA</span>
                        <span style="white-space:pre-wrap">${p.next_note}</span>
                      </button>`
                    : html`<button type="button" class="btn ghost" style="min-height:36px;font-size:17px;justify-content:flex-start" data-note-edit="${p.id}">+ nota per la prossima volta</button>`}
                ${p.collected.length
                  ? html`<div class="itemrow"><span class="lbl">RACCOLTI</span>
                      ${p.collected.map(
                        (c) => html`<button type="button" class="tok" title="${c.name} · ${c.n}x" aria-label="${c.name}, raccolto ${c.n} volte" data-tip="${c.name} · raccolto ${c.n} ${c.n === 1 ? 'volta' : 'volte'}">${sprite(c.sprite, 3)}<span class="count">${c.n}x</span></button>`,
                      )}</div>`
                  : ''}
                ${p.suggestions.length
                  ? html`<div class="itemrow"><span class="lbl gold">DA RACCOGLIERE</span>
                      ${p.suggestions.map(
                        (s) => html`<button type="button" class="tok plan" title="${s.name}${s.tip ? ` — ${s.tip}` : ''}" aria-label="${s.name}: ${s.tip}" data-sugg="${s.id}" data-name="${s.name}" data-tip="${s.tip}" data-person="${p.name}">${sprite(s.sprite, 3)}</button>`,
                      )}</div>`
                  : ''}
              </div>
            </div>`;
          })}
        </div>`,
    );
  };

  view.addEventListener('click', async (e) => {
    const ne = e.target.closest('[data-note-edit]');
    if (ne) {
      editing = Number(ne.dataset.noteEdit);
      draw();
      view.querySelector('[data-note-input]')?.focus();
      return;
    }
    if (e.target.closest('[data-note-cancel]')) {
      editing = null;
      draw();
      return;
    }
    const ns = e.target.closest('[data-note-save]');
    if (ns) {
      const id = Number(ns.dataset.noteSave);
      const note = view.querySelector('[data-note-input]').value;
      try {
        await api(`/people/${id}/note`, { method: 'PUT', body: { note } });
        const p = data.people.find((x) => x.id === id);
        if (p) p.next_note = note.trim();
        editing = null;
        draw();
        toast(note.trim() ? 'Nota salvata.' : 'Nota cancellata.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const c = e.target.closest('[data-cat]');
    if (c) {
      cat = c.dataset.cat;
      history.replaceState(null, '', `#/persone?tab=${cat}`);
      draw();
      return;
    }
    const s = e.target.closest('[data-sugg]');
    if (s) {
      const choice = await modal(
        html`<h2>${s.dataset.name.toUpperCase()} · ${s.dataset.person}</h2>
          <p class="soft">${s.dataset.tip || 'Nessun dettaglio.'}</p>
          <div class="row wrap-row">
            <button type="button" class="btn green" data-v="done">FATTO OGGI</button>
            <button type="button" class="btn danger" data-v="del">RIMUOVI</button>
            <button type="button" class="btn" data-close>CHIUDI</button>
          </div>`,
        (d, close) => d.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-v]');
          if (b) close(b.dataset.v);
        }),
      );
      if (choice === 'done') {
        await api(`/suggestions/${s.dataset.sugg}/done`, { method: 'POST', body: {} });
        toast('Raccolto! +1 nella collezione.');
      } else if (choice === 'del') {
        await api(`/suggestions/${s.dataset.sugg}`, { method: 'DELETE', body: {} });
      } else return;
      data = await api('/people');
      draw();
      return;
    }
    const t = e.target.closest('[data-tip]');
    if (t) toast(t.dataset.tip);
  });

  draw();
}

const LEVELS = ['conoscente', 'amica', 'vicina', 'del cuore'];

export async function personFormPage(view, { arg, params }) {
  const isNew = !arg || arg === 'new';
  let p = { name: '', category: params.get('cat') ?? 'amici', city: 'Castelfranco', role: '', level: 'conoscente', notes: '' };
  if (!isNew) {
    const data = await api('/people');
    const found = data.people.find((x) => String(x.id) === arg);
    if (!found) {
      toast('Persona non trovata.', true);
      location.hash = '#/persone';
      return;
    }
    p = found;
  }

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/persone?tab=${p.category}" aria-label="Indietro">&lt;</a>
          <h1>${isNew ? 'NUOVA PERSONA' : 'SCHEDA PERSONA'}</h1>
        </div>
        <form class="wrap" id="f">
          <label class="field"><span>NOME</span><input type="text" name="name" required maxlength="60" value="${p.name}"></label>
          <div class="field"><span class="field-label">CATEGORIA</span>
            <div class="tabs" role="group" aria-label="Categoria">
              ${CATEGORIES.map(([k, l]) => html`<button type="button" data-cat="${k}" aria-pressed="${p.category === k}">${l}</button>`)}
            </div>
          </div>
          <div class="grid2">
            <label class="field"><span>CITTÀ</span><input type="text" name="city" list="cities" maxlength="60" value="${p.city}"></label>
            <label class="field"><span>CHI È PER TE</span><input type="text" name="role" maxlength="80" value="${p.role}" placeholder="collega, suocera…"></label>
          </div>
          <datalist id="cities"><option value="Castelfranco"><option value="Villarazzo"><option value="Vallà"><option value="Asolo"><option value="Vedelago"><option value="Breda di Piave"><option value="Stra"><option value="Hà Nội"><option value="Hải Phòng"></datalist>
          <div class="field"><span class="field-label">LIVELLO</span>
            <div class="row wrap-row">${LEVELS.map((l) => html`<button type="button" class="chip" data-level="${l}" aria-pressed="${p.level === l}">${l}</button>`)}</div>
          </div>
          <label class="field"><span>COSE DA RICORDARE</span><textarea name="notes" maxlength="2000">${p.notes}</textarea></label>
          <button class="btn gold big" type="submit">SALVA</button>
          ${isNew ? '' : html`<button class="btn danger" type="button" data-delete>ELIMINA PERSONA</button>`}
        </form>`,
    );

  const readForm = () => {
    const f = view.querySelector('#f');
    p = { ...p, name: f.name.value, city: f.city.value, role: f.role.value, notes: f.notes.value };
  };

  view.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) {
      readForm();
      p.category = c.dataset.cat;
      draw();
      return;
    }
    const l = e.target.closest('[data-level]');
    if (l) {
      readForm();
      p.level = l.dataset.level;
      draw();
      return;
    }
    if (e.target.closest('[data-delete]')) {
      if (!(await confirmBox(`Eliminare ${p.name}? Spariscono anche i suoi oggetti raccolti.`, 'ELIMINA'))) return;
      await api(`/people/${arg}`, { method: 'DELETE', body: {} });
      toast('Eliminata.');
      location.hash = `#/persone?tab=${p.category}`;
    }
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    const body = { name: p.name, category: p.category, city: p.city, role: p.role, level: p.level, notes: p.notes };
    try {
      if (isNew) await api('/people', { method: 'POST', body });
      else await api(`/people/${arg}`, { method: 'PUT', body });
      toast('Salvata.');
      location.hash = `#/persone?tab=${p.category}`;
    } catch (err) {
      toast(err.message, true);
    }
  });

  draw();
}
