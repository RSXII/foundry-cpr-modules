import { OWNERSHIP, getActorOwner } from './data.js';

// Replaces VAS's automatic reconcilePermissions/Active Effects sync — the
// GM sets this by hand per seat instead of it being computed from seat
// flags (canControlWeapons, grantsTokenControl, etc). "Owner" grants both
// sheet access and token control in one step since in practice a player
// who can't drag the vehicle token has no use for edit access to it.
export const ACCESS_LEVELS = {
  none: { actor: OWNERSHIP.NONE, token: OWNERSHIP.NONE },
  observer: { actor: OWNERSHIP.OBSERVER, token: OWNERSHIP.NONE },
  owner: { actor: OWNERSHIP.OWNER, token: OWNERSHIP.OWNER },
};

export function accessLevelFor(vehicleActor, occupantActor) {
  const user = getActorOwner(occupantActor);
  if (!user) return null;
  const level = vehicleActor.ownership?.[user.id] ?? OWNERSHIP.NONE;
  if (level >= OWNERSHIP.OWNER) return 'owner';
  if (level >= OWNERSHIP.OBSERVER) return 'observer';
  return 'none';
}

/**
 * Sets `occupantActor`'s owning player's access to `vehicleActor` — the
 * actor itself, its prototype token, and any of its tokens on the current
 * scene, all together, so "Owner" actually lets them drag the token they
 * can now also see the sheet for.
 */
export async function setSeatAccess(vehicleActor, occupantActor, levelKey) {
  if (!game.user.isGM) return;
  const user = getActorOwner(occupantActor);
  if (!user) {
    ui.notifications.warn(`No player owns ${occupantActor.name}; nothing to grant access to.`);
    return;
  }
  const level = ACCESS_LEVELS[levelKey];
  if (!level) return;

  await vehicleActor.update({
    [`ownership.${user.id}`]: level.actor,
    [`prototypeToken.ownership.${user.id}`]: level.token,
  });

  const sceneTokens = canvas.scene?.tokens?.filter((t) => t.actorId === vehicleActor.id) ?? [];
  for (const tokenDoc of sceneTokens) {
    if ((tokenDoc.ownership?.[user.id] ?? OWNERSHIP.NONE) !== level.token) {
      await tokenDoc.update({ [`ownership.${user.id}`]: level.token });
    }
  }
}
