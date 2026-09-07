// The second entry in the "hostile presence" event family — see
// netrunner-intrusion.js for the first one and the shared shape both
// follow (this file is a close mirror of it: its own GM-triggered start,
// its own broadcast/resolve flags, its own name pool). Distinct narrative
// entity from a netrunner: "S.K.AM Black Ice Management" is the AI's own
// defensive-countermeasure system, so this reads as "we tripped a hostile
// ICE program," not "a person is attacking us" — same mechanical shape
// and the exact same visual escalation (see INTRUSION_KINDS.blackice in
// vision-effect.js), just a different intruder type and resolved with
// "sbim elim <name>" instead of "eccm evict <name>".

import { MODULE_ID, isModeEnabled } from './data.js';
import { visionEffect, registerTerminalCommand } from './vision-effect.js';

const START_FLAG = 'blackiceIntrusionStart';
const RESOLVE_FLAG = 'blackiceIntrusionResolve';

// ICE program names, not netrunner handles — deliberately a different
// naming register (a piece of hostile software, not someone's handle).
const ICE_NAMES = [
  'FIREWALL-7', 'HELLHOUND', 'CERBERUS', 'DEADBOLT', 'RAZORWIRE',
  'SENTRY-9', 'CHOKEPOINT', 'ASPHYX', 'GRIDLOCK', 'WATCHDOG',
];

/** Exported for unknown-intrusion.js, which needs to draw from the same pool when it rolls black ice as the hidden identity behind an unidentified intrusion. */
export function randomIceName() {
  return ICE_NAMES[Math.floor(Math.random() * ICE_NAMES.length)];
}

/**
 * Fires a black ice intrusion right now — wired to the "Trigger Black Ice
 * Intrusion" scene-control button in main.js. Same guards as
 * netrunner-intrusion.js's triggerIntrusion(): mode has to be on, and
 * visionEffect.intruding covers BOTH kinds (there's only one
 * _intrusionHandle slot in vision-effect.js), so this also refuses to
 * stack on top of an already-running netrunner intrusion, not just
 * another black ice one.
 */
export async function triggerBlackIceIntrusion() {
  if (!game.user.isGM) return;
  if (!isModeEnabled()) {
    ui.notifications.warn('Turn on the Rogue AI Vision mode before triggering a black ice intrusion.');
    return;
  }
  if (visionEffect.intruding) {
    ui.notifications.warn('An intrusion is already in progress.');
    return;
  }
  const handle = randomIceName();
  await ChatMessage.create({
    content: `// black ice intrusion detected (${handle})`,
    flags: { [MODULE_ID]: { [START_FLAG]: { handle } } },
  });
}

async function broadcastResolve(handle) {
  await ChatMessage.create({
    content: `// black ice intrusion resolved (${handle})`,
    flags: { [MODULE_ID]: { [RESOLVE_FLAG]: { handle } } },
  });
}

// "sbim elim -all" or "sbim elim <name>" resolves the active black ice
// intrusion — -all is the panic-button form (doesn't require actually
// knowing the name), <name> is the precise form, both equally valid.
// Anything else under sbim (no elim subcommand, or elim with nothing
// actually running to eliminate) falls back to the same "recognized
// keyword, nothing to report" flavor stub sbim has always had; a wrong
// *target* while black ice really is active gets the sharper COMMAND NOT
// RECOGNIZED instead, same as eccm's own wrong-guess handling.
function handleSbimCommand(args) {
  const [sub, ...rest] = args;
  const tail = rest.join(' ').trim().toLowerCase();

  if (sub?.toLowerCase() === 'elim' && visionEffect.intrusionKind === 'blackice') {
    const handle = visionEffect.intrusionHandle;
    if (tail === '-all' || tail === handle.toLowerCase()) {
      Hooks.callAll(`${MODULE_ID}.intrusionSolved`, handle, 'blackice');
    } else {
      visionEffect.printTerminalLine('COMMAND NOT RECOGNIZED.', { danger: true });
    }
    return;
  }

  visionEffect.printTerminalLine('SBIM: NO BLACK ICE PROGRAMS LOADED.');
}

export function registerBlackIceIntrusionHooks() {
  registerTerminalCommand('sbim', handleSbimCommand);

  Hooks.on('createChatMessage', (message) => {
    const start = message.getFlag(MODULE_ID, START_FLAG);
    const resolved = message.getFlag(MODULE_ID, RESOLVE_FLAG);
    if (!start && !resolved) return;

    if (start?.handle) visionEffect.startIntrusion(start.handle, 'blackice');
    if (resolved?.handle) visionEffect.resolveIntrusion();

    // Every GM is fine to race on this delete — same reasoning as the
    // take-control relay in socket.js: it's a control-channel message, not
    // real chat, and a missed delete just leaves one extra line.
    if (game.user.isGM) message.delete().catch(() => {});
  });

  // Kind-gated since netrunner-intrusion.js fires the exact same hook for
  // its own solves — this file only ever wants its own.
  Hooks.on(`${MODULE_ID}.intrusionSolved`, (handle, kind) => {
    if (kind !== 'blackice') return;
    broadcastResolve(handle);
  });
}
