import { MODULE_ID, isEnemyToken, isRevealed } from './data.js';

const FLAG = 'revealed';

/**
 * GM-only "Reveal Quick Info" toggle on the Token HUD — the manual
 * per-target control described in this module's README: a player calls a
 * Perception check (or whatever the table uses) against a specific target,
 * the GM judges the result themselves (see hud.js's isVisibleFor() comment
 * for why this module doesn't try to auto-resolve that from the roll), and
 * clicks this to flip that one token's `revealed` flag. Every connected
 * client (not just the GM) can then hover it and see the card, independent
 * of whether the table-wide enable()/disable() switch is on.
 *
 * Only injected for tokens hud.js would ever show a card for in the first
 * place (same isEnemyToken() filter) — otherwise it'd be a dead no-op
 * button on every Friendly token's HUD.
 */
export function registerRevealToggle() {
  Hooks.on('renderTokenHUD', (app, html) => {
    if (!game.user.isGM) return;

    const token = app.object;
    if (!isEnemyToken(token)) return;

    const root = html.jquery ? html[0] : html;
    if (!root) return;

    const icon = document.createElement('div');
    icon.className = 'control-icon cpr-quick-info-reveal';
    icon.classList.toggle('active', isRevealed(token));
    icon.dataset.tooltip = 'Reveal Quick Info for this token';
    icon.innerHTML = '<i class="fa-solid fa-eye"></i>';
    icon.addEventListener('click', () => {
      token.document.setFlag(MODULE_ID, FLAG, !isRevealed(token));
      icon.classList.toggle('active');
    });

    const targetCol = root.querySelector('.col.right') ?? root.querySelector('.col.left') ?? root;
    targetCol.appendChild(icon);
  });
}
