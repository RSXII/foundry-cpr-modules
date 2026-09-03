// Flags/settings read/write layer. Nothing outside this file should touch
// the "cpr-twins-ai" flag scope or its world setting directly — keeps
// the eligibility flag, the per-token control state, and the ownership
// writes that back it all consistent in one place.

export const MODULE_ID = 'cpr-twins-ai';

export const OWNERSHIP = { NONE: 0, OBSERVER: 2, OWNER: 3 };

// CPR's own actor type string for mooks, confirmed against a real world by
// ../cpr-relations/scripts/data.js. The vehicle type is a module-namespaced
// subtype registered by cyberpunk-red-vehicles (see
// ../cpr-vehicle-crew/scripts/data.js) — checked by string only, so this
// module works fine without that one installed, it just never matches.
const MOOK_TYPE = 'mook';
const VEHICLE_TYPE = 'cyberpunk-red-vehicles.vehicle';

export function isTakeableType(actor) {
  return actor?.type === MOOK_TYPE || actor?.type === VEHICLE_TYPE;
}

/**
 * Whether the GM has flagged this actor as player-takeable at all.
 * Actor-level by design — it's a template property ("this kind of
 * mook/vehicle may be taken"), not the live per-token control state. No
 * setter here: the sheet checkbox is bound directly to this flag path and
 * written by the sheet's own form submission, same as
 * ../cpr-ambient-restart's Restart-on-Load checkbox.
 */
export function isTakeable(actor) {
  return !!actor?.getFlag(MODULE_ID, 'takeable');
}

export function isModeEnabled() {
  return !!game.settings.get(MODULE_ID, 'modeEnabled');
}

/** The id of the user currently controlling `tokenDoc`, or null if unclaimed. Stored on the token, not the actor — see grantControl(). */
export function controllerOf(tokenDoc) {
  return tokenDoc?.getFlag(MODULE_ID, 'controlledBy') ?? null;
}

/** Every token on `scene` currently claimed by a player — what the Active Links tracker counts. */
export function claimedTokensOnScene(scene = canvas.scene) {
  return scene?.tokens?.filter((t) => controllerOf(t)) ?? [];
}

/**
 * Grants `userId` ownership of this one token — never the shared actor.
 * Mooks are normally unlinked (actorLink: false): each token has its own
 * `ownership` override precisely so instances of the same "Ganger" actor
 * can carry independent permissions, which is exactly what per-token
 * take-control needs. Vehicles are normally linked (actorLink: true), for
 * which Foundry ignores TokenDocument#ownership entirely and permission
 * flows from the actor instead — so a linked token has to grant on the
 * actor. In practice that's still "just this token" since a linked vehicle
 * actor is placed as one token; if a GM duplicates a linked token, granting
 * follows Foundry's own definition of "linked" (they're the same actor by
 * design) rather than this module inventing a workaround for it.
 *
 * Deliberately does not touch prototypeToken.ownership — this grant is
 * meant to be a one-off, revocable claim, not a template change that would
 * make future-placed tokens of this actor spawn pre-owned.
 */
export async function grantControl(tokenDoc, userId) {
  if (!game.user.isGM) return;
  if (tokenDoc.actorLink) {
    await tokenDoc.actor.update({ [`ownership.${userId}`]: OWNERSHIP.OWNER });
    await tokenDoc.setFlag(MODULE_ID, 'controlledBy', userId);
  } else {
    // A bracketed dotted-path key ("ownership.<id>": level) bundled into
    // the same update() call as a flags write is the pattern the linked
    // branch above uses successfully on the actor — but confirmed against
    // a real world, it silently no-ops for TokenDocument#ownership
    // specifically: the flags half of that same call lands (driving the
    // UI and the GM's release button), the ownership half doesn't, so the
    // player never actually gets usable permission. Building the full
    // ownership object explicitly and writing it as one plain value
    // sidesteps whatever's dropping the partial-path merge on this field.
    const ownership = { ...tokenDoc.ownership, [userId]: OWNERSHIP.OWNER };
    await tokenDoc.update({ ownership, [`flags.${MODULE_ID}.controlledBy`]: userId });
    // Also grant on the synthetic per-token actor (writes through to this
    // token's own ActorDelta, not the shared base actor, so it can't leak
    // to other tokens of the same actor) in case sheet-open permission
    // reads the actor's own ownership record instead of the token's.
    if (tokenDoc.actor) {
      const actorOwnership = { ...tokenDoc.actor.ownership, [userId]: OWNERSHIP.OWNER };
      await tokenDoc.actor.update({ ownership: actorOwnership });
    }
  }
}

/** Inverse of grantControl(): resets ownership for the current controller and clears the claim, freeing the token back up. No-op if nobody currently controls it. */
export async function releaseControl(tokenDoc) {
  if (!game.user.isGM) return;
  const userId = controllerOf(tokenDoc);
  if (!userId) return;
  if (tokenDoc.actorLink) {
    await tokenDoc.actor.update({ [`ownership.${userId}`]: OWNERSHIP.NONE });
    await tokenDoc.unsetFlag(MODULE_ID, 'controlledBy');
  } else {
    const ownership = { ...tokenDoc.ownership, [userId]: OWNERSHIP.NONE };
    await tokenDoc.update({ ownership, [`flags.${MODULE_ID}.-=controlledBy`]: null });
    if (tokenDoc.actor) {
      const actorOwnership = { ...tokenDoc.actor.ownership, [userId]: OWNERSHIP.NONE };
      await tokenDoc.actor.update({ ownership: actorOwnership });
    }
  }
}
