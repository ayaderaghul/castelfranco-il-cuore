import { api, toast } from './util.js';
import { authPage } from './pages/auth.js';
import { profilePage } from './pages/profile.js';
import { mapPage } from './pages/map.js';
import { peoplePage, personFormPage } from './pages/people.js';
import { eventPage, diaryPage } from './pages/events.js';
import { claudePage } from './pages/claude.js';
import { collectionPage } from './pages/collection.js';
import { hygienePage, choresPage } from './pages/goals.js';

const ROUTES = {
  accedi: authPage,
  profilo: profilePage,
  mappa: mapPage,
  persone: peoplePage,
  persona: personFormPage,
  evento: eventPage,
  diario: diaryPage,
  claude: claudePage,
  collezione: collectionPage,
  igiene: hygienePage,
  faccende: choresPage,
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

window.addEventListener('hashchange', route);
start();
