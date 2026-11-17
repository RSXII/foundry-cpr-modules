// CPR VN Stage module
//
// Visual-novel style character stands. The GM right-clicks an actor in the
// sidebar -> "Add to Scene (VN)", which puts it on a small floating dock;
// clicking that dock icon previews the actor's default stand privately (GM
// only), and a separate broadcast icon pushes it live for players. See
// data.js's header comment for exactly how the GM-only preview state is
// kept from ever reaching a player's client, and stage-overlay.js for the
// HUD itself.

import { registerSettings } from './data.js';
import { registerActorContextMenu } from './actor-context.js';
import { initOverlay } from './stage-overlay.js';

const MODULE_ID = 'cpr-vn-stage';

Hooks.once('init', () => {
  registerSettings();
  loadTemplates([`modules/${MODULE_ID}/templates/setup-app.hbs`]);
});

Hooks.once('ready', () => {
  initOverlay();
});

registerActorContextMenu();
