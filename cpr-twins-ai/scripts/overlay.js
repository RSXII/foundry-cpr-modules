// The target-lock prompt above eligible tokens: a bracket-cornered box sized
// to the token, a glow outline around it, and a clickable tag. Built as
// absolutely-positioned HTML rather than a PIXI child of the token: a PIXI
// child's on-screen size scales with canvas zoom (needing manual
// counter-scaling to stay readable), and styling/reusing the rest of this
// module's CSS is trivial for a <div> and fiddly for PIXI text. The
// tradeoff is that this file has to track token position/size/pan/zoom
// itself instead of getting it for free from the scene graph — see
// token-geometry.js.
//
// The outline used to be a PIXI.filters.OutlineFilter traced on the
// token's own art (silhouette-accurate, unlike a plain rectangle) — but
// confirmed against a real world, that filter isn't actually constructible
// in that Foundry build: it passes a `typeof === 'function'` guard and
// then throws "is not a constructor" on `new`. Worse than just no
// outline: an uncaught throw inside refresh() aborted refreshAll()'s loop
// partway through, so tokens after whichever one hit it first could lose
// their locks/markers too, not just the glow. Now a plain CSS box over the
// canvas, same technique as the lock bracket and claim marker below —
// less exact around an irregular sprite, but it can't take the rest of
// the overlay down with it if something about the render pipeline changes
// again.

import { MODULE_ID, isTakeableType, isTakeable, isModeEnabled, controllerOf, releaseControl } from './data.js';
import { requestControl } from './socket.js';
import { getTokenScreenBox } from './token-geometry.js';
import { ensureLockLayer } from './dom-layer.js';
import { visionEffect } from './vision-effect.js';

// tokenId -> { el, kind: 'take' | 'release' }
const locks = new Map();

// tokenId -> { el, kind: 'take' | 'release' | 'ambient' } — colors for each
// live in styles/twins-ai.css as .cpr-twins-ai-scan-outline--<kind>.
// ambient is "the AI can see everyone," the glow every token gets while
// the mode is on; take/release reuse the same box for whichever token has
// an actual prompt, so a token with a real prompt still visually stands
// out from the rest rather than layering two outlines on one token.
const outlines = new Map();

// tokenId -> element. A bouncing "claimed" marker, separate from the take/
// release lock above and its own visibility rule: it shows to *everyone*
// (GM, controller, and every other player) for as long as a token is
// claimed, regardless of whether the mode is currently on — an at-a-glance
// "this one's spoken for" the whole table can read, not a per-user prompt.
const markers = new Map();

/**
 * What (if anything) the current user should see on `token`:
 * - Nobody sees anything while the boot sequence is playing — nothing
 *   should visually compete with (or be clickable under) that cinematic
 *   pre-roll. overlay.js re-evaluates everything once it ends.
 * - GM: a Release prompt whenever the token is currently claimed, regardless
 *   of whether the mode is on — turning the mode off stops new claims, it
 *   doesn't strand the GM without a way to clean up existing ones.
 * - Everyone else: a Take prompt, only while the mode is on and the token is
 *   unclaimed and eligible. Already-claimed tokens show nothing to players
 *   other than whoever holds them (who has no need for the prompt at all).
 */
function desiredKind(token) {
  if (visionEffect.booting) return null;
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

/**
 * Cheap per-tick repositioning — no eligibility recheck, just screen math.
 * Deliberately doesn't check token.visible: this overlay is meant to see
 * through walls while the mode is on — a rare, GM-controlled narrative
 * beat, not a permanent state — so a token stays outlined/locked at its
 * real position whether or not the viewing player's own vision reaches
 * it. See registerOverlayHooks()'s visibilityRefresh hook for why this
 * still needs to run even for a token Foundry itself has stopped bothering
 * to redraw — that part's still real: without it, the box would freeze at
 * its last position instead of following the token behind the wall.
 */
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
  const claimed = !visionEffect.booting && !!controllerOf(token.document);
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

function buildOutline(kind) {
  const el = document.createElement('div');
  el.className = `cpr-twins-ai-scan-outline cpr-twins-ai-scan-outline--${kind}`;
  ensureLockLayer().appendChild(el);
  return el;
}

/** Same box as the token itself (reposition()'s box), not the lock's — an outline still needs to sit over a token whose lock is hidden from this viewer. */
function repositionOutline(token, el) {
  const box = getTokenScreenBox(token);
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

function refreshOutline(token, kind) {
  const existing = outlines.get(token.id);
  if (!kind) {
    if (existing) {
      existing.el.remove();
      outlines.delete(token.id);
    }
    return;
  }
  if (existing && existing.kind !== kind) {
    existing.el.remove();
    outlines.delete(token.id);
  }
  const current = outlines.get(token.id);
  if (current) {
    repositionOutline(token, current.el);
  } else {
    const el = buildOutline(kind);
    outlines.set(token.id, { el, kind });
    repositionOutline(token, el);
  }
}

/** Full recheck for one token: add/remove/swap its lock, its claim marker, and its outline, as needed. */
function refresh(token) {
  refreshMarker(token);

  const kind = desiredKind(token);
  const existing = locks.get(token.id);

  if (!kind) {
    if (existing) {
      existing.el.remove();
      locks.delete(token.id);
    }
  } else if (existing && existing.kind !== kind) {
    existing.el.remove();
    locks.delete(token.id);
  }

  if (kind) {
    const current = locks.get(token.id);
    if (current) {
      reposition(token, current.el);
    } else {
      const el = buildLock(kind, token);
      locks.set(token.id, { el, kind });
      reposition(token, el);
    }
  }

  // The outline is its own decision, separate from the lock above: every
  // token gets the ambient blue glow for as long as the mode is on, even
  // ones with no lock at all — "the AI can see everyone." A take/release
  // prompt's own color takes priority on the same token rather than
  // layering two outlines on one token.
  const outlineKind = kind || (!visionEffect.booting && isModeEnabled() ? 'ambient' : null);
  refreshOutline(token, outlineKind);
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
  for (const [id, { el }] of outlines) {
    if (!liveIds.has(id)) {
      el.remove();
      outlines.delete(id);
    }
  }
}

function repositionAll() {
  for (const token of canvas.tokens?.placeables ?? []) {
    const existingLock = locks.get(token.id);
    if (existingLock) reposition(token, existingLock.el);
    const existingMarker = markers.get(token.id);
    if (existingMarker) repositionMarker(token, existingMarker);
    const existingOutline = outlines.get(token.id);
    if (existingOutline) repositionOutline(token, existingOutline.el);
  }
}

// Foundry stops firing refreshToken for a token once it's hidden from the
// viewing player — reasonable on Foundry's side (no point redrawing
// something invisible), but wrong for us: the outline is deliberately
// meant to see through walls (a rare, GM-controlled narrative beat, not a
// bug), so a hidden token still needs to keep tracking. Chasing the exact
// Foundry event that fires for a hidden-but-moving token turned out not
// to be reliable (visibilityRefresh didn't cover it either) — this ticks
// repositionAll() directly instead, sidestepping the question of which
// render/vision event to trust. This only works because getTokenScreenBox()
// (token-geometry.js) no longer reads the token's own worldTransform, which
// PIXI stops updating once a token isn't being rendered — it was reading
// that stale value on every tick just as fast, borders included, until the
// geometry itself was rebuilt on canvas.stage's transform (always live) plus
// the token's raw document x/y (always live) instead. Near-zero cost when
// nothing's tracked (locks/markers/outlines are empty whenever the mode is
// off), so it just runs for the client's lifetime rather than needing its
// own start/stop.
const REPOSITION_TICK_MS = 100;
setInterval(repositionAll, REPOSITION_TICK_MS);

// How long after the boot sequence ends before the ambient/take/release
// outlines start their fade-in (see .cpr-twins-ai-outlines-visible in
// twins-ai.css) — a beat after the vision filter itself has already
// flickered on, so the outlines read as their own reveal rather than
// appearing underneath the filter's own transition.
const OUTLINE_REVEAL_DELAY_MS = 500;
let outlineRevealTimer = null;

function resetOutlineReveal() {
  if (outlineRevealTimer) {
    clearTimeout(outlineRevealTimer);
    outlineRevealTimer = null;
  }
  ensureLockLayer().classList.remove('cpr-twins-ai-outlines-visible');
}

function scheduleOutlineReveal() {
  resetOutlineReveal();
  outlineRevealTimer = window.setTimeout(() => {
    outlineRevealTimer = null;
    ensureLockLayer().classList.add('cpr-twins-ai-outlines-visible');
  }, OUTLINE_REVEAL_DELAY_MS);
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
  const outline = outlines.get(tokenId);
  if (outline) {
    outline.el.remove();
    outlines.delete(tokenId);
  }
}

export function registerOverlayHooks() {
  Hooks.on('canvasReady', refreshAll);
  Hooks.on('canvasPan', repositionAll);
  // A fresh boot cycle starting means the outlines it's about to create
  // (once bootEnd fires) should replay their delayed reveal rather than
  // inheriting an already-visible layer from a previous mount.
  Hooks.on(`${MODULE_ID}.bootStart`, resetOutlineReveal);
  // Locks/markers were suppressed for the boot sequence's duration (see
  // desiredKind()/refreshMarker()) — bring them all back the instant it
  // ends, rather than waiting on some unrelated hook to happen to fire.
  // The outlines themselves stay invisible a beat longer still — see
  // scheduleOutlineReveal().
  Hooks.on(`${MODULE_ID}.bootEnd`, () => {
    refreshAll();
    scheduleOutlineReveal();
  });

  // Fires every tick while a token glides/rotates — reposition only, the
  // eligibility check stays on the hooks below to keep this cheap.
  Hooks.on('refreshToken', (token) => {
    const existing = locks.get(token.id);
    if (existing) reposition(token, existing.el);
    const marker = markers.get(token.id);
    if (marker) repositionMarker(token, marker);
    const outline = outlines.get(token.id);
    if (outline) repositionOutline(token, outline.el);
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
