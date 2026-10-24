import { api, html, mount, raw, todayRome, fmtDate } from '../util.js';

export const AXES = [
  { key: 'outrovert', name: 'outrovert point', c: '#F28C6B' },
  { key: 'cuisine', name: 'cuisine point', c: '#F2C14E' },
  { key: 'intimate', name: 'intimate point', c: '#E58FB8' },
  { key: 'vulnerability', name: 'vulnerability point', c: '#7FB3E6' },
  { key: 'integration', name: 'integration point', c: '#8FD694' },
  { key: 'brightness', name: 'brightness point', c: '#C79BF2' },
  { key: 'be_seen', name: 'be seen point', c: '#FFE08A' },
  { key: 'rooted_italy', name: 'rooted Italy point', c: '#E07A5F' },
  { key: 'rooted_vietnam', name: 'rooted Vietnam point', c: '#4FC3B5' },
];

export function weatherWord(code) {
  if (code === null || code === undefined) return '—';
  if (code === 0) return 'sereno';
  if (code <= 3) return 'nuvoloso';
  if (code === 45 || code === 48) return 'nebbia';
  if (code >= 51 && code <= 67) return 'pioggia';
  if (code >= 71 && code <= 77) return 'neve';
  if (code >= 80 && code <= 82) return 'rovesci';
  if (code >= 95) return 'temporale';
  return 'variabile';
}

/** A small icebreaker based on the weather, in Italian. */
export function icebreaker(w) {
  if (!w || w.temp === null) return null;
  const word = weatherWord(w.code);
  if (word === 'pioggia' || word === 'rovesci' || word === 'temporale') return '«Con questo tempo ci vuole un caffè caldo, no?»';
  if (word === 'nebbia') return '«Che nebbia stamattina! Sei arrivata bene?»';
  if (word === 'neve') return '«Hai visto la neve? Ti piace o la odi?»';
  if (w.temp <= 8) return '«Che freddo oggi! Hai già acceso il riscaldamento?»';
  if (w.temp >= 28) return '«Che caldo! Come fai a resistere?»';
  if (word === 'sereno') return '«Che bella giornata! Hai programmi per il weekend?»';
  return '«Il tempo oggi è un po’ così… come va la settimana?»';
}

const NEWS_TABS = [
  ['mondo', 'MONDO'],
  ['vietnam', 'VIETNAM'],
  ['italia', 'ITALIA'],
  ['europa', 'EUROPA'],
  ['castelfranco', 'CASTELF.'],
];

export async function profilePage(view) {
  let city = 'castelfranco';
  let tab = 'vietnam';
  let news = null;
  let newsErr = false;
  let weather = null;
  const dash = await api('/dashboard');

  const loadNews = async () => {
    news = null;
    newsErr = false;
    draw();
    try {
      news = await api(`/news?tab=${tab}`);
    } catch {
      newsErr = true;
    }
    draw();
  };

  const draw = () => {
    const w = weather?.cities?.find((c) => c.key === city);
    const max = Math.max(10, ...AXES.map((a) => dash.axes[a.key] ?? 0));
    const cells = (v, c) => {
      const filled = Math.round((Math.max(0, v) / max) * 10);
      return raw(Array.from({ length: 10 }, (_, i) => `<span style="background:${i < filled ? c : ''}"></span>`).join(''));
    };
    const ib = icebreaker(w);
    mount(
      view,
      html`<div class="title">
          <div>
            <div class="logo">CASTELFRANCO<br>IL CUORE</div>
            <div class="muted small" style="margin-top:6px">${fmtDate(todayRome())}</div>
          </div>
          <div class="panel" style="padding:6px 8px;gap:2px;text-align:right">
            <span class="px muted" style="font-size:8px">${city === 'castelfranco' ? 'CASTELF.' : 'HẢI PHÒNG'}</span>
            <span style="font-size:24px;line-height:1">${w && w.temp !== null ? `${Math.round(w.temp)}°C` : '--°C'}</span>
            <span class="tiny muted">${w ? weatherWord(w.code) : ''}</span>
          </div>
        </div>
        <div class="wrap">
          <div class="tabs px-tabs" role="group" aria-label="Città">
            <button type="button" data-city="castelfranco" aria-pressed="${city === 'castelfranco'}">CASTELFRANCO</button>
            <button type="button" data-city="haiphong" aria-pressed="${city === 'haiphong'}">HẢI PHÒNG</button>
          </div>
          ${ib ? html`<div class="small soft">Rompighiaccio: ${ib}</div>` : ''}

          <div class="panel hero">
            <div class="row between"><h2>I MIEI PUNTI</h2><span class="tiny muted">${dash.events} eventi</span></div>
            ${AXES.map(
              (a) => html`<div style="display:flex;flex-direction:column;gap:3px">
                <div class="row between" style="font-size:19px"><span style="color:${a.c}">${a.name}</span><span>${dash.axes[a.key] ?? 0}</span></div>
                <div class="bar">${cells(dash.axes[a.key] ?? 0, a.c)}</div>
              </div>`,
            )}
          </div>

          <h2 class="section-label">OBIETTIVI DI VITA</h2>
          <div class="panel" style="border-color:#8FD694">
            <span class="px" style="font-size:9px;color:#8FD694">CITTADINANZA</span>
            <span class="small soft">integration ${dash.axes.integration ?? 0} + rooted Italy ${dash.axes.rooted_italy ?? 0} = ${(dash.axes.integration ?? 0) + (dash.axes.rooted_italy ?? 0)}</span>
          </div>
          <div class="panel" style="border-color:#F2C14E">
            <span class="px" style="font-size:9px;color:#F2C14E">RICONOSCIMENTO</span>
            <span class="small soft">cuisine ${dash.axes.cuisine ?? 0} + be seen ${dash.axes.be_seen ?? 0} = ${(dash.axes.cuisine ?? 0) + (dash.axes.be_seen ?? 0)}</span>
          </div>

          <div class="grid2">
            <a class="panel" href="#/igiene" style="text-decoration:none;color:var(--ink);border-color:#7FB3E6">
              <span class="px" style="font-size:8px;color:#7FB3E6">IGIENE</span>
              <span class="small">oggi ${dash.hygiene.done} / ${dash.hygiene.target}</span>
            </a>
            <a class="panel" href="#/faccende" style="text-decoration:none;color:var(--ink);border-color:#8FD694">
              <span class="px" style="font-size:8px;color:#8FD694">FACCENDE</span>
              <span class="small">settimana ${dash.chores.done} / ${dash.chores.target}</span>
            </a>
            <a class="panel" href="#/collezione" style="text-decoration:none;color:var(--ink)">
              <span class="px gold" style="font-size:8px">COLLEZIONE</span>
              <span class="small muted">le tue idee</span>
            </a>
            <a class="panel" href="#/diario" style="text-decoration:none;color:var(--ink)">
              <span class="px gold" style="font-size:8px">DIARIO</span>
              <span class="small muted">tutti gli eventi</span>
            </a>
          </div>

          <h2 class="section-label">NOTIZIE</h2>
          <div class="tabs px-tabs" role="group" aria-label="Notizie">
            ${NEWS_TABS.map(([k, l]) => html`<button type="button" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`)}
          </div>
          <div class="panel news">
            ${newsErr
              ? html`<div class="empty-state">Notizie non disponibili ora.</div>`
              : !news
                ? html`<div class="empty-state">Carico…</div>`
                : news.items.length === 0
                  ? html`<div class="empty-state">Nessuna notizia.</div>`
                  : news.items.map(
                      (n) => html`<div style="display:flex;flex-direction:column;gap:2px;padding-bottom:6px;border-bottom:2px solid var(--line)">
                        ${n.link ? html`<a href="${n.link}" target="_blank" rel="noopener noreferrer">${n.title}</a>` : html`<span>${n.title}</span>`}
                        <span class="tiny muted">${n.source}</span>
                      </div>`,
                    )}
          </div>

          <div class="panel callout" style="border-color:#C79BF2">
            <h2 style="color:#C79BF2">CICLO CON CLAUDE</h2>
            <span class="small soft">${dash.unscored} eventi da valutare.</span>
            <a class="btn violet" href="#/claude">APRI</a>
          </div>

          <button class="btn ghost" type="button" data-logout>esci</button>
        </div>`,
    );
  };

  view.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-city]');
    if (c) {
      city = c.dataset.city;
      draw();
      return;
    }
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      loadNews();
      return;
    }
    if (e.target.closest('[data-logout]')) {
      await api('/auth/logout', { method: 'POST', body: {} });
      location.reload();
    }
  });

  draw();
  api('/weather')
    .then((w) => {
      weather = w;
      draw();
    })
    .catch(() => {});
  loadNews();
}
