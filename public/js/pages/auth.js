import { api, html, mount } from '../util.js';

export async function authPage(view, { onLogin }) {
  let mode = 'login';
  let error = '';

  const draw = () =>
    mount(
      view,
      html`<div class="auth">
        <div class="px gold" style="font-size:14px;line-height:1.6">CASTELFRANCO<br>IL CUORE</div>
        <div class="muted">Diario geo-sociale privato.</div>
        <div class="tabs px-tabs" role="group" aria-label="Accesso">
          <button type="button" data-mode="login" aria-pressed="${mode === 'login'}">ACCEDI</button>
          <button type="button" data-mode="signup" aria-pressed="${mode === 'signup'}">CREA ACCOUNT</button>
        </div>
        <form class="panel hero" id="f" autocomplete="on">
          ${mode === 'signup'
            ? html`<label class="field"><span>CODICE D'INVITO</span><input type="text" name="invite" required autocomplete="off" spellcheck="false"></label>`
            : ''}
          <label class="field"><span>NOME UTENTE</span><input type="text" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
          <label class="field"><span>PASSWORD</span><input type="password" name="password" required minlength="${mode === 'signup' ? 10 : 1}" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
          ${mode === 'signup' ? html`<div class="tiny muted">Almeno 10 caratteri. Il codice d'invito vale una sola volta.</div>` : ''}
          ${error ? html`<div class="err-text" role="alert">${error}</div>` : ''}
          <button class="btn gold big" type="submit">${mode === 'signup' ? 'CREA ACCOUNT' : 'ENTRA'}</button>
        </form>
      </div>`,
    );

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    error = '';
    draw();
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(mode === 'signup' ? '/auth/signup' : '/auth/login', { method: 'POST', body });
      await onLogin();
    } catch (err) {
      error = err.message;
      draw();
    }
  });

  draw();
}
