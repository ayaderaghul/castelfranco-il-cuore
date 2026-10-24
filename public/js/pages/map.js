import { api, html, mount, raw, hearts } from '../util.js';
import { chibi, CATEGORY_COLOR } from '../sprites.js';

// The world is a 16 × 41 tile grid: Veneto island on top, Vietnam island below.
const COLS = 16;
const ROWS = 41;

// Towns, in tile coordinates (col = centre of the town, row = its marker tile).
// The layout keeps the real directions roughly (Asolo north-west, Stra south,
// Breda east, Hải Phòng east of Hà Nội) but spaces them out so chibis fit.
const TOWNS = [
  { key: 'asolo', name: 'ASOLO', col: 3, row: 2, island: 've' },
  { key: 'valla', name: 'VALLÀ', col: 11.5, row: 2, island: 've' },
  { key: 'castelfranco', name: 'CASTELFRANCO', col: 4, row: 8, island: 've', castle: true },
  { key: 'vedelago', name: 'VEDELAGO', col: 11.5, row: 8, island: 've' },
  { key: 'villarazzo', name: 'VILLARAZZO', col: 4, row: 16, island: 've' },
  { key: 'breda', name: 'BREDA DI PIAVE', col: 11.5, row: 16, island: 've' },
  { key: 'stra', name: 'STRA', col: 7.5, row: 22.2, island: 've' },
  { key: 'hanoi', name: 'HÀ NỘI', col: 4, row: 31.5, island: 'vn' },
  { key: 'haiphong', name: 'HẢI PHÒNG', col: 11.5, row: 33.5, island: 'vn' },
];
const TOWN = Object.fromEntries(TOWNS.map((t) => [t.key, t]));

/** Which town a city name belongs to. Unknown Italian places go to Castelfranco, unknown Vietnamese ones to Hải Phòng. */
export function townOf(city) {
  const c = (city ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  if (/asolo/.test(c)) return 'asolo';
  if (/\bvalla\b/.test(c)) return 'valla';
  if (/villarazzo/.test(c)) return 'villarazzo';
  if (/vedelago/.test(c)) return 'vedelago';
  if (/breda/.test(c)) return 'breda';
  if (/\bstra\b/.test(c)) return 'stra';
  if (/ha ?noi|thai nguyen/.test(c)) return 'hanoi';
  if (/hai ?phong|viet ?nam|saigon|ho chi minh|da nang|hue/.test(c)) return 'haiphong';
  return 'castelfranco';
}

// Up to 6 chibis per town: two rows of three under the town marker (pixel offsets).
const SLOTS = [
  [0, 0], [-60, 0], [60, 0],
  [0, 76], [-60, 76], [60, 76],
];

const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

function inside(x, y, cx, cy, rx, ry) {
  // A slightly wobbly superellipse so the islands look hand-drawn, not perfect ovals.
  const wobble = ((hash(x, y) % 7) - 3) * 0.025;
  return Math.abs((x + 0.5 - cx) / rx) ** 2.6 + Math.abs((y + 0.5 - cy) / ry) ** 2.6 <= 1 + wobble;
}
const ISLANDS = [
  { id: 've', cx: 8, cy: 13.4, rx: 7.6, ry: 13 },
  { id: 'vn', cx: 8, cy: 34.6, rx: 7.6, ry: 6.1 },
];
const islandAt = (x, y) => ISLANDS.find((i) => inside(x, y, i.cx, i.cy, i.rx, i.ry));

// The Musone, flowing north to south through the Veneto island.
const isRiver = (x, y) => y >= 3 && y <= 20 && x === Math.round(8 + Math.sin(y / 2.2) * 0.8);

function tilesSvg() {
  let rects = '';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const isl = islandAt(x, y);
      let c;
      if (!isl) c = (x * 7 + y * 3) % 11 === 0 ? '#2A6F97' : '#1F4E79';
      else {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !islandAt(x + dx, y + dy));
        if (edge) c = '#D9C28A';
        else if (isl.id === 've' && isRiver(x, y)) c = '#3A86B5';
        else if (isl.id === 'vn') c = hash(x, y) % 19 === 0 ? '#C0392B' : hash(x, y) % 4 === 0 ? '#5E8235' : '#6B8F3E';
        else c = hash(x, y) % 5 === 0 ? '#4A8A55' : '#3E7C4A';
      }
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  // Town markers: a small castle for Castelfranco, a house for the others.
  for (const t of TOWNS) {
    const x = Math.round(t.col - 0.5);
    const y = Math.round(t.row);
    if (t.castle) {
      rects += `<rect x="${x - 0.5}" y="${y - 0.6}" width="2" height="1.4" fill="#C8553D"/><rect x="${x - 0.5}" y="${y - 0.9}" width="0.4" height="0.4" fill="#C8553D"/><rect x="${x + 0.25}" y="${y - 0.9}" width="0.4" height="0.4" fill="#C8553D"/><rect x="${x + 1.1}" y="${y - 0.9}" width="0.4" height="0.4" fill="#C8553D"/><rect x="${x + 0.25}" y="${y - 0.2}" width="0.5" height="0.9" fill="#7A2E22"/>`;
    } else {
      rects += `<rect x="${x}" y="${y - 0.3}" width="1" height="0.9" fill="#E8E3D0"/><rect x="${x - 0.1}" y="${y - 0.65}" width="1.2" height="0.4" fill="#B8392E"/><rect x="${x + 0.35}" y="${y + 0.15}" width="0.3" height="0.45" fill="#6B3E26"/>`;
    }
  }
  return raw(
    `<svg class="tiles" viewBox="0 0 ${COLS} ${ROWS}" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`,
  );
}

const pctX = (col) => (((col + 0.5) / COLS) * 100).toFixed(3);
const pctY = (row) => ((row / ROWS) * 100).toFixed(3);
const at = (col, row, dx, dy) => `left:calc(${pctX(col)}% + ${dx}px);top:calc(${pctY(row)}% + ${dy}px)`;

export async function mapPage(view) {
  const data = await api('/people');
  const byTown = Object.fromEntries(TOWNS.map((t) => [t.key, []]));
  byTown.castelfranco.push({ me: true }); // you live in Castelfranco
  for (const p of data.people) byTown[townOf(p.city)].push(p);

  const placed = [];
  const overflow = [];
  for (const t of TOWNS) {
    byTown[t.key].forEach((p, i) => {
      if (i < SLOTS.length) placed.push({ p, t, slot: SLOTS[i] });
      else if (!p.me) overflow.push(p);
    });
  }

  mount(
    view,
    html`<div class="head"><h1>LA MAPPA</h1><div class="right small muted">tocca una persona</div></div>
      <div class="map world">
        ${tilesSvg()}
        <span class="label" style="left:2%;top:0.3%;font-size:7px;color:var(--soft)">VENETO</span>
        <span class="label" style="left:2%;top:${pctY(28.2)}%;font-size:7px;color:var(--soft)">VIỆT NAM</span>
        <span class="label river" style="${at(8.7, 12.5, 0, 0)}">Musone</span>
        ${TOWNS.map((t) => html`<span class="label town" style="${at(t.col, t.row, 0, -30)}">${t.name}</span>`)}
        ${placed.map(({ p, t, slot }) =>
          p.me
            ? html`<a class="chibi" href="#/profilo" style="${at(t.col, t.row, slot[0], slot[1] + 14)}" aria-label="Tu, vai al profilo">
                <span class="hearts" style="color:var(--gold)">★</span>${chibi('tu', '#F2C14E')}<span class="nm">TU</span>
              </a>`
            : html`<a class="chibi" href="#/persone?tab=${p.category}" style="${at(t.col, t.row, slot[0], slot[1] + 14)}" aria-label="${p.name}, ${p.city}, calore ${p.warmth.hearts} su 5">
                ${hearts(p.warmth)}${chibi(p.name, CATEGORY_COLOR[p.category])}<span class="nm">${p.name.length > 8 ? `${p.name.slice(0, 7)}…` : p.name}</span>
              </a>`,
        )}
      </div>
      <div class="wrap" style="margin-top:10px">
        ${data.people.length === 0 ? html`<div class="empty-state">La mappa è vuota: <a href="#/persona/new">aggiungi la prima persona</a>.</div>` : ''}
        ${overflow.length
          ? html`<div class="small soft">Non c’è più posto in paese per: ${overflow.map((p, i) => html`${i ? ', ' : ''}<a href="#/persone?tab=${p.category}">${p.name}</a>`)}</div>`
          : ''}
        <div class="row wrap-row tiny soft">
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#7FB3E6"></span>amici e parenti</span>
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#E58FB8"></span>famiglia</span>
          <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#C79BF2"></span>professionisti</span>
        </div>
        <div class="tiny soft"><span style="color:var(--heart)">♥</span> calore = outrovert + intimate + cuisine con quella persona negli ultimi 30 giorni; in famiglia ogni punto vale di più (×1,25), con amici e professionisti meno (×0,5) · <span style="color:var(--heart);opacity:.4">♥</span> svanisce entro 7 giorni</div>
        <div class="tiny muted">Il paese dipende dalla città nella scheda della persona: Asolo, Vallà, Castelfranco, Vedelago, Villarazzo, Breda di Piave, Stra, Hà Nội, Hải Phòng (altri posti in Vietnam → Hải Phòng, il resto → Castelfranco).</div>
      </div>`,
  );
}
