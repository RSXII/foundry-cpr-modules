// Effects applied to Foundry's OWN application chrome — the sidebar/chat
// log, the scene navigation bar — during a netrunner intrusion. Deliberately
// separate from vision-effect.js/overlay.js, which only ever touch the
// canvas overlay this module draws itself: this is the first step into
// actually reaching outside that and reacting on Foundry's real UI.
//
// Prototype approach: an overlay technique, not direct styling. A
// transparent, pointer-events:none <div> gets positioned exactly over each
// target element (same technique as the canvas's own duotone/breach-flash
// layers) and tinted/flickered — rather than adding classes to Foundry's
// own internal markup and depending on its real DOM structure, which is
// known to shift between major versions (see main.js's own v12/v13 caution
// on getSceneControlButtons). Lower risk, and a good way to see whether the
// effect reads well before deciding it's worth the extra fragility of
// styling Foundry's actual chat bubbles/nav text directly.

import { MODULE_ID } from './data.js';

// target -> { getEl: () => Application, overlayEl }. Application#element is
// a jQuery object through Foundry v12 (this module's target version);
// .get(0) is jQuery's own way to unwrap to the raw DOM node.
const TARGETS = {
  sidebar: () => ui.sidebar?.element,
  nav: () => ui.nav?.element,
};

const overlays = new Map(); // key -> HTMLElement
let repositionTimer = null;

function unwrap(el) {
  if (!el) return null;
  if (el instanceof HTMLElement) return el;
  if (typeof el.get === 'function') return el.get(0) ?? null;
  return el[0] ?? null;
}

function ensureOverlay(key) {
  let el = overlays.get(key);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'cpr-twins-ai-chrome-breach';
  document.body.appendChild(el);
  overlays.set(key, el);
  return el;
}

function repositionOverlay(key) {
  const target = unwrap(TARGETS[key]?.());
  const el = overlays.get(key);
  if (!target || !el) return;
  const rect = target.getBoundingClientRect();
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

function repositionAll() {
  for (const key of overlays.keys()) repositionOverlay(key);
}

function startBreach() {
  for (const key of Object.keys(TARGETS)) {
    ensureOverlay(key);
    repositionOverlay(key);
    overlays.get(key).classList.add('show');
  }
  // Foundry's own chrome can resize/collapse independently of the browser
  // window (no reliable single event for every case across sidebar
  // collapse/expand, scene nav overflow, etc.) — same "cheap poll beats
  // chasing exact events" call already made for the token outlines in
  // overlay.js. Only runs while a breach is actually showing something,
  // unlike that one, since this has no other reason to exist otherwise.
  repositionTimer = window.setInterval(repositionAll, 200);
}

function endBreach() {
  if (repositionTimer) {
    clearInterval(repositionTimer);
    repositionTimer = null;
  }
  for (const el of overlays.values()) el.classList.remove('show');
}

export function registerChromeEffectHooks() {
  Hooks.on(`${MODULE_ID}.intrusionStart`, startBreach);
  Hooks.on(`${MODULE_ID}.intrusionEnd`, endBreach);
}
