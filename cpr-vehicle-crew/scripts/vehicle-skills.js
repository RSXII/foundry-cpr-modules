// Fixes the "Weapon Skill" dropdown being permanently empty for any weapon
// item owned by a vehicle actor.
//
// Root cause: cyberpunk-red-core's item sheet builds that dropdown from
// `owningActor.itemTypes.skill` whenever the weapon is owned by any actor
// (cpr-item-sheet.js getData()). CPRVehicleActor.create() deliberately
// skips the core-skill injection every character/mook gets (vehicles don't
// roll skills themselves), so a vehicle-owned weapon's dropdown always has
// zero options — and because item sheets submit on close, just opening and
// closing it writes that blank selection back, silently erasing whatever
// weaponSkill was set before the item was ever dragged into the vehicle.
//
// Fixed at the source: when the owning actor is a vehicle, fall back to the
// same compendium + world-skill-item list the sheet already uses for
// unowned weapons, instead of the (always empty) vehicle's own skill list.
// This does NOT add anything to the vehicle's own item collection — an
// earlier version of this file tried seeding the vehicle with core skill
// items instead, which fixed the dropdown but dumped ~40 skill items into
// the vehicle's Trunk display. cleanupSeededVehicleSkills() below removes
// any leftovers from that.
import { isVehicle } from './data.js';

const CORE_SYSTEM_ID = 'cyberpunk-red-core';

export async function registerVehicleWeaponSkillDropdownPatch() {
  const sheetMod = await import(
    `/systems/${CORE_SYSTEM_ID}/modules/item/sheet/cpr-item-sheet.js`
  );
  const CPRItemSheet = sheetMod.default;
  const utilsMod = await import(
    `/systems/${CORE_SYSTEM_ID}/modules/utils/cpr-systemUtils.js`
  );
  const SystemUtils = utilsMod.default;

  const originalGetData = CPRItemSheet.prototype.getData;
  CPRItemSheet.prototype.getData = async function patchedGetData(...args) {
    const cprData = await originalGetData.call(this, ...args);
    const owner = this.object?.actor;
    if (owner && isVehicle(owner) && cprData.weaponSkillSelectOptions !== undefined) {
      const coreSkills = await SystemUtils.GetCoreSkills();
      const worldSkills = game.items.filter((i) => i.type === 'skill');
      cprData.relativeSkills = coreSkills.concat(worldSkills);
      cprData.weaponSkillSelectOptions = CPRItemSheet._getWeaponSkillSelectOptions(
        cprData.relativeSkills
      );
    }
    return cprData;
  };
}

/** One-time cleanup for vehicles that got skill items dumped into their Trunk by an earlier version of this fix. */
export async function cleanupSeededVehicleSkills() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    if (!isVehicle(actor)) continue;
    const skillItemIds = (actor.itemTypes?.skill ?? []).map((i) => i.id);
    if (skillItemIds.length === 0) continue;
    console.log(
      `cpr-vehicle-crew | Removing ${skillItemIds.length} stray skill item(s) from vehicle "${actor.name}"`
    );
    await actor.deleteEmbeddedDocuments('Item', skillItemIds);
  }
}
