import { api, html, mount, toast, confirmBox } from '../util.js';

/** Which outside services the server talks to, their terms, and whether any is paused or blocking us. */
export async function servicesPage(view) {
  let data = await api('/services');

  const when = (iso) =>
    new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const status = (s) => {
    if (s.status === 'stopped') return html`<span class="err-text">you are blocked — fermato</span>`;
    if (s.status === 'blocked') return html`<span class="err-text">you are blocked — in pausa</span>`;
    if (s.status === 'paused') return html`<span class="gold">in pausa</span>`;
    return html`<span style="color:var(--green)">ok</span>`;
  };
  const notice = (s) => {
    if (s.status === 'stopped') return 'you are blocked: non lo chiamo più finché non premi RIPROVA.';
    if (s.status === 'blocked') return `you are blocked: riprovo dopo ${when(s.until)}.`;
    if (s.status === 'paused') return `In pausa fino a ${when(s.until)} (${s.reason}).`;
    return '';
  };

  const draw = () =>
    mount(
      view,
      html`<div class="head">
          <a class="back" href="#/profilo" aria-label="Indietro">&lt;</a>
          <h1>SERVIZI ESTERNI</h1>
        </div>
        <div class="wrap">
          <div class="panel">
            <h2>PRIVACY</h2>
            <span class="small soft">Il tuo browser non contatta mai questi servizi: li chiama solo il server dell’app, quindi il tuo indirizzo IP resta privato. Anche i caratteri sono ospitati qui, niente Google Fonts.</span>
            <span class="small soft">Nessuna chiamata quando l’app non è aperta: il meteo si aggiorna solo mentre il profilo è aperto e visibile, le notizie quando le guardi.</span>
            <span class="small soft">Le risposte restano in archivio fino alla scadenza indicata dal servizio (Expires); dopo, il server chiede solo se è cambiato qualcosa (If-Modified-Since / ETag).</span>
          </div>

          ${data.services.map(
            (s) => html`<div class="panel">
              <div class="row between"><span class="px" style="font-size:9px">${s.name.toUpperCase()}</span>${status(s)}</div>
              <span class="small soft">${s.purpose}</span>
              ${s.credit ? html`<span class="tiny muted">${s.credit}</span>` : ''}
              ${s.status !== 'ok' ? html`<span class="err-text small">${notice(s)}</span>` : ''}
              <div class="row">
                <a class="small" href="${s.terms}" target="_blank" rel="noopener noreferrer">termini d’uso</a>
                ${s.status !== 'ok' ? html`<button type="button" class="btn small-btn" style="margin-left:auto" data-reset="${s.id}" data-name="${s.name}">RIPROVA</button>` : ''}
              </div>
            </div>`,
          )}

          <div class="panel">
            <h2>QUANDO UN SERVIZIO NON RISPONDE</h2>
            <span class="small soft">· Quota giornaliera esaurita: pausa fino a poco dopo la mezzanotte UTC.</span>
            <span class="small soft">· Il servizio dice quando tornare (Retry-After): aspetto quel tempo, al massimo un giorno.</span>
            <span class="small soft">· 403 “you are blocked”: pausa di un’ora; se ancora bloccato, un giorno; poi non lo chiamo più finché non premi RIPROVA.</span>
            <span class="small soft">· Errori del server, timeout, rete: pausa di 1, 2, 4… fino a 60 minuti.</span>
            <span class="small soft">· Una richiesta sbagliata per un solo indirizzo (400/404) non mette in pausa il servizio.</span>
          </div>
          <div class="panel">
            <h2>CLAUDE</h2>
            <span class="small soft">L’API di Claude riceve il testo di un evento solo quando lo salvi (gli eventi privati solo se li invii tu), al massimo 60 volte all’ora.</span>
          </div>
        </div>`,
    );

  view.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-reset]');
    if (!r) return;
    if (!(await confirmBox(`Riprovare ${r.dataset.name} adesso? Se ti blocca ancora, la pausa riparte da capo.`, 'RIPROVA'))) return;
    try {
      await api(`/services/${r.dataset.reset}/reset`, { method: 'POST', body: {} });
      data = await api('/services');
      draw();
      toast('Pausa tolta: verrà richiamato alla prossima richiesta.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  draw();
}
