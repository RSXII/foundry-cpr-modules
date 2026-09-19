import { MODULE_ID, isModeEnabled } from './data.js';
import { registerSheetInjectorHooks } from './sheet-injector.js';
import { registerOverlayHooks } from './overlay.js';
import { registerSocketHooks } from './socket.js';
import { registerIntrusionHooks, triggerIntrusion } from './netrunner-intrusion.js';
import { registerBlackIceIntrusionHooks, triggerBlackIceIntrusion } from './blackice-intrusion.js';
import { registerCacheCorruptionHooks, triggerCacheCorruption } from './cache-corruption.js';
import { registerUnknownIntrusionHooks, triggerUnknownIntrusion } from './unknown-intrusion.js';
import { registerBuiltinTerminalCommands } from './terminal-commands.js';
import { registerChromeEffectHooks } from './chrome-effects.js';
import { visionEffect } from './vision-effect.js';

const CONTROL_LAYER_NAME = 'cprTwinsAiLayer';

// Optional pairing, not a hard dependency — cpr-quick-info starts disabled
// with no toggle of its own (see its main.js) and expects something else to
// drive it. Rogue AI Vision is "the AI is scanning the room for you," so
// the AI also handing over at-a-glance target info while that's on is the
// same beat; this just reaches for the other module's api if it's active
// and no-ops otherwise, the same guard style as weapon-shooter.js's check
// for cyberpunk-red-vehicles.
const QUICK_INFO_MODULE_ID = 'cpr-quick-info';

function syncQuickInfoHud(enabled) {
  const api = game.modules.get(QUICK_INFO_MODULE_ID)?.api;
  if (!api) return;
  if (enabled) api.enable();
  else api.disable();
}

// The scene-control group below has no real canvas tool of its own, only
// the mode toggle — Foundry's scene-control click handler only re-renders
// the toolbar when the click causes a genuine layer transition. Registering
// a real (if empty) layer for the group to target guarantees that. Same
// pattern as ../cpr-terminal's CprTerminalLayer and
// ../cpr-ambient-restart's CprAmbientRestartLayer.
class CprTwinsAiLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'modeEnabled', {
    name: 'Allow players to take control of eligible tokens',
    hint: 'While on, players see a "Take Control" prompt above tokens flagged Player-Takeable on their actor sheet, and every connected client gets the Rogue AI Vision screen effect.',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  });

  // World-scoped like modeEnabled, for the same reason: every client needs
  // to agree on this without a relay message, and Foundry already syncs a
  // world setting's changes to everyone on its own. See cache-corruption.js.
  game.settings.register(MODULE_ID, 'cacheCorrupted', {
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  });

  // Client-scoped, not world: the HUD already scales itself automatically
  // off the canvas panel's actual on-screen size (no fixed breakpoints —
  // see vision-effect.js's _layout()), but "actual size in CSS px" still
  // can't fully infer what reads as legible on a display neither of us can
  // see from here. This is the manual correction on top of that automatic
  // scaling, and it's per-client because two players at the same table can
  // be on very different monitors.
  game.settings.register(MODULE_ID, 'hudScale', {
    name: 'Rogue AI Vision — HUD scale',
    hint: 'Multiplier on top of the automatic canvas-size scaling. Turn this up if the HUD text is still too small on your display, or down if it\'s too large. 1 = automatic sizing only.',
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0.5, max: 2.5, step: 0.05 },
    default: 1,
    onChange: () => visionEffect.relayout(),
  });

  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = {
    layerClass: CprTwinsAiLayer,
    group: 'interface',
  };

  registerSheetInjectorHooks();
  registerOverlayHooks();
  registerSocketHooks();
  registerIntrusionHooks();
  registerBlackIceIntrusionHooks();
  registerCacheCorruptionHooks();
  registerUnknownIntrusionHooks();
  registerBuiltinTerminalCommands();
  registerChromeEffectHooks();
});

// Mounts/tears down the full-screen vision effect to match the setting —
// covers both a live toggle and a client that connects/reloads while the
// mode is already on.
Hooks.once('ready', () => {
  if (isModeEnabled()) visionEffect.mount();
  syncQuickInfoHud(isModeEnabled());
});

Hooks.on('canvasReady', () => visionEffect.refreshChips());
Hooks.on('createToken', () => visionEffect.refreshChips());
Hooks.on('deleteToken', () => visionEffect.refreshChips());

// A grant/release lands via a normal document update, which every client
// (including the claimant) receives through this hook:
// - A new claim plays the hijack flourish for everyone watching, and the
//   claimant auto-selects their new token as visible confirmation.
//   Deliberately exclusive (releaseOthers: true, control()'s own default)
//   rather than additive: additive selection accumulates every token a
//   player has ever claimed into one forced multi-selection over a
//   session, and a player has no way to click a token they don't yet
//   control to whittle it back down — they'd be stuck dragging the whole
//   group until they cycled tools. Exclusive selection can never
//   accumulate, at the minor cost of dropping whatever was selected the
//   instant before the claim landed.
// - Any other flags/ownership change (a release, most likely) just
//   refreshes the Active Links count.
Hooks.on('updateToken', (tokenDoc, changes) => {
  const claimedBy = changes.flags?.[MODULE_ID]?.controlledBy;
  if (typeof claimedBy === 'string') {
    visionEffect.playHijack(tokenDoc);
    if (claimedBy === game.user.id) {
      const token = canvas.tokens?.get(tokenDoc.id);
      if (token) token.control({ releaseOthers: true });
    }
  } else if ('flags' in changes || 'ownership' in changes) {
    visionEffect.refreshChips();
  }
});

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const group = {
    name: MODULE_ID,
    title: 'CPR Twins AI',
    icon: 'fa-solid fa-user-group',
    layer: CONTROL_LAYER_NAME,
    tools: [
      {
        name: 'toggle-mode',
        title: 'Allow players to take control of eligible tokens',
        icon: 'fa-solid fa-hand-point-up',
        toggle: true,
        active: isModeEnabled(),
        onClick: (active) => game.settings.set(MODULE_ID, 'modeEnabled', active),
      },
      // Momentary action, not a toggle (button:true, no active/state) — the
      // GM picking the moment themselves, on purpose, replacing what used
      // to be a random timer. triggerIntrusion() itself no-ops with a
      // warning if the mode's off or one's already running.
      {
        name: 'trigger-intrusion',
        title: 'Trigger Netrunner Intrusion',
        icon: 'fa-solid fa-user-secret',
        button: true,
        onClick: () => triggerIntrusion(),
      },
      {
        name: 'trigger-blackice',
        title: 'Trigger Black Ice Intrusion',
        icon: 'fa-solid fa-shield-halved',
        button: true,
        onClick: () => triggerBlackIceIntrusion(),
      },
      {
        name: 'trigger-cache-corruption',
        title: 'Trigger Cache Corruption',
        icon: 'fa-solid fa-microchip',
        button: true,
        onClick: () => triggerCacheCorruption(),
      },
      {
        name: 'trigger-unknown',
        title: 'Trigger Unknown Intrusion',
        icon: 'fa-solid fa-circle-question',
        button: true,
        onClick: () => triggerUnknownIntrusion(),
      },
      // For clearing up some local glitch on this client without making
      // everyone sit through the ~10s cinematic pre-roll again — mount()
      // itself only skips the boot sequence when explicitly told to
      // (skipBoot), every other caller of it still gets the normal one.
      {
        name: 'restart-vision-skip-boot',
        title: 'Restart Vision (Skip Animation)',
        icon: 'fa-solid fa-rotate-right',
        button: true,
        onClick: () => {
          if (!isModeEnabled()) {
            ui.notifications.warn('Turn on the Rogue AI Vision mode first.');
            return;
          }
          visionEffect.destroy();
          visionEffect.mount({ skipBoot: true });
        },
      },
    ],
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});

// Keeps the toggle's on/off visual in sync (e.g. a second GM client) and
// mounts/tears down the vision effect for this client to match.
Hooks.on('updateSetting', (setting) => {
  if (setting.key !== `${MODULE_ID}.modeEnabled`) return;
  if (isModeEnabled()) visionEffect.mount();
  else visionEffect.destroy();
  syncQuickInfoHud(isModeEnabled());
  if (game.user.isGM) ui.controls.render();
});
