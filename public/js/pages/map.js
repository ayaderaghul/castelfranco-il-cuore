import { api, html, mount, raw, hearts } from '../util.js';
import { chibi, CATEGORY_COLOR } from '../sprites.js';

const MAP = [
  '~~~~~~~~~~~~~',
  '~~ssssssss~~~',
  '~sggggggggs~~',
  '~sggbbbgvvs~~',
  '~sgrbbbrvvs~~',
  '~sggbbbgvvs~~',
  '~sggggggggs~~',
  '~~sggggggs~~~',
  '~~~ssssss~ss~',
  '~~~~~~~~~skks',
  '~~~~~~~~~~ss~',
  '~~~~~~~~~~~~~',
  '~~~~sssssss~~',
  '~~~shhhhhhhs~',
  '~~shphhrhhphs',
  '~~shhhhrhhhs~',
  '~~shphhrrrrs~',
  '~~~shhhhhps~~',
  '~~~~sssssss~~',
  '~~~~~~~~~~~~~',
];
const COL = { '~': '#1F4E79', s: '#D9C28A', g: '#3E7C4A', b: '#C8553D', v: '#5FA864', r: '#4A4A6A', k: '#8A9E4A', h: '#6B8F3E', p: '#D7263D' };

function tilesSvg() {
  let rects = '';
  MAP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      let c = COL[ch];
      if (ch === '~' && (x * 7 + y * 3) % 11 === 0) c = '#2A6F97';
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }),
  );
  return raw(`<svg class="tiles" viewBox="0 0 13 20" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`);
}

// Slot positions in pixels on a 390×600 reference map (chibi centre x, top y).
const SLOTS = {
  cf: [[72, 118], [244, 120], [120, 186], [205, 186], [258, 40], [100, 36], [180, 28]],
  stra: [[340, 262]],
  hp: [[120, 410], [250, 440], [185, 372], [90, 486], [205, 486], [300, 400]],
};
const ME = [165, 100];

function island(city) {
  const c = (city ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  if (/\bstra\b/.test(c)) return 'stra';
  if (/hai ?phong|viet ?nam|ha ?noi|thai nguyen|saigon|ho chi minh|da nang|hue/.test(c)) return 'hp';
  return 'cf';
}

const pos = ([x, y]) => `left:${((x / 390) * 100).toFixed(2)}%;top:${((y / 600) * 100).toFixed(2)}%`;

export async function mapPage(view) {
  const data = await api('/people');
  const used = { cf: 0, stra: 0, hp: 0 };
  const placed = [];
  const overflow = [];
  for (const p of data.people) {
    const k = island(p.city);
    const slot = SLOTS[k][used[k]];
    if (slot) {
      used[k] += 1;
      placed.push({ p, slot });
    } else overflow.push(p);
  }

  mount(
    view,
    html`<div class="head"><h1>LA MAPPA</h1><div class="right small muted">tocca una persona</div></div>
      <div class="map">
        ${tilesSvg()}
        <span class="label" style="left:2%;top:1%">CASTELFRANCO</span>
        <span class="label" style="left:61%;top:31%;font-family:var(--body);font-size:16px;color:#C9E6C0">Villarazzo</span>
        <span class="label" style="left:80%;top:54%;font-size:7px">STRA</span>
        <span class="label" style="left:22%;top:92%">HẢI PHÒNG · VIETNAM</span>
        <a class="chibi" href="#/profilo" style="${pos(ME)}" aria-label="Tu, vai al profilo">
          <span class="hearts" style="color:var(--gold)">★</span>${chibi('tu', '#F2C14E')}<span class="nm">TU</span>
        </a>
        ${placed.map(
          ({ p, slot }) => html`<a class="chibi" href="#/persone?tab=${p.category}" style="${pos(slot)}" aria-label="${p.name}, calore ${p.warmth.hearts} su 5">
            ${hearts(p.warmth)}${chibi(p.name, CATEGORY_COLOR[p.category])}<span class="nm">${p.name.length > 9 ? `${p.name.slice(0, 8)}…` : p.name}</span>
          </a>`,
        )}
      </div>
      <div class="wrap" style="margin-top:10px">
        ${data.people.length === 0 ? html`<div class="empty-state">La mappa è vuota: <a href="#/persona/new">aggiungi la prima persona</a>.</div>` : ''}
        ${overflow.length
          ? html`<div class="small soft">Non c’è più posto sull’isola per: ${overflow.map((p, i) => html`${i ? ', ' : ''}<a href="#/persone?tab=${p.category}">${p.name}</a>`)}</div>`
          : ''}
        <div class="row wrap-row tiny soft">
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#7FB3E6"></span>amici e parenti</span>
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#E58FB8"></span>famiglia</span>
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#C79BF2"></span>professionisti</span>
        </div>
        <div class="tiny soft"><span style="color:var(--heart)">♥</span> calore = outrovert + intimate + cuisine con quella persona negli ultimi 30 giorni · <span style="color:var(--heart);opacity:.4">♥</span> svanisce entro 7 giorni</div>
        <div class="tiny muted">L’isola dipende dalla città nella scheda: Stra, Vietnam/Hải Phòng, altrimenti Castelfranco.</div>
      </div>`,
  );
}
