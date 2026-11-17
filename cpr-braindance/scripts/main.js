// CPR Braindance module
//
// A full-screen "entering a Braindance" transition: clamp arms close in on
// the viewer from the screen edges, a neural-link flash hits, and a
// flickering loading HUD holds the screen — covering whatever the GM does
// next (typically activating a different scene) — until the GM releases it
// and it fades away. The actual animation lives in overlay.js, which is
// pure presentation; this file owns triggering it on every connected
// client and exposing that as a scene-control button plus a macro API.
//
// Broadcasting the trigger rides a world-scoped Setting, not a raw
// game.socket.emit() custom event — ../cpr-twins-ai/scripts/socket.js
// documents why: a real self-hosted Foundry server tested during that
// project's development wasn't reliably relaying custom module-namespaced
// socket events between clients at all, while Foundry's own core
// document/setting sync worked fine over the same connection. A Setting
// (synced the same way a world setting like cpr-twins-ai's own
// `modeEnabled`/`cacheCorrupted` already is) sidesteps that without the
// chat-log flash-and-delete trick ChatMessage-based broadcasts need.

import { braindanceOverlay } from './overlay.js';

const MODULE_ID = 'cpr-braindance';
const TRIGGER_SETTING = 'trigger';
const CONTROL_LAYER_NAME = 'cprBraindanceLayer';

// The scene-control group below has no real canvas tool of its own, only
// action buttons — Foundry's scene-control click handler only re-renders
// the toolbar (and fires onClick) when the click causes a genuine layer
// transition. Registering a real (if empty) layer for the group to target
// guarantees that. Same pattern as ../cpr-terminal's CprTerminalLayer,
// ../cpr-ambient-restart's CprAmbientRestartLayer, and
// ../cpr-twins-ai's CprTwinsAiLayer.
class CprBraindanceLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }
}

// Tracks the last trigger this client has already acted on, so loading the
// world (which reads the setting's current value once) doesn't replay
// whatever the most recent phase happened to be — only an actual *change*
// (a new nonce) should ever play an animation. Same "ignore the initial
// read, react only to updates" shape as ../cpr-incoming-call's state
// machine reacting only to new createChatMessage events, not chat history.
let lastAppliedNonce = null;

function currentTrigger() {
  return game.settings.get(MODULE_ID, TRIGGER_SETTING) ?? { nonce: 0, phase: 'idle' };
}

/** GM-only: bumps the trigger to a new phase, which every connected client (including this one) picks up via the updateSetting hook below. */
async function broadcastPhase(phase) {
  if (!game.user.isGM) {
    ui.notifications.warn('Only the GM can trigger the Braindance transition.');
    return;
  }
  const nonce = currentTrigger().nonce + 1;
  lastAppliedNonce = nonce; // this client plays it directly below; don't double-apply when our own setting update echoes back
  await game.settings.set(MODULE_ID, TRIGGER_SETTING, { nonce, phase, ts: Date.now() });
  if (phase === 'enter') await braindanceOverlay.playEnter();
  else if (phase === 'exit') await braindanceOverlay.playExit();
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, TRIGGER_SETTING, {
    scope: 'world',
    config: false,
    type: Object,
    default: { nonce: 0, phase: 'idle' },
  });

  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = {
    layerClass: CprBraindanceLayer,
    group: 'interface',
  };

  // Macro-friendly surface. `enter`/`exit` give a GM script manual control
  // over pacing (e.g. activate a scene partway through the hold, however
  // long that actually takes); `playTransition` is the convenience wrapper
  // for the common case — enter, run the provided swap, hold a minimum
  // beat, exit.
  game.modules.get(MODULE_ID).api = {
    enter: () => broadcastPhase('enter'),
    exit: () => broadcastPhase('exit'),
    async playTransition(swapFn, { minHoldMs = 1200 } = {}) {
      await broadcastPhase('enter');
      const swapPromise = swapFn ? Promise.resolve().then(swapFn) : Promise.resolve();
      await Promise.all([swapPromise, new Promise((resolve) => setTimeout(resolve, minHoldMs))]);
      await broadcastPhase('exit');
    },
  };
});

// Every client (GM and players alike) reacts to a changed trigger — this is
// what makes a GM's click play the transition for the whole table, not just
// their own screen.
Hooks.once('ready', () => {
  lastAppliedNonce = currentTrigger().nonce;
});

Hooks.on('updateSetting', (setting) => {
  if (setting.key !== `${MODULE_ID}.${TRIGGER_SETTING}`) return;
  // Re-read via the settings API rather than trusting the hook payload
  // shape directly — same choice ../cpr-twins-ai/scripts/main.js makes for
  // its own updateSetting handler.
  const value = currentTrigger();
  if (value.nonce === lastAppliedNonce) return;
  lastAppliedNonce = value.nonce;
  if (value.phase === 'enter') braindanceOverlay.playEnter();
  else if (value.phase === 'exit') braindanceOverlay.playExit();
});

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const group = {
    name: MODULE_ID,
    title: 'CPR Braindance',
    icon: 'fa-solid fa-brain',
    layer: CONTROL_LAYER_NAME,
    tools: [
      {
        name: 'enter',
        title: 'Start Braindance Transition (all clients)',
        icon: 'fa-solid fa-brain',
        button: true,
        onClick: () => broadcastPhase('enter'),
      },
      {
        name: 'exit',
        title: 'Dismiss Braindance Transition (all clients)',
        icon: 'fa-solid fa-xmark',
        button: true,
        onClick: () => broadcastPhase('exit'),
      },
    ],
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});
