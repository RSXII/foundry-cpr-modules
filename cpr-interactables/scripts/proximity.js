import { MODULE_ID, getHotspots, radiusPixels } from './data.js';
import { showPrompt, hidePrompt } from './hud.js';
import { openHotspotView } from './view.js';
import { CONTROL_LAYER_NAME } from './layer.js';

let currentHotspot = null;

/** This client's own token(s) to check proximity for: whatever's selected, falling back to the token(s) tied to the user's assigned character. */
function getUserTokens() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length) return controlled;
  const character = game.user.character;
  if (!character) return [];
  return canvas.tokens?.placeables.filter((t) => t.actor?.id === character.id) ?? [];
}

/**
 * A hotspot inside a room shouldn't fire for a token standing just outside
 * the same wall — distance alone doesn't know about walls, so this also
 * requires an unobstructed sight line from the token to the hotspot point.
 * "sight" (not "move") because a window blocking movement but not sight
 * still lets you read a poster through the glass; a solid wall blocks both.
 */
function hasLineOfSight(token, hotspot) {
  return !CONFIG.Canvas.polygonBackends.sight.testCollision(
    token.center,
    { x: hotspot.x, y: hotspot.y },
    { type: 'sight', mode: 'any' }
  );
}

/** Every hotspot at least one of `tokens` is both within reach of and has a sight line to — the same test that gates interaction also gates the sparkle marker, so "you can see the glint" and "you're close enough to press the key" mean the same thing. */
function findNearbyHotspots(tokens) {
  const found = [];
  if (!canvas.scene || !tokens.length) return found;
  const hotspots = getHotspots(canvas.scene);
  if (!hotspots.length) return found;

  const seen = new Set();
  for (const token of tokens) {
    const center = token.center;
    for (const hotspot of hotspots) {
      if (seen.has(hotspot.id)) continue;
      const reach = radiusPixels(hotspot) + Math.max(token.w, token.h) / 2;
      if (Math.hypot(center.x - hotspot.x, center.y - hotspot.y) > reach) continue;
      if (!hasLineOfSight(token, hotspot)) continue;
      seen.add(hotspot.id);
      found.push(hotspot);
    }
  }
  return found;
}

function recompute() {
  const nearby = findNearbyHotspots(getUserTokens());
  const hotspot = nearby[0] ?? null;

  currentHotspot = hotspot;
  if (hotspot) showPrompt(hotspot);
  else hidePrompt();

  canvas[CONTROL_LAYER_NAME]?.updateIndicatorVisibility(new Set(nearby.map((h) => h.id)));
}

/** Called by the "interact" keybinding. Returns true (and consumes the key) if a hotspot was in range. */
export function tryInteract() {
  if (!currentHotspot) return false;
  openHotspotView(currentHotspot);
  return true;
}

export function registerProximityHooks() {
  Hooks.on('refreshToken', () => recompute());
  Hooks.on('controlToken', () => recompute());

  // Line of sight can change without any token moving — a door opening, a
  // wall going up or down — so re-check on the same event Foundry's own
  // vision recomputes on.
  Hooks.on('sightRefresh', () => recompute());

  Hooks.on('updateScene', (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.hotspots`)) recompute();
  });

  Hooks.on('canvasReady', () => {
    currentHotspot = null;
    hidePrompt();
    recompute();
  });
}
