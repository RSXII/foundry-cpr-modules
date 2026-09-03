import { VEHICLE_TYPE, getSeats, updateSeat } from './data.js';

// Temporary diagnostic logging for the move-follow timing issue. Flip to
// false (or delete this block and the _log() calls below) once it's
// confirmed working — this isn't meant to ship on permanently.
const DEBUG = true;
function _log(...args) {
  if (DEBUG) console.log(`[cpr-vehicle-crew] +${performance.now().toFixed(0)}ms`, ...args);
}

// Sort offset that puts a passenger's token above its vehicle's within the
// token layer (Foundry breaks same-elevation draw order ties by `sort`).
const PASSENGER_SORT_BUMP = 100;

// A mouse-dragged vehicle move animates: updateToken fires with the
// document's x/y not yet at the drop target (confirmed by logging — changes
// showed the final drop point while tokenDoc.x/y at that instant was still
// mid-glide). A keyboard (WASD) move is a single discrete step with no such
// gap, which is why only mouse-drags showed the bug. A fixed delay is
// fragile (a longer drag animates longer), so instead of guessing a
// duration we poll tokenDoc.x/y/rotation until they stop changing for a
// couple of consecutive checks, then treat that as settled. Keyed by token
// id with a generation counter so a newer move always supersedes and
// cancels any still-polling older one for the same vehicle.
const POLL_INTERVAL_MS = 80;
const STABLE_CHECKS_REQUIRED = 2;
const SETTLE_TIMEOUT_MS = 5000;
const followGeneration = new Map();

/** The token currently representing `vehicleActor` on the active scene. */
export function findVehicleToken(vehicleActor, sheetToken = null) {
  if (sheetToken) return sheetToken;
  return canvas.scene?.tokens?.find((t) => t.actorId === vehicleActor.id) ?? null;
}

/** The token currently representing `occupantActor` on `scene`. */
export function findOccupantToken(scene, occupantActor) {
  return scene?.tokens?.find((t) => t.actorId === occupantActor.id) ?? null;
}

/**
 * Rotates offset vector (offsetX, offsetY) by `rotationDegrees`, matching
 * Foundry's own token rotation convention: 0° is the token's un-rotated
 * orientation, increasing clockwise as drawn on screen. Seat offsets are
 * authored against that same unrotated frame (as if the vehicle's rotation
 * were 0), so this is what turns "20px left of center" into the correct
 * screen-space vector once the vehicle has actually turned.
 */
function _rotateOffset(offsetX, offsetY, rotationDegrees) {
  const theta = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: offsetX * cos - offsetY * sin,
    y: offsetX * sin + offsetY * cos,
  };
}

function _center(token) {
  const gridSize = canvas.grid.size;
  return {
    x: token.x + (token.width * gridSize) / 2,
    y: token.y + (token.height * gridSize) / 2,
  };
}

/**
 * One-time conversion for seats saved before offsets were center-relative
 * (they were previously added directly to the vehicle's top-left corner,
 * with no rotation awareness at all). Converting `offsetX/Y` by subtracting
 * half the vehicle's pixel size reproduces the exact same physical point on
 * the vehicle under the new center-relative, rotation-aware formula — so a
 * seat someone already carefully positioned on the dashboard keeps landing
 * in the same spot instead of needing to be re-tuned by hand. No-ops once
 * `offsetOrigin` is already 'center' (new seats are created that way).
 */
async function _migrateSeatOffsetOrigin(vehicleActor, vehicleToken, seat) {
  if (seat.offsetOrigin === 'center') return seat;
  const gridSize = canvas.grid.size;
  const offsetX = (seat.offsetX || 0) - (vehicleToken.width * gridSize) / 2;
  const offsetY = (seat.offsetY || 0) - (vehicleToken.height * gridSize) / 2;
  _log('migrating seat offset origin', seat.label, 'from', { x: seat.offsetX, y: seat.offsetY }, 'to', { x: offsetX, y: offsetY });
  await updateSeat(vehicleActor, seat.id, { offsetX, offsetY, offsetOrigin: 'center' });
  return { ...seat, offsetX, offsetY, offsetOrigin: 'center' };
}

/**
 * Target {x, y, sort, rotation} for `passengerToken` sitting in `seat` on
 * `vehicleToken`. x/y: rotate the seat's offset to match the vehicle's
 * current heading, then add it to the vehicle's *center* — matches the
 * pre-rotation formula exactly (vehicle top-left + offset) once an offset
 * has gone through _migrateSeatOffsetOrigin, since center = top-left +
 * halfSize and migration subtracts that same halfSize back out.
 */
function _seatTarget(vehicleToken, passengerToken, seat) {
  const vehicleRotation = vehicleToken.rotation || 0;
  const vehicleCenter = _center(vehicleToken);
  const rotatedOffset = _rotateOffset(seat.offsetX || 0, seat.offsetY || 0, vehicleRotation);

  return {
    x: vehicleCenter.x + rotatedOffset.x,
    y: vehicleCenter.y + rotatedOffset.y,
    sort: (vehicleToken.sort || 0) + PASSENGER_SORT_BUMP,
    rotation: seat.matchRotation ? vehicleRotation : passengerToken.rotation,
  };
}

/**
 * Inverse of _seatTarget's position math: given a token some GM has
 * dragged to wherever they want a seat to sit on the vehicle right now,
 * back-computes the canonical (unrotated, center-relative) offsetX/offsetY
 * that reproduces that exact spot — the "capture" behind the Edit Seat
 * dialog's Capture button, so a GM can eyeball seat placement visually
 * instead of guessing pixel offsets by hand.
 */
export function captureSeatOffset(vehicleToken, markerToken) {
  const vehicleRotation = vehicleToken.rotation || 0;
  const vehicleCenter = _center(vehicleToken);
  const markerCenter = _center(markerToken);
  const delta = { x: markerCenter.x - vehicleCenter.x, y: markerCenter.y - vehicleCenter.y };
  // Rotating by the negative angle undoes the vehicle's current heading,
  // recovering the offset as authored (i.e. as if rotation were 0).
  const unrotated = _rotateOffset(delta.x, delta.y, -vehicleRotation);
  const result = { offsetX: Math.round(unrotated.x), offsetY: Math.round(unrotated.y) };
  _log('captureSeatOffset', {
    vehicle: { x: vehicleToken.x, y: vehicleToken.y, width: vehicleToken.width, height: vehicleToken.height, rotation: vehicleRotation },
    marker: { x: markerToken.x, y: markerToken.y, width: markerToken.width, height: markerToken.height },
    vehicleCenter,
    markerCenter,
    delta,
    unrotated,
    result,
  });
  return result;
}

function _sameTarget(passengerToken, target) {
  return (
    passengerToken.x === target.x &&
    passengerToken.y === target.y &&
    passengerToken.sort === target.sort &&
    passengerToken.rotation === target.rotation
  );
}

/**
 * Places `occupantActor`'s token at `seat`'s (rotation-aware) offset from
 * `vehicleToken`'s *current* position — recomputed fresh from the vehicle
 * every time, never from the passenger's own current position. That's
 * deliberate: an earlier version tracked relative deltas (move-by-dx/dy),
 * which meant any missed or double-counted move compounded into permanent
 * drift. Recomputing the absolute target from the vehicle every call is
 * self-correcting instead — even a stale or duplicate call converges on the
 * same right answer.
 */
export async function snapOccupantToSeat(vehicleToken, occupantActor, seat) {
  const passengerToken = findOccupantToken(vehicleToken.parent, occupantActor);
  if (!passengerToken) return;
  seat = await _migrateSeatOffsetOrigin(vehicleToken.actor, vehicleToken, seat);
  const target = _seatTarget(vehicleToken, passengerToken, seat);
  _log('snapOccupantToSeat', occupantActor.name, 'vehicle at', { x: vehicleToken.x, y: vehicleToken.y, rotation: vehicleToken.rotation }, 'target', target);
  if (_sameTarget(passengerToken, target)) return;
  // animate: false — teleport, don't glide, once we've committed to a
  // target. Gliding is fine for the vehicle itself; it's not fine for a
  // passenger snapping onto a seat offset, which should read as "attached",
  // not "walking over".
  await passengerToken.update(target, { cprVehicleCrew: true, animate: false });
}

/** Moves every occupant of `vehicleActor` to its *current* seat targets. */
async function _followNow(vehicleActorId, sceneId) {
  const scene = game.scenes.get(sceneId);
  const liveVehicleToken = scene?.tokens.find((t) => t.actorId === vehicleActorId);
  if (!liveVehicleToken) return;

  _log('_followNow executing, live vehicle token at', {
    x: liveVehicleToken.x,
    y: liveVehicleToken.y,
    rotation: liveVehicleToken.rotation,
    sort: liveVehicleToken.sort,
  });

  const updates = [];
  for (let seat of getSeats(liveVehicleToken.actor)) {
    if (!seat.occupantUuid) continue;
    const occupantActor = await fromUuid(seat.occupantUuid);
    const passengerToken = occupantActor && findOccupantToken(scene, occupantActor);
    if (!passengerToken) continue;

    seat = await _migrateSeatOffsetOrigin(liveVehicleToken.actor, liveVehicleToken, seat);
    const target = _seatTarget(liveVehicleToken, passengerToken, seat);
    _log('seat', seat.label, 'occupant', occupantActor.name, 'currently at', { x: passengerToken.x, y: passengerToken.y, rotation: passengerToken.rotation }, 'target', target);
    if (_sameTarget(passengerToken, target)) continue;
    updates.push({ _id: passengerToken.id, ...target });
  }
  _log('writing updates', updates);
  if (updates.length) {
    await scene.updateEmbeddedDocuments('Token', updates, { cprVehicleCrew: true, animate: false });
  }
}

/**
 * Waits until `tokenDoc.x/y/rotation` reports the same values for
 * STABLE_CHECKS_REQUIRED consecutive polls (i.e. the drag/glide/turn has
 * genuinely stopped changing the document, not just "some time has passed"),
 * then runs the follow-update. Starting a new wait for the same token id
 * bumps its generation, so an older still-running wait notices it's been
 * superseded and quietly gives up instead of firing a stale follow-update.
 */
async function _followWhenSettled(tokenDoc) {
  const key = tokenDoc.id;
  const myGeneration = (followGeneration.get(key) ?? 0) + 1;
  followGeneration.set(key, myGeneration);

  let last = { x: tokenDoc.x, y: tokenDoc.y, rotation: tokenDoc.rotation };
  let stableCount = 0;
  const start = performance.now();

  while (performance.now() - start < SETTLE_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    if (followGeneration.get(key) !== myGeneration) {
      _log('settle-wait superseded for', key);
      return;
    }
    const current = { x: tokenDoc.x, y: tokenDoc.y, rotation: tokenDoc.rotation };
    const unchanged = current.x === last.x && current.y === last.y && current.rotation === last.rotation;
    _log('settle-check', current, unchanged ? `stable (${stableCount + 1}/${STABLE_CHECKS_REQUIRED})` : 'still moving');
    if (unchanged) {
      stableCount += 1;
      if (stableCount >= STABLE_CHECKS_REQUIRED) break;
    } else {
      stableCount = 0;
      last = current;
    }
  }

  if (followGeneration.get(key) !== myGeneration) return;
  await _followNow(tokenDoc.actorId, tokenDoc.parent.id);
}

export function registerTokenFollowHooks() {
  Hooks.on('updateToken', (tokenDoc, changes, options) => {
    if (tokenDoc.actor?.type === VEHICLE_TYPE) {
      _log(
        'updateToken for vehicle',
        tokenDoc.id,
        'changes.x/y/rotation',
        { x: changes.x, y: changes.y, rotation: changes.rotation },
        'doc now at',
        { x: tokenDoc.x, y: tokenDoc.y, rotation: tokenDoc.rotation },
        'options',
        { ...options }
      );
    }

    if (options.cprVehicleCrew) return;
    if (tokenDoc.actor?.type !== VEHICLE_TYPE) return;
    if (!('x' in changes) && !('y' in changes) && !('rotation' in changes)) return;

    // Single writer: only the GM client applies the follow-update, so two
    // GM-permission clients never both fire it for the same move. Means
    // this only works while a GM is connected — acceptable, VAS's own
    // hooks carry the same isGM gate throughout.
    if (!game.user.isGM) {
      _log('skipping, not GM');
      return;
    }

    _followWhenSettled(tokenDoc);
  });

  Hooks.on('deleteToken', (tokenDoc) => followGeneration.delete(tokenDoc.id));
}
