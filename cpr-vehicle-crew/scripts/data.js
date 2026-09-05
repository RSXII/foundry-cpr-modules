// Flags read/write layer. Nothing outside this file should call
// actor.setFlag/unsetFlag for the "cpr-vehicle-crew" scope directly — keeps
// seat shape (id/label/order/offsetX/offsetY/matchRotation/occupantUuid)
// consistent and every write GM-gated in one place.

export const MODULE_ID = 'cpr-vehicle-crew';

// cyberpunk-red-vehicles registers its actor type as a module-namespaced
// subtype (`documentTypes.Actor.vehicle` in its module.json), so the real
// stored `actor.type` is this, not bare "vehicle" — confirmed by reading
// that module's scripts/module.js.
export const VEHICLE_TYPE = 'cyberpunk-red-vehicles.vehicle';

export const OWNERSHIP = { NONE: 0, OBSERVER: 2, OWNER: 3 };

export function isVehicle(actor) {
  return actor?.type === VEHICLE_TYPE;
}

/** Raw seat list, never writes. Safe to call from any client. */
export function getSeats(actor) {
  return actor?.getFlag(MODULE_ID, 'seats') ?? [];
}

export function getSeat(actor, seatId) {
  return getSeats(actor).find((s) => s.id === seatId) ?? null;
}

/**
 * First-open convenience: if this vehicle has no seats defined yet, seed
 * one per point of `system.seats` (the capacity number the base module
 * already tracks) instead of making the GM redefine seat count from
 * scratch. No-ops once `seats` exists, even if it's since been emptied out
 * on purpose.
 */
export async function ensureSeatsSeeded(actor) {
  if (!game.user.isGM) return;
  if (actor.getFlag(MODULE_ID, 'seats') !== undefined) return;
  const capacity = Math.max(0, Number(actor.system?.seats ?? 0));
  const seats = [];
  for (let i = 1; i <= capacity; i++) {
    seats.push(_newSeat(`Seat ${i}`, i));
  }
  await actor.setFlag(MODULE_ID, 'seats', seats);
}

function _newSeat(label, order) {
  return {
    id: foundry.utils.randomID(),
    label,
    order,
    // offsetX/offsetY are relative to the vehicle token's *center*, in the
    // vehicle's own unrotated frame (i.e. as if rotation were 0) — rotated
    // to match the vehicle's current heading at follow-time, not stored
    // pre-rotated, so they stay meaningful as the vehicle turns.
    offsetX: 0,
    offsetY: 0,
    // Bookkeeping for token-follow.js's one-time migration: brand new seats
    // are already authored in the current (center-relative) scheme, so
    // there's nothing to migrate. Seats saved before that scheme existed
    // lack this field entirely, which is what flags them for conversion.
    offsetOrigin: 'center',
    // Whether the occupant's own token rotation should track the vehicle's.
    // Defaults on since that's the more common "riding in a vehicle" look,
    // but off is the right call for non-directional art (a circular
    // portrait has no facing to speak of).
    matchRotation: true,
    occupantUuid: null,
  };
}

export async function addSeat(actor, label) {
  if (!game.user.isGM) return;
  const seats = foundry.utils.deepClone(getSeats(actor));
  seats.push(_newSeat(label || `Seat ${seats.length + 1}`, seats.length + 1));
  await actor.setFlag(MODULE_ID, 'seats', seats);
}

/** Partial update: any of {label, offsetX, offsetY, matchRotation, offsetOrigin}. */
export async function updateSeat(actor, seatId, changes) {
  if (!game.user.isGM) return;
  const seats = foundry.utils.deepClone(getSeats(actor));
  const seat = seats.find((s) => s.id === seatId);
  if (!seat) return;
  if (changes.label !== undefined) seat.label = changes.label;
  if (changes.offsetX !== undefined) seat.offsetX = Number(changes.offsetX) || 0;
  if (changes.offsetY !== undefined) seat.offsetY = Number(changes.offsetY) || 0;
  if (changes.matchRotation !== undefined) seat.matchRotation = !!changes.matchRotation;
  // Internal-only bookkeeping field, not exposed in the edit-seat dialog —
  // see token-follow.js's offset-origin migration.
  if (changes.offsetOrigin !== undefined) seat.offsetOrigin = changes.offsetOrigin;
  await actor.setFlag(MODULE_ID, 'seats', seats);
}

export async function removeSeat(actor, seatId) {
  if (!game.user.isGM) return;
  const seats = getSeats(actor).filter((s) => s.id !== seatId);
  await actor.setFlag(MODULE_ID, 'seats', seats);
}

/**
 * Seats a single occupant. One occupant per seat, one seat per occupant —
 * unlike VAS's multi-occupant "cramming", a seat here is a physical spot a
 * token gets pinned to, so anything but 1:1 stops meaning anything
 * positionally. Clears the occupant from any other seat on this vehicle
 * first, same as VAS's own reassignment behavior.
 */
export async function assignOccupant(vehicleActor, seatId, occupantActor) {
  if (!game.user.isGM) return null;
  const seats = foundry.utils.deepClone(getSeats(vehicleActor));
  for (const s of seats) {
    if (s.occupantUuid === occupantActor.uuid) s.occupantUuid = null;
  }
  const target = seats.find((s) => s.id === seatId);
  if (!target) return null;
  target.occupantUuid = occupantActor.uuid;
  await vehicleActor.setFlag(MODULE_ID, 'seats', seats);
  return target;
}

export async function clearOccupant(vehicleActor, seatId) {
  if (!game.user.isGM) return;
  const seats = foundry.utils.deepClone(getSeats(vehicleActor));
  const seat = seats.find((s) => s.id === seatId);
  if (!seat) return;
  seat.occupantUuid = null;
  await vehicleActor.setFlag(MODULE_ID, 'seats', seats);
}

/**
 * Owning player for `actor` — first non-GM user with OWNER permission.
 * Actors without a player owner (GM-run NPCs riding along) have no target
 * for the access dropdown, which is a legitimate "nothing to do here".
 */
export function getActorOwner(actor) {
  return game.users.find((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')) ?? null;
}

/** Whether this vehicle fires its own weapons (autopilot) when no seat is occupied. */
export function isAutonomous(actor) {
  return !!actor?.getFlag(MODULE_ID, 'autonomous');
}

export async function setAutonomous(actor, value) {
  if (!game.user.isGM) return;
  await actor.setFlag(MODULE_ID, 'autonomous', !!value);
}

// Baseline REF/DEX and skill level given to a freshly-created autopilot
// actor — a competent-but-unremarkable gunnery computer. GM can hand-tune
// either afterward directly on the actor sheet; this is only a starting
// point, so later calls never overwrite a level that's already nonzero.
const AUTOPILOT_DEFAULT_STAT = 6;
const AUTOPILOT_DEFAULT_SKILL_LEVEL = 6;

/**
 * The hidden actor that stands in as "shooter" for an autonomous vehicle's
 * mounted weapons when no crew member is seated. Lazily created once per
 * vehicle and remembered via flag; the core system's attack-roll code needs
 * a real actor with stats and a skill item, and a vehicle actor has neither.
 */
export async function getOrCreateAutopilotActor(vehicleActor) {
  const uuid = vehicleActor.getFlag(MODULE_ID, 'autopilotActorUuid');
  if (uuid) {
    const existing = await fromUuid(uuid);
    if (existing) {
      // Recover from actors created before the create()-bypass fix below:
      // those got stats but none of the core skill items (Heavy Weapons,
      // Autofire, etc). The system's own createEmbeddedDocuments override
      // refuses to add anything flagged system.core after the fact (that's
      // the "Do not try to add core items..." warning) — core skills can
      // only be seeded through Actor.create()'s special item-injection
      // path, so a broken one can't be patched, only rebuilt.
      const hasSkills = (existing.itemTypes?.skill ?? []).length > 0;
      if (hasSkills) return existing;
      if (!game.user.isGM) return null;
      await existing.delete();
    }
  }
  if (!game.user.isGM) return null;

  // No `system` key here on purpose: CPRActor.create() only auto-injects
  // the full core skill list when it sees an actor with no `system` data
  // yet — passing stats up front here would make it look like an
  // existing/imported actor and skip that injection.
  const actor = await Actor.create({
    name: `${vehicleActor.name} — Autopilot`,
    type: 'mook',
  });
  await actor.update({
    'system.stats.ref.value': AUTOPILOT_DEFAULT_STAT,
    'system.stats.dex.value': AUTOPILOT_DEFAULT_STAT,
  });
  await vehicleActor.setFlag(MODULE_ID, 'autopilotActorUuid', actor.uuid);
  return actor;
}

/**
 * Bumps the autopilot actor's level in `skillName` up from the seeded
 * default of 0, the first time that skill is actually needed to fire.
 * Only touches a level still sitting at 0, so a GM's deliberate tuning
 * (including intentionally setting one to 0) sticks. If the skill item
 * isn't present at all, the actor predates the core-skill fix and needs
 * rebuilding — see getOrCreateAutopilotActor — so this just warns rather
 * than trying to add it (the system blocks adding core items post-creation).
 */
export async function ensureAutopilotSkill(autopilotActor, skillName) {
  if (!game.user.isGM || !skillName) return;
  const skillItem = autopilotActor.items.find(
    (i) => i.type === 'skill' && i.name === skillName
  );
  if (!skillItem) {
    console.warn(
      `cpr-vehicle-crew | Autopilot actor "${autopilotActor.name}" has no "${skillName}" skill item and can't be repaired in place — delete it and fire again to rebuild it.`
    );
    return;
  }
  if (Number(skillItem.system.level) !== 0) return;
  await skillItem.update({ 'system.level': AUTOPILOT_DEFAULT_SKILL_LEVEL });
}
