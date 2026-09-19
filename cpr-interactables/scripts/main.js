import { MODULE_ID } from './data.js';
import { HotspotLayer, CONTROL_LAYER_NAME, registerHotspotLayerHooks } from './layer.js';
import { registerProximityHooks, tryInteract } from './proximity.js';

Hooks.once('init', () => {
  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = { layerClass: HotspotLayer, group: 'interface' };

  game.keybindings.register(MODULE_ID, 'interact', {
    name: 'Interact',
    hint: 'Interacts with a nearby hotspot (e.g. reads a poster on a wall). Only fires when a hotspot is in range.',
    editable: [{ key: 'KeyE' }],
    onDown: () => tryInteract(),
    restricted: false,
  });

  registerHotspotLayerHooks();
  registerProximityHooks();
});

// Placement/editing is GM-only — players never see this control group, the
// same way they never see the trigger zones themselves (layer.js only shows
// markers while this group's layer is active).
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const group = {
    name: MODULE_ID,
    title: 'Interactables',
    icon: 'fa-solid fa-image',
    layer: CONTROL_LAYER_NAME,
    activeTool: 'select',
    tools: [
      {
        name: 'select',
        title: 'Select / Edit Hotspots',
        icon: 'fa-solid fa-arrow-pointer',
      },
      {
        name: 'place',
        title: 'Place New Hotspot (click the map)',
        icon: 'fa-solid fa-location-crosshairs',
      },
    ],
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});
