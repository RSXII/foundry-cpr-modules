import { registerSheetInjectorHooks } from './sheet-injector.js';
import { registerAttackSoundHooks } from './attack-sound.js';

Hooks.once('init', () => {
  registerSheetInjectorHooks();
  registerAttackSoundHooks();
});
