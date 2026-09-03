import { registerSheetInjectorHooks } from './sheet-injector.js';
import { registerTokenFollowHooks } from './token-follow.js';

Hooks.once('init', () => {
  registerSheetInjectorHooks();
  registerTokenFollowHooks();
});
