import { api, html, mount, toast, todayRome, addDays, diffDays, monthName, shiftMonth, fmtDate } from '../util.js';

function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  return { n, firstDow, days: Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`) };
}

const inPeriod = (d, p) => diffDays(d, p.start) >= 0 && diffDays(d, p.end) <= 0;

function pips(cur, cls = '') {
  if (!cur) return '';
  const cells = [];
  for (let i = 0; i < cur.target; i++) {
    const on = i < cur.done;
    const carry = i >= cur.base;
    cells.push(html`<span class="${on ? 'on' : ''} ${carry ? 'carry' : ''}"></span>`);
  }
  const extra = cur.done > cur.target ? html`<span class="small muted" style="width:auto;border:0">+${cur.done - cur.target}</span>` : '';
  return html`<div class="pips ${cls}" aria-label="${cur.done} su ${cur.target}">${cells}${extra}</div>`;
}

function monthNav(month) {
  const current = todayRome().slice(0, 7);
  return html`<div class="row between">
    <button type="button" class="btn small-btn" data-month="${shiftMonth(month, -1)}" aria-label="Mese precedente">&lt;</button>
    <span class="px gold" style="font-size:9px">${monthName(month).toUpperCase()}</span>
    <button type="button" class="btn small-btn" data-month="${shiftMonth(month, 1)}" aria-label="Mese successivo" ${month >= current ? 'disabled' : ''}>&gt;</button>
  </div>`;
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

// ---------------- hygiene ----------------

export async function hygienePage(view) {
  let month = todayRome().slice(0, 7);
  let data = await api(`/hygiene?month=${month}`);
  const reload = async () => {
    data = await api(`/hygiene?month=${month}`);
    draw();
  };

  const note = (key, cur) => {
    if (!cur) return '';
    if (cur.done >= cur.target) return html`<span class="small" style="color:var(--green)">obiettivo fatto ✓</span>`;
    const parts = [];
    if (cur.carry > 0) parts.push(html`<span class="gold">+${cur.carry} riportat${cur.carry === 1 ? 'o' : 'i'} dal periodo prima</span>`);
    if (key === 'capelli') parts.push(html`<span class="muted">${cur.end === data.today ? 'scade oggi' : 'scade domani'}</span>`);
    else parts.push(html`<span class="muted">mancano ${cur.target - cur.done}</span>`);
    return html`<span class="small">${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}</span>`;
  };

  const draw = () => {
    const g = data.goals;
    const { firstDow, days } = monthDays(month);
    const status = (d) => {
      if (diffDays(d, data.today) > 0 || diffDays(d, data.trackingStart) < 0) return '';
      let all = true;
      let any = false;
      for (const k of Object.keys(g)) {
        const p = g[k].periods.find((x) => inPeriod(d, x));
        if (!p || p.done < p.target) all = false;
        if ((g[k].days[d] ?? 0) > 0) any = true;
      }
      return all ? 'full' : any ? 'part' : '';
    };
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1 style="color:var(--blue)">IGIENE</h1>
          <div class="right small muted">oggi · ${fmtDate(data.today)}</div>
        </div>
        <div class="wrap">
          ${Object.entries(g).map(
            ([k, h]) => html`<div class="panel" style="flex-direction:row;align-items:center;gap:10px">
              <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
                <div class="row"><span class="px" style="font-size:9px">${h.label.toUpperCase()}</span><span class="small muted">${h.rule}</span></div>
                ${pips(h.current)}
                ${note(k, h.current)}
              </div>
              <button type="button" class="btn small-btn" data-undo="${k}" aria-label="Togli uno: ${h.label}">−</button>
              <button type="button" class="btn blue square" data-add="${k}" aria-label="Aggiungi: ${h.label}">+1</button>
            </div>`,
          )}

          <div class="panel">
            ${monthNav(month)}
            <div class="cal">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((x) => html`<span class="hd">${x}</span>`)}</div>
            <div class="cal">
              ${Array.from({ length: firstDow }, () => html`<span class="d blank"></span>`)}
              ${days.map((d) => html`<span class="d ${status(d)} ${d === data.today ? 'today' : ''}">${Number(d.slice(8))}</span>`)}
            </div>
            <div class="row wrap-row tiny soft">
              <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:var(--blue)"></span>tutto fatto</span>
              <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:#3E5C80"></span>parziale</span>
            </div>
          </div>

          <div class="panel">
            <h2>ADERENZA DEL MESE</h2>
            ${Object.values(g).map(
              (h) => html`<div style="display:grid;grid-template-columns:80px minmax(0,1fr) 48px;gap:8px;align-items:center;font-size:18px">
                <span>${h.label}</span>
                <div style="height:12px;background:var(--line);position:relative"><div style="position:absolute;inset:0 auto 0 0;width:${Math.round((h.adherence ?? 0) * 100)}%;background:var(--blue)"></div></div>
                <span class="muted">${pct(h.adherence)}</span>
              </div>`,
            )}
            <span class="tiny muted">Quello che non fai passa al giorno dopo (al massimo un giorno in più).</span>
          </div>
        </div>`,
    );
  };

  view.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-add]');
    const u = e.target.closest('[data-undo]');
    const m = e.target.closest('[data-month]');
    try {
      if (a) {
        await api('/hygiene', { method: 'POST', body: { habit: a.dataset.add } });
        month = todayRome().slice(0, 7);
        await reload();
      } else if (u) {
        await api('/hygiene/undo', { method: 'POST', body: { habit: u.dataset.undo } });
        await reload();
      } else if (m && !m.disabled) {
        month = m.dataset.month;
        await reload();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  draw();
}

// ---------------- chores ----------------

export async function choresPage(view) {
  let month = todayRome().slice(0, 7);
  let data = await api(`/chores?month=${month}`);
  const reload = async () => {
    data = await api(`/chores?month=${month}`);
    draw();
  };

  const draw = () => {
    const g = data.goals;
    const anyGoal = Object.values(g)[0];
    const cur = anyGoal?.current;
    const weekDays = cur ? Array.from({ length: 7 }, (_, i) => addDays(cur.start, i)) : [];
    const periods = anyGoal?.periods ?? [];
    let got = 0;
    let need = 0;
    for (const c of Object.values(g))
      for (const p of c.periods)
        if ((p.status === 'met' || p.status === 'missed') && p.end.slice(0, 7) === month) {
          got += Math.min(p.done, p.target);
          need += p.target;
        }
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1 style="color:var(--green)">FACCENDE</h1>
          <div class="right small muted">${cur ? `settimana ${Number(cur.start.slice(8))}–${fmtDate(cur.end).split(' ').slice(1).join(' ')}` : ''}</div>
        </div>
        <div class="wrap">
          ${Object.entries(g).map(([k, c]) => {
            const p = c.current;
            const done = p && p.done >= p.target;
            return html`<div class="panel" style="flex-direction:row;align-items:center;gap:10px">
              <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
                <div class="row"><span class="px" style="font-size:9px">${c.label.toUpperCase()}</span><span class="small muted">1 a settimana</span></div>
                <div class="row" style="gap:3px">
                  ${weekDays.map(
                    (d, i) => html`<span style="width:26px;height:20px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid ${d === data.today ? 'var(--gold)' : 'var(--line)'};${(c.days[d] ?? 0) > 0 ? 'background:var(--green);color:var(--bg)' : 'color:var(--muted)'}">${['L', 'M', 'M', 'G', 'V', 'S', 'D'][i]}</span>`,
                  )}
                </div>
                ${p ? pips(p, 'green') : ''}
                <span class="small ${done ? '' : p?.carry ? 'gold' : 'muted'}" style="${done ? 'color:var(--green)' : ''}">${
                  done ? 'fatto questa settimana ✓' : p?.carry ? `×${p.target} questa settimana: ${p.carry} riportata` : 'da fare entro domenica'
                }</span>
              </div>
              <button type="button" class="btn small-btn" data-undo="${k}" aria-label="Annulla: ${c.label}">−</button>
              <button type="button" class="btn green square" data-add="${k}" aria-label="Fatto: ${c.label}">FATTO</button>
            </div>`;
          })}

          <div class="panel">
            ${monthNav(month)}
            <span class="tiny muted">settimane con l’obiettivo raggiunto</span>
            <div class="weeks" style="--n:${periods.length || 1}">
              <span></span>${periods.map((p) => html`<span class="h">${Number(p.start.slice(8))}/${Number(p.start.slice(5, 7))}</span>`)}
              ${Object.values(g).map(
                (c) => html`<span>${c.label.replace(/^(Passo|Annaffio|Pulisco) (la |il |le )?/, '')}</span>${c.periods.map(
                  (p) => html`<span class="c ${p.status}" title="${p.done}/${p.target} · ${p.status}"></span>`,
                )}`,
              )}
            </div>
            <div class="row wrap-row tiny soft">
              <span class="row" style="gap:4px"><span style="width:12px;height:12px;background:var(--green)"></span>fatto</span>
              <span class="row" style="gap:4px"><span style="width:12px;height:12px;border:2px solid #B8392E"></span>mancato</span>
              <span class="row" style="gap:4px"><span style="width:12px;height:12px;border:2px solid var(--gold)"></span>in corso</span>
            </div>
            <div class="small soft">Totale del mese: ${need ? `${Math.round((got / need) * 100)}%` : '—'} dell’obiettivo</div>
            <span class="tiny muted">Se salti una settimana, la faccenda passa alla settimana dopo (×2).</span>
          </div>
        </div>`,
    );
  };

  view.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-add]');
    const u = e.target.closest('[data-undo]');
    const m = e.target.closest('[data-month]');
    try {
      if (a) {
        await api('/chores', { method: 'POST', body: { chore: a.dataset.add } });
        month = todayRome().slice(0, 7);
        await reload();
        toast('Fatto! ✓');
      } else if (u) {
        await api('/chores/undo', { method: 'POST', body: { chore: u.dataset.undo } });
        await reload();
      } else if (m && !m.disabled) {
        month = m.dataset.month;
        await reload();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  draw();
}
