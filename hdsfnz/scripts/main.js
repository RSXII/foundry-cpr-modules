import { MODULE_ID, CHARACTER_TYPE, GEAR_TYPE, isHudEnabledOnScene } from './data.js';
import { HdsfnzCharacterData, HdsfnzGearData } from './data-models.js';
import { registerActorSheet } from './actor-sheet.js';
import { registerHudHooks } from './hud.js';

const CONTROL_LAYER_NAME = 'hdsfnzLayer';

// The HDSFNZ control group has no real canvas tool of its own, only the
// per-scene HUD toggle — Foundry's scene-control click handler only
// re-renders the toolbar when the click causes a genuine layer transition,
// so this registers a real (if empty) layer for the group to target. Same
// pattern as cpr-twins-ai's CprTwinsAiLayer.
class HdsfnzLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }
}

Hooks.once('init', () => {
  // module.json declares the bare sub-type names ("character", "gear");
  // Foundry namespaces them to <module-id>.<type> for every other purpose,
  // which is the key these get registered under here.
  CONFIG.Actor.dataModels[CHARACTER_TYPE] = HdsfnzCharacterData;
  CONFIG.Actor.typeLabels[CHARACTER_TYPE] = 'HDSFNZ Character';
  CONFIG.Item.dataModels[GEAR_TYPE] = HdsfnzGearData;
  CONFIG.Item.typeLabels[GEAR_TYPE] = 'HDSFNZ Gear';

  registerActorSheet();

  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = { layerClass: HdsfnzLayer, group: 'interface' };

  loadTemplates([`modules/${MODULE_ID}/templates/hud.hbs`]);

  registerHudHooks();
});

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const group = {
    name: MODULE_ID,
    title: 'HDSFNZ HUD',
    icon: 'fa-solid fa-tv',
    layer: CONTROL_LAYER_NAME,
    tools: [
      {
        name: 'toggle-hud',
        title: 'Show the HDSFNZ HUD on this scene (all clients)',
        icon: 'fa-solid fa-tv',
        toggle: true,
        active: isHudEnabledOnScene(canvas.scene),
        onClick: (active) => canvas.scene?.setFlag(MODULE_ID, 'hudEnabled', active),
      },
    ],
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});

// Keeps the toggle's own visual in sync when the flag changes some other
// way (a second GM client, or navigating to a different scene).
Hooks.on('canvasReady', () => {
  if (game.user.isGM) ui.controls.render();
});
