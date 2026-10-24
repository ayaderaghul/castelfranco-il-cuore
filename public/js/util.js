// Small helpers shared by every page: safe HTML templating, API calls, toast, modal, dates.

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** Tagged template: every interpolated value is escaped unless wrapped in raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return raw(out);
}

export function mount(el, tpl) {
  el.innerHTML = tpl.s;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'X-Cuore': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    location.hash = '#/accedi';
    throw new ApiError(401, 'Devi accedere.');
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Qualcosa è andato storto.');
  return data;
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2600);
}

/**
 * Opens a modal. `build(dialog)` renders content; resolves with whatever
 * the content passes to `close(value)`, or null if dismissed.
 */
export function modal(tpl, bind) {
  const d = document.getElementById('modal');
  return new Promise((resolve) => {
    let done = false;
    const close = (v = null) => {
      if (done) return;
      done = true;
      d.close();
      resolve(v);
    };
    // Fresh inner node each time, so listeners from earlier modals don't pile up.
    const inner = document.createElement('div');
    mount(inner, tpl);
    d.replaceChildren(inner);
    d.onclose = () => close(null);
    d.onclick = (e) => {
      if (e.target === d) {
        // Only a click outside the box (on the backdrop) dismisses.
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(null);
      }
      if (e.target.closest('[data-close]')) close(null);
    };
    bind?.(inner, close);
    d.showModal();
    inner.querySelector('[autofocus]')?.focus();
  });
}

export function confirmBox(text, okLabel = 'SÌ') {
  return modal(
    html`<h2>${text}</h2><div class="row"><button class="btn" data-close>ANNULLA</button><button class="btn gold" data-ok>${okLabel}</button></div>`,
    (d, close) => d.querySelector('[data-ok]').addEventListener('click', () => close(true)),
  );
}

// ---------- dates ----------
const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayRome = () => romeFmt.format(new Date());
const toUtc = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};
export const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / 86400000);
export const addDays = (d, n) => new Date(toUtc(d) + n * 86400000).toISOString().slice(0, 10);

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DOW = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export function fmtDate(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `${DOW[dow]} ${dd} ${MONTHS[m - 1]}`;
}
export const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${y}`;
};
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "oggi", "ieri", "~3 giorni fa" … from a date; approx adds a tilde. */
export function relative(date, approx = false) {
  const n = diffDays(todayRome(), date);
  const t = approx ? '~' : '';
  if (n <= 0) return 'oggi';
  if (n === 1) return 'ieri';
  if (n < 7) return `${t}${n} giorni fa`;
  if (n < 30) return `${t}${Math.round(n / 7)} sett. fa`;
  if (n < 365) return `${t}${Math.round(n / 30)} mesi fa`;
  return `${t}${Math.round(n / 365)} anni fa`;
}

export function hearts(w) {
  if (!w) return '';
  const full = Math.max(0, w.hearts - w.fading);
  return html`<span class="hearts" aria-label="calore ${w.hearts} su 5">${'♥'.repeat(full)}<span class="fade">${'♥'.repeat(w.fading)}</span><span class="empty">${'♥'.repeat(5 - w.hearts)}</span></span>`;
}

export function expiryText(w) {
  if (!w || !w.hearts || !w.expiresOn) return 'nessun cuore attivo';
  const n = diffDays(w.expiresOn, todayRome());
  if (n <= 0) return 'svaniscono oggi';
  return `il primo svanisce ${n === 1 ? 'domani' : `tra ${n} giorni`}`;
}

export function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
