import { MODULE_ID, isEnemyToken, buildQuickInfo } from './data.js';
import { getTokenScreenBox } from './geometry.js';

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/quick-info.hbs`;
const GAP_PX = 10;

let cardEl = null;
let currentTokenId = null;

// Off by default — this module has no toggle of its own. It's meant to be
// switched on by something else (cpr-twins-ai's Rogue AI Vision mode, a
// macro, whatever) via the enable()/disable() API set on
// game.modules.get('cpr-quick-info').api in main.js, and stay dark
// otherwise rather than showing on every table by default.
let enabled = false;

export function isEnabled() {
  return enabled;
}

export function setEnabled(value) {
  enabled = !!value;
  // Flipping off mid-hover shouldn't leave a stranded card up until the
  // mouse happens to leave the token.
  if (!enabled) remove();
}

async function show(token) {
  const model = buildQuickInfo(token);
  const html = await renderTemplate(TEMPLATE_PATH, model);

  remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  cardEl = wrapper.firstElementChild;
  document.body.appendChild(cardEl);
  currentTokenId = token.id;
  position(token);
}

function remove() {
  cardEl?.remove();
  cardEl = null;
  currentTokenId = null;
}

/**
 * Anchors the card to the token's right edge, vertically centered, then
 * clamps to the viewport so it doesn't run off-screen for a token hovered
 * near a canvas edge — flips to the left side rather than just clamping X,
 * since clamping alone would slide the card on top of the token itself.
 */
function position(token) {
  if (!cardEl) return;
  const box = getTokenScreenBox(token);
  const cardWidth = cardEl.offsetWidth;
  const cardHeight = cardEl.offsetHeight;

  let left = box.left + box.width + GAP_PX;
  if (left + cardWidth > window.innerWidth) {
    left = box.left - cardWidth - GAP_PX;
  }
  left = Math.max(GAP_PX, Math.min(left, window.innerWidth - cardWidth - GAP_PX));

  let top = box.top + box.height / 2 - cardHeight / 2;
  top = Math.max(GAP_PX, Math.min(top, window.innerHeight - cardHeight - GAP_PX));

  cardEl.style.left = `${left}px`;
  cardEl.style.top = `${top}px`;
}

function repositionCurrent() {
  if (!cardEl || !currentTokenId) return;
  const token = canvas.tokens?.get(currentTokenId);
  if (token) position(token);
  else remove();
}

export function registerQuickInfoHud() {
  Hooks.on('hoverToken', (token, hovered) => {
    if (!hovered) {
      if (token.id === currentTokenId) remove();
      return;
    }
    if (!enabled) return;
    if (!isEnemyToken(token)) return;
    show(token);
  });

  // Token moved (e.g. dragged by the GM) while its card is showing.
  Hooks.on('updateToken', (doc) => {
    if (doc.id === currentTokenId) repositionCurrent();
  });

  // Canvas zoom/pan while a card is showing.
  Hooks.on('canvasPan', repositionCurrent);

  // Scene change or token removal invalidates whatever's currently anchored.
  Hooks.on('canvasReady', remove);
  Hooks.on('deleteToken', (doc) => {
    if (doc.id === currentTokenId) remove();
  });
}
