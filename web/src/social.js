// Ponte temporária: avatar e botão de seguir em DOM para a tela de boulder (ainda não migrada).
import { t } from './i18n.js';
import { h } from './core.js';
import { HOLD_COLORS } from './game.js';
import { initials, toggleFollow } from './ui/social.jsx';

export function avatar(p, size = 40) {
  if (p?.avatarUrl) return h('img', { class: 'avatar', src: p.avatarUrl, alt: '', width: size, height: size, loading: 'lazy', style: { '--s': `${size}px` } });
  const hue = [...(p?.handle ?? '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HOLD_COLORS.length;
  return h('span', { class: 'avatar', style: { '--s': `${size}px`, background: HOLD_COLORS[hue] } }, initials(p?.name));
}

export function followButton(p, onChange) {
  const label = () => (p.following ? t('follow.following') : p.followsMe ? t('follow.back') : t('follow.follow'));
  const btn = h('button', { class: `btn small-btn ${p.following ? '' : 'primary'}`, type: 'button' }, label());
  const paint = () => { btn.textContent = label(); btn.classList.toggle('primary', !p.following); };
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const run = toggleFollow(p);
    paint();
    if (await run) { paint(); onChange?.(p); }
  });
  return btn;
}
