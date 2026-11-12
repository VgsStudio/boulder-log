// Estatísticas de uso (PostHog, região EU): eventos, gravação de sessões mascarada, mapa de calor e erros.
// Carrega depois que o app abriu (não atrasa a primeira tela). Quem desligar em Ajustes não é medido.
// Privacidade: identifica só pelo id interno da conta (nunca e-mail); campos, fotos e nomes de pessoas
// aparecem mascarados nas gravações.

const KEY = 'phc_odEUPkJewhLwRpX4AvNC7LHvWNBAMySBdnEr5V4eKPjZ'; // chave pública do projeto (feita para ir no app)
const HOST = 'https://eu.i.posthog.com';
const OFF = 'cm:noStats';

let ph = null;
const queue = [];
export const statsOn = () => { try { return localStorage.getItem(OFF) !== '1'; } catch { return true; } };

/** Registra um evento (fica na fila até o PostHog carregar). */
export function track(event, props) {
  if (!statsOn()) return;
  if (ph) ph.capture(event, props); else if (queue.length < 50) queue.push([event, props]);
}
/** Erro tratado pelo app (os não tratados o PostHog pega sozinho). */
export function trackError(err) {
  if (ph && statsOn() && err instanceof Error) ph.captureException(err);
}

export async function startAnalytics({ userId, guest }) {
  // No computador de teste (localhost) não mede, para não sujar os números.
  if (!statsOn() || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const { default: posthog } = await import('posthog-js/dist/module.full'); // gravação e erros já inclusos (sem baixar scripts de fora)
  posthog.init(KEY, {
    api_host: HOST,
    ui_host: 'https://eu.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // rotas por hash: o app manda a visita a cada troca de tela
    capture_pageleave: true,
    autocapture: true,
    enable_heatmaps: true,
    capture_exceptions: true,
    disable_surveys: true,
    disable_web_experiments: true,
    session_recording: {
      maskAllInputs: true,
      // Nomes e @ de outras pessoas, e textos livres, não aparecem nas gravações.
      maskTextSelector: '.person-row, .profile-head, .feed-head, .rank, .suggest, .friends-card, .auth-info, .pinned-head + *',
      // Fotos (parede, perfil) não são gravadas.
      blockSelector: 'img, canvas, .avatar',
    },
  });
  if (userId) posthog.identify(userId);
  posthog.register({ app_lang: document.documentElement.lang, guest: !!guest, installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true });
  ph = posthog;
  queue.splice(0).forEach(([e, p]) => posthog.capture(e, p));
}

/** Liga/desliga em Ajustes. */
export function setStats(on) {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, '1'); } catch {}
  if (ph) { if (on) ph.opt_in_capturing(); else ph.opt_out_capturing(); }
}

/** Troca de tela: manda a visita com o nome da rota (sem ids no nome, para agrupar). */
export function pageview(route) {
  track('$pageview', { $current_url: location.href, screen: route });
}
