import { MODULE_ID, isEnemyToken, isRevealed, buildQuickInfo } from './data.js';
import { getTokenScreenBox } from './geometry.js';

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/quick-info.hbs`;
const GAP_PX = 10;

let cardEl = null;
let hoveredTokenId = null;

// Off by default — this module has no toggle of its own. It's meant to be
// switched on by something else (cpr-twins-ai's Rogue AI Vision mode, a
// macro, whatever) via the enable()/disable() API set on
// game.modules.get('cpr-quick-info').api in main.js, and stay dark
// otherwise rather than showing on every table by default. This is the
// table-wide gate; a specific token can also earn visibility on its own
// via isRevealed() (see token-hud.js's GM-only per-token toggle) regardless
// of this switch — see isVisibleFor() below for how the two combine.
let enabled = false;

export function isEnabled() {
  return enabled;
}

export function setEnabled(value) {
  enabled = !!value;
  refreshHovered();
}

// A token is showable if it's non-friendly AND either the table-wide switch
// is on, or this specific token has been individually revealed — an OR, not
// an AND, so a GM can reveal one target (e.g. after a successful Perception
// check they judge by eye — CPR's own skill roll cards don't compute
// success/fail against a DV, so that judgment call is deliberately left to
// the GM, not something this module tries to auto-resolve) without needing
// cpr-twins-ai's whole vision-mode effect running table-wide first.
function isVisibleFor(token) {
  return isEnemyToken(token) && (enabled || isRevealed(token));
}

async function show(token) {
  const model = buildQuickInfo(token);
  const html = await renderTemplate(TEMPLATE_PATH, model);

  remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  cardEl = wrapper.firstElementChild;
  document.body.appendChild(cardEl);
  position(token);
}

function remove() {
  cardEl?.remove();
  cardEl = null;
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

/**
 * Re-derives whether a card should be showing for whatever's currently
 * hovered, and shows/hides/repositions to match. The single place that
 * reconciles "what's under the mouse" against "is it eligible right now" —
 * called any time either side of that could have changed: a hover event, a
 * token update (a drag, or its enemy/revealed eligibility flipping — e.g.
 * the GM's per-token reveal toggle lands while a player is already
 * hovering that exact token), a canvas pan, or the table-wide switch
 * flipping.
 */
function refreshHovered() {
  if (!hoveredTokenId) { remove(); return; }
  const token = canvas.tokens?.get(hoveredTokenId);
  if (!token || !isVisibleFor(token)) { remove(); return; }
  if (cardEl) position(token);
  else show(token);
}

export function registerQuickInfoHud() {
  Hooks.on('hoverToken', (token, hovered) => {
    if (!hovered) {
      if (token.id === hoveredTokenId) { hoveredTokenId = null; remove(); }
      return;
    }
    hoveredTokenId = token.id;
    refreshHovered();
  });

  // Token updated while hovered — could be a drag (reposition), or its
  // enemy/revealed eligibility changing (show/hide).
  Hooks.on('updateToken', (doc) => {
    if (doc.id === hoveredTokenId) refreshHovered();
  });

  // Canvas zoom/pan while a card is showing.
  Hooks.on('canvasPan', refreshHovered);

  // Scene change or token removal invalidates whatever's currently hovered.
  Hooks.on('canvasReady', () => { hoveredTokenId = null; remove(); });
  Hooks.on('deleteToken', (doc) => {
    if (doc.id === hoveredTokenId) { hoveredTokenId = null; remove(); }
  });
}
