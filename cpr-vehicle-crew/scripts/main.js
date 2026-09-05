import { registerSheetInjectorHooks } from './sheet-injector.js';
import { registerTokenFollowHooks } from './token-follow.js';
import { registerWeaponShooterPatch } from './weapon-shooter.js';
import {
  registerVehicleWeaponSkillDropdownPatch,
  cleanupSeededVehicleSkills,
} from './vehicle-skills.js';

Hooks.once('init', () => {
  registerSheetInjectorHooks();
  registerTokenFollowHooks();
});

// Needs cyberpunk-red-vehicles' CPRVehicleActor and cyberpunk-red-core's
// CPRItemSheet to already exist, so this waits until every module's init
// hook has run.
Hooks.once('ready', () => {
  registerWeaponShooterPatch();
  registerVehicleWeaponSkillDropdownPatch();
  cleanupSeededVehicleSkills();
});
