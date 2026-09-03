// The target-lock prompt above eligible tokens: a bracket-cornered box sized
// to the token, a rim-light outline traced on the token's own art (a PIXI
// filter, not a rectangle — it follows the actual sprite silhouette), and a
// clickable tag. Built as absolutely-positioned HTML for the bracket/tag
// rather than a PIXI child of the token: a PIXI child's on-screen size
// scales with canvas zoom (needing manual counter-scaling to stay
// readable), and styling/reusing the rest of this module's CSS is trivial
// for a <div> and fiddly for PIXI text. The tradeoff is that this file has
// to track token position/size/pan/zoom itself instead of getting it for
// free from the scene graph — see token-geometry.js.

import { MODULE_ID, isTakeableType, isTakeable, isModeEnabled, controllerOf, releaseControl } from './data.js';
import { requestControl } from './socket.js';
import { getTokenScreenBox } from './token-geometry.js';
import { ensureLockLayer } from './dom-layer.js';
import { visionEffect } from './vision-effect.js';

// Keep in sync with --cpr-ta-accent / --cpr-ta-ink in styles/twins-ai.css.
const OUTLINE_COLORS = { take: 0x3dffa0, release: 0xeafff2 };

// tokenId -> { el, kind: 'take' | 'release' }
const locks = new Map();

// tokenId -> element. A bouncing "claimed" marker, separate from the take/
// release lock above and its own visibility rule: it shows to *everyone*
// (GM, controller, and every other player) for as long as a token is
// claimed, regardless of whether the mode is currently on — an at-a-glance
// "this one's spoken for" the whole table can read, not a per-user prompt.
const markers = new Map();

/**
 * What (if anything) the current user should see on `token`:
 * - GM: a Release prompt whenever the token is currently claimed, regardless
 *   of whether the mode is on — turning the mode off stops new claims, it
 *   doesn't strand the GM without a way to clean up existing ones.
 * - Everyone else: a Take prompt, only while the mode is on and the token is
 *   unclaimed and eligible. Already-claimed tokens show nothing to players
 *   other than whoever holds them (who has no need for the prompt at all).
 */
function desiredKind(token) {
  const actor = token.actor;
  if (!isTakeableType(actor) || !isTakeable(actor)) return null;

  const claimedBy = controllerOf(token.document);
  if (claimedBy) return game.user.isGM ? 'release' : null;

  if (game.user.isGM) return null;
  if (!isModeEnabled()) return null;
  return 'take';
}

function buildLock(kind, token) {
  const el = document.createElement('div');
  el.className = `cpr-twins-ai-lock cpr-twins-ai-lock--${kind}`;
  el.innerHTML = `
    <i class="cpr-twins-ai-corner a"></i>
    <i class="cpr-twins-ai-corner b"></i>
    <i class="cpr-twins-ai-corner c"></i>
    <i class="cpr-twins-ai-corner d"></i>
    <div class="cpr-twins-ai-tag" role="button" tabindex="0">
      // <b>${kind === 'take' ? 'TAKE CONTROL' : 'RELEASE CONTROL'}</b> — ${token.document.name}
    </div>
  `;

  const tag = el.querySelector('.cpr-twins-ai-tag');
  const act = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (kind === 'take') {
      requestControl(token.document);
      visionEffect.announceRequest(token.document.name);
    } else {
      releaseControl(token.document);
    }
  };
  tag.addEventListener('click', act);
  tag.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') act(ev);
  });

  ensureLockLayer().appendChild(el);
  return el;
}

/** Cheap per-tick repositioning — no eligibility recheck, just screen math. */
function reposition(token, el) {
  const box = getTokenScreenBox(token);
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

function buildMarker() {
  const el = document.createElement('div');
  el.className = 'cpr-twins-ai-claim-marker';
  el.innerHTML = '<i class="cpr-twins-ai-claim-triangle"></i>';
  ensureLockLayer().appendChild(el);
  return el;
}

/** Centered above the token's own box, not the lock's — a marker still needs to sit over a token whose lock is hidden from this viewer (e.g. a player looking at someone else's claimed mook). */
function repositionMarker(token, el) {
  const box = getTokenScreenBox(token);
  el.style.left = `${box.left + box.width / 2}px`;
  el.style.top = `${box.top}px`;
}

function refreshMarker(token) {
  const claimed = !!controllerOf(token.document);
  const existing = markers.get(token.id);
  if (!claimed) {
    if (existing) {
      existing.remove();
      markers.delete(token.id);
    }
    return;
  }
  if (existing) {
    repositionMarker(token, existing);
    return;
  }
  const el = buildMarker();
  markers.set(token.id, el);
  repositionMarker(token, el);
}

/**
 * Traces a rim-light outline on the token's own art via a PIXI filter —
 * guarded because OutlineFilter isn't part of core PIXI itself, only the
 * bundle Foundry ships alongside it. If some future Foundry build drops it,
 * this quietly no-ops rather than throwing: the bracket and tag alone still
 * communicate "this token is interactable."
 */
function applyOutline(token, kind) {
  if (typeof PIXI?.filters?.OutlineFilter !== 'function') return;
  const mesh = token.mesh;
  if (!mesh) return;

  if (!mesh.__cprTwinsAiOutline) {
    const filter = new PIXI.filters.OutlineFilter(2, OUTLINE_COLORS[kind], 0.3);
    mesh.__cprTwinsAiOutline = filter;
    mesh.filters = [...(mesh.filters ?? []), filter];
  } else {
    mesh.__cprTwinsAiOutline.color = OUTLINE_COLORS[kind];
  }
}

function clearOutline(token) {
  const mesh = token.mesh;
  const filter = mesh?.__cprTwinsAiOutline;
  if (!filter) return;
  mesh.filters = (mesh.filters ?? []).filter((f) => f !== filter);
  delete mesh.__cprTwinsAiOutline;
}

/** Full recheck for one token: add/remove/swap its lock and outline, and its claim marker, as needed. */
function refresh(token) {
  refreshMarker(token);

  const kind = desiredKind(token);
  const existing = locks.get(token.id);

  if (!kind) {
    if (existing) {
      existing.el.remove();
      locks.delete(token.id);
    }
    clearOutline(token);
    return;
  }

  applyOutline(token, kind);

  if (existing && existing.kind !== kind) {
    existing.el.remove();
    locks.delete(token.id);
  }

  const current = locks.get(token.id);
  if (current) {
    reposition(token, current.el);
    return;
  }

  const el = buildLock(kind, token);
  locks.set(token.id, { el, kind });
  reposition(token, el);
}

function refreshAll() {
  const liveIds = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    liveIds.add(token.id);
    refresh(token);
  }
  for (const [id, { el }] of locks) {
    if (!liveIds.has(id)) {
      el.remove();
      locks.delete(id);
    }
  }
  for (const [id, el] of markers) {
    if (!liveIds.has(id)) {
      el.remove();
      markers.delete(id);
    }
  }
}

function repositionAll() {
  for (const token of canvas.tokens?.placeables ?? []) {
    const existingLock = locks.get(token.id);
    if (existingLock) reposition(token, existingLock.el);
    const existingMarker = markers.get(token.id);
    if (existingMarker) repositionMarker(token, existingMarker);
  }
}

function removeLock(tokenId) {
  const existing = locks.get(tokenId);
  if (existing) {
    existing.el.remove();
    locks.delete(tokenId);
  }
  const marker = markers.get(tokenId);
  if (marker) {
    marker.remove();
    markers.delete(tokenId);
  }
}

export function registerOverlayHooks() {
  Hooks.on('canvasReady', refreshAll);
  Hooks.on('canvasPan', repositionAll);

  // Fires every tick while a token glides/rotates — reposition only, the
  // eligibility check stays on the hooks below to keep this cheap.
  Hooks.on('refreshToken', (token) => {
    const existing = locks.get(token.id);
    if (existing) reposition(token, existing.el);
    const marker = markers.get(token.id);
    if (marker) repositionMarker(token, marker);
  });

  Hooks.on('createToken', () => refreshAll());
  Hooks.on('deleteToken', (tokenDoc) => removeLock(tokenDoc.id));

  // The takeable flag lives on the actor; re-evaluate every token backed by
  // it (covers unlinked mooks sharing one base actor, not just linked ones).
  Hooks.on('updateActor', (actor) => {
    for (const token of canvas.tokens?.placeables ?? []) {
      if (token.actor?.id === actor.id) refresh(token);
    }
  });

  Hooks.on('updateToken', (tokenDoc, changes) => {
    if (!('flags' in changes) && !('ownership' in changes)) return;
    const token = canvas.tokens?.get(tokenDoc.id);
    if (token) refresh(token);
  });

  Hooks.on('updateSetting', (setting) => {
    if (setting.key === `${MODULE_ID}.modeEnabled`) refreshAll();
  });
}
