import { sfx } from '../sound.js';
import { api, html, mount, modal, confirmBox, toast } from '../util.js';
import { sprite, SPRITE_NAMES, CATEGORY_COLOR } from '../sprites.js';

const SWATCHES = ['#F2C14E', '#F28C6B', '#8FD694', '#7FB3E6', '#E58FB8', '#C79BF2', '#D7263D', '#4FC3B5'];

export async function collectionPage(view) {
  let data = await api('/collection');
  let people = (await api('/people')).people;
  const reload = async () => {
    data = await api('/collection');
    draw();
  };

  const short = (name) => name.slice(0, 2).toUpperCase();
  const total = () => data.categories.reduce((n, c) => n + c.items.length, 0);

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1>COLLEZIONE</h1>
          <div class="right"><span class="small muted">${total()} oggetti</span><button type="button" class="btn gold small-btn" data-add-item>+ OGGETTO</button></div>
        </div>
        <div class="wrap">
          <div class="small muted">Le cose che sai fare tu. Falle con qualcuno (l’oggetto finisce nella sua scheda) o da sola (compare come TU e sul profilo).</div>
          <div class="row wrap-row tiny soft">
            <span class="row" style="gap:4px"><span class="tag done"></span>fatto con</span>
            <span class="row" style="gap:4px"><span class="tag plan"></span>da fare con</span>
            <span class="row" style="gap:4px"><span class="tag solo"></span>ancora solo tuo</span>
          </div>
          ${data.categories.length === 0 ? html`<div class="empty-state">Nessuna categoria. Inizia con + NUOVA CATEGORIA, es. “Cibo”.</div>` : ''}
          ${data.categories.map(
            (c) => html`<section style="display:flex;flex-direction:column;gap:6px">
              <div class="row between">
                <span class="px" style="font-size:9px;color:${c.color}">${c.name.toUpperCase()}</span>
                <span class="row"><span class="tiny muted">${c.items.length} ${c.items.length === 1 ? 'oggetto' : 'oggetti'}</span>
                <button type="button" class="icon-btn" data-del-cat="${c.id}" data-name="${c.name}" aria-label="Elimina categoria ${c.name}">×</button></span>
              </div>
              <div class="grid2">
                ${c.items.map(
                  (i) => html`<button type="button" class="item-tile" data-item="${i.id}">
                    <span class="sp">${sprite(i.sprite, 4)}</span>
                    <span class="info">
                      <span style="font-size:18px;line-height:1">${i.name}</span>
                      <span class="row wrap-row" style="gap:3px">
                        ${i.collected.map((x) => html`<span class="tag done" title="${x.person_id === null ? 'da sola' : `fatto con ${x.name}`} · ${x.n}x">${x.person_id === null ? 'TU' : short(x.name)}${x.n > 1 ? `·${x.n}` : ''}</span>`)}
                        ${i.planned.map((x) => html`<span class="tag plan" title="da fare con ${x.name}">${short(x.name)}</span>`)}
                        ${!i.collected.length && !i.planned.length ? html`<span class="tag solo">SOLO TUO</span>` : ''}
                      </span>
                    </span>
                  </button>`,
                )}
                <button type="button" class="btn ghost" data-add-item="${c.id}" aria-label="Aggiungi oggetto in ${c.name}">+ nuovo</button>
              </div>
            </section>`,
          )}
          <button type="button" class="btn ghost" data-add-cat style="border-color:var(--gold);color:var(--gold)">+ NUOVA CATEGORIA</button>
        </div>`,
    );

  async function newCategory() {
    let color = SWATCHES[0];
    const res = await modal(
      html`<h2>NUOVA CATEGORIA</h2>
        <form>
          <label class="field"><span>NOME</span><input type="text" name="name" required maxlength="40" autofocus placeholder="Cibo, Camminata…"></label>
          <div class="field"><span class="field-label">COLORE</span>
            <div class="row wrap-row">${SWATCHES.map((s, i) => html`<button type="button" class="chip" data-sw="${s}" aria-pressed="${i === 0}" aria-label="colore ${s}" style="background:${s};width:36px"></button>`)}</div>
          </div>
          <div class="row"><button type="button" class="btn" data-close>ANNULLA</button><button class="btn gold" type="submit">CREA</button></div>
        </form>`,
      (d, close) => {
        d.addEventListener('click', (e) => {
          const s = e.target.closest('[data-sw]');
          if (!s) return;
          color = s.dataset.sw;
          d.querySelectorAll('[data-sw]').forEach((b) => b.setAttribute('aria-pressed', String(b === s)));
        });
        d.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          close({ name: e.target.name.value, color });
        });
      },
    );
    if (!res) return;
    await api('/categories', { method: 'POST', body: res });
    await reload();
  }

  async function newItem(categoryId) {
    if (data.categories.length === 0) {
      toast('Crea prima una categoria.', false, 'error');
      return newCategory();
    }
    let chosen = 'stella';
    const sprites = data.sprites;
    const res = await modal(
      html`<h2>NUOVO OGGETTO</h2>
        <form>
          <label class="field"><span>NOME</span><input type="text" name="name" required maxlength="60" autofocus placeholder="Pollo al miele, Montagna…"></label>
          <label class="field"><span>CATEGORIA</span>
            <select name="cat">${data.categories.map((c) => html`<option value="${c.id}" ${String(c.id) === String(categoryId) ? 'selected' : ''}>${c.name}</option>`)}</select>
          </label>
          <div class="field"><span class="field-label">ICONA</span>
            <div class="sprite-pick">${sprites.map(
              (s) => html`<button type="button" data-sp="${s}" aria-pressed="${s === chosen}" aria-label="${SPRITE_NAMES[s] ?? s}" title="${SPRITE_NAMES[s] ?? s}">${sprite(s, 4)}</button>`,
            )}</div>
          </div>
          <div class="row"><button type="button" class="btn" data-close>ANNULLA</button><button class="btn gold" type="submit">CREA</button></div>
        </form>`,
      (d, close) => {
        d.addEventListener('click', (e) => {
          const b = e.target.closest('[data-sp]');
          if (!b) return;
          chosen = b.dataset.sp;
          d.querySelectorAll('[data-sp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        });
        d.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          close({ name: e.target.name.value, categoryId: Number(e.target.cat.value), sprite: chosen });
        });
      },
    );
    if (!res) return;
    try {
      await api('/items', { method: 'POST', body: res });
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function openItem(id) {
    const item = data.categories.flatMap((c) => c.items).find((i) => i.id === id);
    if (!item) return;
    const opts = people.map((p) => html`<option value="${p.id}">${p.name}</option>`);
    const res = await modal(
      html`<h2>${item.name.toUpperCase()}</h2>
        <div class="row" style="margin-bottom:8px">${sprite(item.sprite, 6)}
          <div class="small soft">
            ${item.collected.length
              ? item.collected.map((x) => html`<div>✓ ${x.person_id === null ? 'da sola' : `con ${x.name}`} · ${x.n}x</div>`)
              : html`<div>Ancora non raccolto.</div>`}
            ${item.planned.map((x) => html`<div class="gold">▸ da fare con ${x.name}${x.tip ? ` — ${x.tip}` : ''}</div>`)}
          </div>
        </div>
        <form data-f="collect">
          <label class="field"><span>FATTO OGGI</span><select name="person"><option value="">da sola</option>${opts}</select></label>
          <button class="btn green" type="submit">RACCOGLI +1</button>
        </form>
        ${people.length
          ? html`<form data-f="plan" style="margin-top:12px">
              <label class="field"><span>PIANIFICA CON</span><select name="person">${opts}</select></label>
              <label class="field"><span>CONSIGLIO</span><input type="text" name="tip" maxlength="500" placeholder="es. Fissate la data per Natale"></label>
              <button class="btn" type="submit" style="border-color:var(--gold);color:var(--gold)">AGGIUNGI AI “DA RACCOGLIERE”</button>
            </form>`
          : ''}
        <div class="row" style="margin-top:12px"><button type="button" class="btn" data-close>CHIUDI</button><button type="button" class="btn danger" data-v="del">ELIMINA OGGETTO</button></div>`,
      (d, close) => {
        d.addEventListener('click', (e) => {
          if (e.target.closest('[data-v="del"]')) close({ kind: 'del' });
        });
        d.querySelectorAll('form').forEach((f) =>
          f.addEventListener('submit', (e) => {
            e.preventDefault();
            close({ kind: f.dataset.f, personId: f.person.value ? Number(f.person.value) : null, tip: f.tip?.value ?? '' });
          }),
        );
      },
    );
    if (!res) return;
    try {
      if (res.kind === 'collect') {
        await api(`/items/${id}/collect`, { method: 'POST', body: { personId: res.personId } });
        toast(res.personId === null ? 'Raccolto da sola!' : 'Raccolto!', false, 'coin');
      } else if (res.kind === 'plan') {
        await api('/suggestions', { method: 'POST', body: { personId: res.personId, itemId: id, tip: res.tip } });
        toast('Aggiunto ai “da raccogliere”.');
      } else if (res.kind === 'del') {
        if (!(await confirmBox(`Eliminare “${item.name}” e tutte le sue raccolte?`, 'ELIMINA'))) return;
        await api(`/items/${id}`, { method: 'DELETE', body: {} });
        sfx('del');
      }
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  }

  view.addEventListener('click', async (e) => {
    const ai = e.target.closest('[data-add-item]');
    if (ai) return newItem(ai.dataset.addItem);
    if (e.target.closest('[data-add-cat]')) return newCategory();
    const dc = e.target.closest('[data-del-cat]');
    if (dc) {
      if (!(await confirmBox(`Eliminare la categoria “${dc.dataset.name}” e i suoi oggetti?`, 'ELIMINA'))) return;
      await api(`/categories/${dc.dataset.delCat}`, { method: 'DELETE', body: {} });
      sfx('del');
      return reload();
    }
    const it = e.target.closest('[data-item]');
    if (it) return openItem(Number(it.dataset.item));
  });

  draw();
}

export { CATEGORY_COLOR };
