import { api, toast } from './util.js';
import { sfx, soundOn, setSound } from './sound.js';
import { authPage } from './pages/auth.js';
import { profilePage } from './pages/profile.js';
import { mapPage } from './pages/map.js';
import { peoplePage, personFormPage } from './pages/people.js';
import { eventPage, diaryPage } from './pages/events.js';
import { claudePage } from './pages/claude.js';
import { collectionPage } from './pages/collection.js';
import { hygienePage, choresPage } from './pages/goals.js';
import { servicesPage } from './pages/services.js';

const ROUTES = {
  accedi: authPage,
  profilo: profilePage,
  mappa: mapPage,
  persone: peoplePage,
  persona: personFormPage,
  evento: eventPage,
  diario: diaryPage,
  eventi: diaryPage,
  claude: claudePage,
  collezione: collectionPage,
  igiene: hygienePage,
  faccende: choresPage,
  servizi: servicesPage,
};

let me = null;

async function route() {
  const [name = 'profilo', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const page = ROUTES[name.split('?')[0]] ?? profilePage;
  const nav = document.getElementById('nav');
  if (page !== authPage && !me) {
    location.hash = '#/accedi';
    return;
  }
  nav.hidden = page === authPage;
  for (const a of nav.querySelectorAll('a')) {
    if (a.dataset.nav === name.split('?')[0]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const main = document.getElementById('main');
  const view = document.createElement('div');
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await page(view, { arg: rest[0]?.split('?')[0], params, onLogin: start });
  } catch (err) {
    if (err?.status !== 401) {
      console.error(err);
      toast(err.message ?? 'Errore.', true);
    }
  }
}

async function start() {
  try {
    const r = await api('/auth/me');
    me = r.user;
  } catch {
    me = null;
  }
  if (!me && !location.hash.startsWith('#/accedi')) location.hash = '#/accedi';
  else if (me && (location.hash === '' || location.hash.startsWith('#/accedi'))) location.hash = '#/profilo';
  else route();
}

// ---------- sound ----------
const SPEAKER = (on) =>
  `<svg width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 4h2v2H1zM3 3h1v4H3zM4 2h1v6H4z"/>${
    on ? '<path fill="currentColor" d="M6 4h1v2H6zM8 3h1v4H8z"/>' : '<path fill="currentColor" d="M6 3h1v1H6zM8 3h1v1H8zM7 4h1v2H7zM6 6h1v1H6zM8 6h1v1H8z"/>'
  }</svg>`;
const soundBtn = document.getElementById('sound-toggle');
function paintSound() {
  soundBtn.innerHTML = SPEAKER(soundOn());
  soundBtn.setAttribute('aria-pressed', String(soundOn()));
  soundBtn.title = soundOn() ? 'Suoni attivi' : 'Suoni spenti';
}
soundBtn.addEventListener('click', () => {
  setSound(!soundOn());
  paintSound();
});
paintSound();

// A soft tick for every button and link; the bottom bar gets its own two-note blip.
document.addEventListener(
  'click',
  (e) => {
    const el = e.target.closest('button, a, [role="button"], summary');
    if (!el || el === soundBtn || el.disabled) return;
    sfx(el.closest('#nav') ? 'nav' : 'blip');
  },
  true,
);

window.addEventListener('hashchange', route);
start();
