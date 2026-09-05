// Patches cyberpunk-red-vehicles' CPRVehicleActor so mounted-weapon attacks
// resolve their shooter from crew seats instead of always asking "who's
// firing" from the full owned-actor list.
//
// Resolution order, per shot:
//   1 seat occupied  -> that occupant fires, no prompt.
//   2+ seats occupied -> prompt, scoped to just the seated crew.
//   0 seats occupied, vehicle marked autonomous -> the vehicle's own
//     autopilot actor fires (created lazily; see getOrCreateAutopilotActor).
//   0 seats occupied, not autonomous -> falls back to the original
//     module's own actor picker (unchanged behavior).
import {
  getSeats,
  isAutonomous,
  getOrCreateAutopilotActor,
  ensureAutopilotSkill,
} from './data.js';

const VEHICLES_MODULE_ID = 'cyberpunk-red-vehicles';

function _resolveOccupantActor(seat) {
  if (!seat.occupantUuid) return null;
  try {
    return fromUuidSync(seat.occupantUuid);
  } catch (e) {
    return null;
  }
}

function _promptCrewSelection(occupants) {
  return new Promise((resolve) => {
    const options = occupants
      .map((a) => `<option value="${a.uuid}">${a.name}</option>`)
      .join('');
    new Dialog({
      title: 'Who is firing?',
      content: `
        <form>
          <div class="form-group">
            <label>Crew member</label>
            <select name="occupantUuid">${options}</select>
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: 'Confirm',
          callback: (html) => {
            const uuid = html.find("select[name='occupantUuid']").val();
            resolve(occupants.find((a) => a.uuid === uuid) ?? null);
          },
        },
        cancel: { label: 'Cancel', callback: () => resolve(null) },
      },
      default: 'confirm',
      close: () => resolve(null),
    }).render(true);
  });
}

/**
 * Wires the patch. Called once, after both cyberpunk-red-vehicles and this
 * module have initialized, since it needs CPRVehicleActor to already exist.
 */
export async function registerWeaponShooterPatch() {
  if (!game.modules.get(VEHICLES_MODULE_ID)?.active) return;

  const mod = await import(`/modules/${VEHICLES_MODULE_ID}/scripts/vehicle-actor.js`);
  const CPRVehicleActor = mod.default;
  if (!CPRVehicleActor?.prototype?._resolveVehicleAttackActor) {
    console.warn(
      'cpr-vehicle-crew | cyberpunk-red-vehicles actor shape changed, skipping crew-aware shooter patch'
    );
    return;
  }

  const originalResolve = CPRVehicleActor.prototype._resolveVehicleAttackActor;
  const originalRoll = CPRVehicleActor.prototype.rollVehicleWeaponAttack;

  // rollVehicleWeaponAttack doesn't pass itemId down to
  // _resolveVehicleAttackActor(), but the autopilot needs to know which
  // weapon/fire mode it's about to roll so it can seed the right skill.
  // Stash it on the instance for the duration of the call instead of
  // reimplementing the whole roll/guard/chat-card pipeline here.
  CPRVehicleActor.prototype.rollVehicleWeaponAttack = async function patchedRollVehicleWeaponAttack(
    itemId,
    eventContext = {}
  ) {
    this.__cprCrewPendingItemId = itemId;
    try {
      return await originalRoll.call(this, itemId, eventContext);
    } finally {
      this.__cprCrewPendingItemId = null;
    }
  };

  CPRVehicleActor.prototype._resolveVehicleAttackActor = async function patchedResolveVehicleAttackActor() {
    const seats = getSeats(this);
    const occupants = seats.map(_resolveOccupantActor).filter(Boolean);

    if (occupants.length === 1) return occupants[0];
    if (occupants.length > 1) return _promptCrewSelection(occupants);

    if (isAutonomous(this)) {
      const autopilot = await getOrCreateAutopilotActor(this);
      if (!autopilot) {
        ui.notifications.warn(
          `${this.name} is autonomous but its autopilot actor hasn't been created yet. Ask your GM to fire this weapon once to set it up.`
        );
        return null;
      }
      const itemId = this.__cprCrewPendingItemId;
      const weapon = itemId ? this._getMountedWeaponItem(itemId) : null;
      // _getRequiredSkillNameForFireMode() comes from the local crash-guard
      // patch on the installed cyberpunk-red-vehicles module, not this repo
      // — guard in case that patch is missing (e.g. module got reinstalled).
      if (weapon && typeof this._getRequiredSkillNameForFireMode === 'function') {
        const fireMode = this._getWeaponFireMode(itemId);
        const requiredSkill = this._getRequiredSkillNameForFireMode(weapon, fireMode);
        await ensureAutopilotSkill(autopilot, requiredSkill);
      }
      return autopilot;
    }

    return originalResolve.call(this);
  };

  console.log('cpr-vehicle-crew | Crew-aware weapon shooter patch applied');
}
