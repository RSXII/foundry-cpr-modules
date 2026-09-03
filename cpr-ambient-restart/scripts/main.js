// CPR Ambient Restart module
//
// An AmbientSound placeable's managed Sound keeps playing continuously in
// the background even while inaudible — AmbientSound#sync() only fades its
// gain in/out (its options are {fade, muffled}, no offset), it never stops
// or replays the track. That's why toggling a sound off/on, or a token
// walking in/out of its radius, resumes mid-track instead of restarting:
// only a full canvas rebuild (a page reload) creates a fresh Sound at
// position 0. This module gives a GM an explicit way to force that same
// fresh start without a reload: an opt-in per-sound flag that fires on
// every canvasReady, plus a manual trigger for mid-session use (e.g. "the
// band kicks off now").

const MODULE_ID = 'cpr-ambient-restart';
const SOCKET = `module.${MODULE_ID}`;
const FLAG = 'restartOnLoad';
const CONTROL_LAYER_NAME = 'cprAmbientRestartLayer';

const READY_POLL_INTERVAL_MS = 150;
const READY_POLL_TIMEOUT_MS = 5000;

// The scene-control tool below has no real canvas tools of its own, only an
// action button — Foundry's scene-control click handler only re-renders the
// toolbar (and fires onClick) when the click causes a genuine layer
// transition. Registering a real (if empty) layer for the group to target
// guarantees that. Same pattern as ../cpr-terminal's CprTerminalLayer.
class CprAmbientRestartLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }
}

/** Ambient Sound placeables on the current scene flagged for restart-on-load. */
function flaggedSounds() {
  return canvas.sounds?.placeables.filter((s) => s.document.getFlag(MODULE_ID, FLAG)) ?? [];
}

/** Polls until `ambientSound`'s managed Sound exists — SoundsLayer's initial autoplay sync doesn't necessarily have it ready the instant canvasReady fires. */
async function waitForSound(ambientSound) {
  const start = performance.now();
  while (!ambientSound.sound && performance.now() - start < READY_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  return ambientSound.sound;
}

/** Stops and replays `ambientSound`'s managed Sound from position 0, on the same Sound instance — so whatever effect chain applyEffects() wired up (e.g. the Muffled/Reverb special effect) stays attached rather than needing to be recreated. */
async function restartFromBeginning(ambientSound) {
  const sound = await waitForSound(ambientSound);
  if (!sound) return;
  try {
    const volume = sound.volume ?? ambientSound.document.volume ?? 1;
    await sound.stop({ fade: 0 });
    await sound.play({ volume, loop: true, offset: 0, fade: 0 });
  } catch (err) {
    console.error(`${MODULE_ID} | failed to restart ambient sound`, ambientSound.document.id, err);
  }
}

async function restartAllFlagged() {
  await Promise.all(flaggedSounds().map(restartFromBeginning));
}

/**
 * Injects a "Restart on Scene Load" checkbox into the Ambient Sound config
 * sheet, bound directly to the flag via its `name` — standard Foundry form
 * handling expands dotted `flags.` field names into the update payload with
 * no extra listener needed. `html` is a jQuery object on v12's AppV1 sheets
 * but a raw HTMLElement on v13, which migrated AmbientSoundConfig to
 * ApplicationV2 — normalize to a plain element and use native DOM calls so
 * this works on either.
 */
function onRenderAmbientSoundConfig(app, html) {
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  const checked = app.document.getFlag(MODULE_ID, FLAG) ? 'checked' : '';
  const group = document.createElement('div');
  group.className = 'form-group';
  group.innerHTML = `
    <label>Restart on Scene Load</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.${MODULE_ID}.${FLAG}" ${checked}>
    </div>
    <p class="notes">Every time a client loads this scene, force this sound to start over from the beginning instead of resuming wherever Foundry's shared background playback left off.</p>
  `;

  const footer = root.querySelector('footer') ?? root.querySelector('button[type="submit"]');
  if (footer) footer.before(group);
  else (root.querySelector('form') ?? root).appendChild(group);
  app.setPosition?.({ height: 'auto' });
}

Hooks.on('renderAmbientSoundConfig', onRenderAmbientSoundConfig);

// Each client restarts its own flagged sounds the moment it loads the scene.
Hooks.on('canvasReady', () => {
  if (flaggedSounds().length) restartAllFlagged();
});

// GM-only manual trigger, broadcast to every connected client so a
// mid-session restart sounds simultaneous for everyone instead of only
// resetting the GM's own client.
Hooks.once('ready', () => {
  game.socket.on(SOCKET, (message) => {
    if (message?.action === 'restart') restartAllFlagged();
  });
});

function broadcastRestart() {
  game.socket.emit(SOCKET, { action: 'restart' });
  restartAllFlagged();
}

Hooks.once('init', () => {
  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = {
    layerClass: CprAmbientRestartLayer,
    group: 'interface',
  };
});

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const group = {
    name: MODULE_ID,
    title: 'CPR Ambient Restart',
    icon: 'fa-solid fa-music',
    layer: CONTROL_LAYER_NAME,
    tools: [
      {
        name: 'restart',
        title: 'Restart flagged ambient sounds (all clients)',
        icon: 'fa-solid fa-rotate-left',
        button: true,
        onClick: broadcastRestart,
      },
    ],
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});
