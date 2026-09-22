import { MODULE_ID } from './data.js';
import { registerQuickInfoHud, setEnabled, isEnabled } from './hud.js';
import { registerRevealToggle } from './token-hud.js';

// Public API for other modules/macros to drive this module's on/off state
// (see hud.js — off by default, no UI of its own to flip it). Set during
// init, not ready: every module's init hook has already run by the time any
// module's ready hook fires, so a consumer calling this from its own ready
// hook (e.g. cpr-twins-ai) never races the api's own availability regardless
// of module load order.
Hooks.once('init', () => {
  game.modules.get(MODULE_ID).api = {
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
    isEnabled,
  };
});

Hooks.once('ready', () => {
  registerQuickInfoHud();
  registerRevealToggle();
});
