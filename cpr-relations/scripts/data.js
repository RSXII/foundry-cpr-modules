// Flags read/write layer. Nothing outside this file should call
// actor.getFlag/setFlag directly for the "cpr-relations" scope — that's what
// keeps the NPC-side and PC-side mirrored copies from drifting apart.

export const MODULE_ID = 'cpr-relations';

// A relationship is a rank 0-10, not a percentage. 0 is a distinct
// "Hostile" state (own rendering, not just "the low end of the scale"). 1
// is where every new relationship starts ("Neutral"). 9-10 render as
// hearts rather than bullets - reserved narratively for romantic
// relationships, though nothing here enforces that; it's a table
// convention, not a rule this module polices.
export const MAX_POINTS = 10;
export const HEART_FROM = 9;
export const DEFAULT_NEW_POINTS = 1;

const BULLET_FILLED = 'var(--cprt-cyan, #3ee6ff)';
const BULLET_EMPTY = 'var(--cprt-line-dim, #8a1f38)';
const HEART_FILLED = 'var(--cprt-hot, #ff2a5c)';
const HEART_EMPTY = 'var(--cprt-line-dim, #8a1f38)';

export function isHostile(points) {
  return points <= 0;
}

/**
 * Renders `points` as a 10-slot pip row: slots 1-8 are bullets, 9-10 are
 * hearts, filled up to `points`. At 0 every slot is empty - the caller is
 * expected to also show the "Hostile" callout in that case, this function
 * only describes the pips themselves.
 */
export function pipsFor(points) {
  const pips = [];
  for (let i = 1; i <= MAX_POINTS; i++) {
    const isHeart = i >= HEART_FROM;
    const filled = points > 0 && i <= points;
    pips.push({
      isHeart,
      filled,
      color: filled ? (isHeart ? HEART_FILLED : BULLET_FILLED) : (isHeart ? HEART_EMPTY : BULLET_EMPTY)
    });
  }
  return pips;
}

// getFlag/setFlag support dot-path keys like `relationships.<id>`, but
// Foundry has a known bug where a key segment containing a literal "."
// gets mangled by the internal path expansion instead of treated as a
// literal key. Safe here only because Foundry's own actor _id format
// (16-char alphanumeric) never contains a dot - do not key this map by
// anything else (slugs, names) without re-checking that.

/** All of `actor`'s relationships, keyed by the other actor's id. */
export function getRelationships(actor) {
  return actor.getFlag(MODULE_ID, 'relationships') ?? {};
}

/** `actor`'s relationship with one specific other actor, or null if none yet. */
export function getRelationship(actor, otherId) {
  return actor.getFlag(MODULE_ID, `relationships.${otherId}`) ?? null;
}

/**
 * Writes the same {points, fan} value to both actors' flags, keyed by each
 * other's id. GM-only by design — relationship values are GM-adjusted, never
 * player-writable.
 */
export async function setRelationship(actorA, actorB, { points, fan }) {
  if (!game.user.isGM) return null;
  const clamped = Math.max(0, Math.min(MAX_POINTS, Math.round(points)));
  const value = { points: clamped, fan: !!fan };
  await actorA.setFlag(MODULE_ID, `relationships.${actorB.id}`, value);
  await actorB.setFlag(MODULE_ID, `relationships.${actorA.id}`, value);
  return value;
}

/**
 * Deletes the relationship entirely (both sides), not just zeroes it out -
 * `unsetFlag` with a dotted key correctly removes just that one nested
 * entry rather than the whole `relationships` object (true since Foundry
 * 10.287; confirmed against the docs rather than assumed).
 */
export async function removeRelationship(actorA, actorB) {
  if (!game.user.isGM) return;
  await actorA.unsetFlag(MODULE_ID, `relationships.${actorB.id}`);
  await actorB.unsetFlag(MODULE_ID, `relationships.${actorA.id}`);
}

/**
 * Other actors `actor` could plausibly start a new relationship with -
 * excludes itself and anyone it already has a relationship entry for, so
 * the "add" list only ever offers genuinely new links.
 */
export function getAvailableActors(actor) {
  const existing = new Set(Object.keys(getRelationships(actor)));
  return game.actors
    .filter((a) => a.id !== actor.id && !existing.has(a.id))
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getFactions(actor) {
  return actor.getFlag(MODULE_ID, 'faction') ?? [];
}

export async function setFactions(actor, factions) {
  if (!game.user.isGM) return;
  await actor.setFlag(MODULE_ID, 'faction', factions);
}

// CPR's own actor type, not a flag we invent — confirmed live against a real
// world: mooks are type "mook", full characters (PC or major NPC) are type
// "character".
export function isMook(actor) {
  return actor.type === 'mook';
}
