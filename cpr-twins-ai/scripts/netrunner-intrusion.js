// The first entry in what's meant to grow into a small library of GM-
// triggered "events" during Rogue AI Vision play — a netrunner intrusion
// for now, more later. This file owns *when* one happens (a GM clicking
// the scene-control button main.js wires to triggerIntrusion() below —
// previously a random timer, removed in favor of the GM picking the
// moment themselves) and keeping every client in sync about it;
// vision-effect.js owns how it looks/behaves in the terminal once it's
// running (see its "Netrunner intrusion" section).
//
// Broadcast the same way take-control requests already are (see socket.js):
// a ChatMessage carrying a flag payload, deleted again once every client's
// had a chance to react to its creation — riding the same document-sync
// pipeline that's already proven reliable on a real server, at the cost of
// a message flashing briefly in chat before it's gone. Unlike the
// take-control relay (which whispers to the GM only, since only the GM
// needs to act on it), this one is a normal public message: every client,
// not just the GM's, needs to see it land so everyone's terminal reacts at
// once — it's meant to read as one shared "the table's under attack" beat,
// not five players independently noticing at different times.

import { MODULE_ID, isModeEnabled } from './data.js';
import { visionEffect, registerTerminalCommand } from './vision-effect.js';
import { handleEccmFlushCache } from './cache-corruption.js';

const START_FLAG = 'netrunnerIntrusionStart';
const RESOLVE_FLAG = 'netrunnerIntrusionResolve';

// Handles kept short and shout-able, matching the sort of thing a player
// would actually type back correctly under pressure.
const INTRUDER_HANDLES = [
  'GHOSTWIRE', 'BLACKICE', 'REDSHIFT', 'NULLPOINT', 'WIREHEAD',
  'STATIC9', 'DEADLATCH', 'GRAYCODE', 'ZEROLAG', 'FANGWARE',
];

/** Exported for unknown-intrusion.js, which needs to draw from the same pool when it rolls a netrunner as the hidden identity behind an unidentified intrusion. */
export function randomHandle() {
  return INTRUDER_HANDLES[Math.floor(Math.random() * INTRUDER_HANDLES.length)];
}

/**
 * Fires a netrunner intrusion right now — wired to the "Trigger Netrunner
 * Intrusion" scene-control button in main.js. Guards against the two ways
 * this could go wrong: mode isn't even on (nothing would show the alert),
 * or one's already running (visionEffect.intruding is this GM client's own
 * local state, already kept in sync by the broadcast below like every
 * other client's — reusing it here instead of a second tracking variable
 * that could itself drift out of sync with what's actually on screen).
 */
export async function triggerIntrusion() {
  if (!game.user.isGM) return;
  if (!isModeEnabled()) {
    ui.notifications.warn('Turn on the Rogue AI Vision mode before triggering a netrunner intrusion.');
    return;
  }
  if (visionEffect.intruding) {
    ui.notifications.warn('A netrunner intrusion is already in progress.');
    return;
  }
  const handle = randomHandle();
  await ChatMessage.create({
    content: `// netrunner intrusion detected (${handle})`,
    flags: { [MODULE_ID]: { [START_FLAG]: { handle } } },
  });
}

async function broadcastResolve(handle) {
  await ChatMessage.create({
    content: `// netrunner intrusion resolved (${handle})`,
    flags: { [MODULE_ID]: { [RESOLVE_FLAG]: { handle } } },
  });
}

// "eccm evict <handle>" and "eccm flush cache" are the only recognized
// eccm subcommands for now (see the quick-reference strip in
// vision-effect.js's _buildDom) — anything else under the eccm keyword (a
// typo, the wrong target, no intrusion currently running to evict at all)
// falls through to the same generic COMMAND NOT RECOGNIZED response as an
// unrecognized keyword, rather than a bespoke "wrong target"/"unknown
// subcommand" message — simpler, and a real locked-down terminal has no
// reason to be more helpful about *why* a guess failed. "flush cache"
// delegates straight to cache-corruption.js — that file owns the state
// it actually checks/changes, this one just owns the "eccm" keyword itself.
function handleEccmCommand(args) {
  const [sub, ...rest] = args;
  const tail = rest.join(' ').toLowerCase();

  if (sub?.toLowerCase() === 'flush' && tail === 'cache') {
    handleEccmFlushCache();
    return;
  }

  // Kind-gated, not just "is anything intruding" — a black ice intrusion
  // is also visionEffect.intruding === true, but "eccm evict" doesn't
  // touch it (that's "sbim elim", see blackice-intrusion.js) even if the
  // typed target happens to match its handle.
  const target = rest.join(' ');
  if (
    sub?.toLowerCase() !== 'evict' ||
    !target ||
    visionEffect.intrusionKind !== 'netrunner' ||
    target.toLowerCase() !== visionEffect.intrusionHandle.toLowerCase()
  ) {
    visionEffect.printTerminalLine('COMMAND NOT RECOGNIZED.', { danger: true });
    return;
  }
  Hooks.callAll(`${MODULE_ID}.intrusionSolved`, visionEffect.intrusionHandle, visionEffect.intrusionKind);
}

export function registerIntrusionHooks() {
  registerTerminalCommand('eccm', handleEccmCommand);

  Hooks.on('createChatMessage', (message) => {
    const start = message.getFlag(MODULE_ID, START_FLAG);
    const resolved = message.getFlag(MODULE_ID, RESOLVE_FLAG);
    if (!start && !resolved) return;

    if (start?.handle) visionEffect.startIntrusion(start.handle, 'netrunner');
    if (resolved?.handle) visionEffect.resolveIntrusion();

    // Every GM is fine to race on this delete — same reasoning as the
    // take-control relay in socket.js: it's a control-channel message, not
    // real chat, and a missed delete just leaves one extra line.
    if (game.user.isGM) message.delete().catch(() => {});
  });

  // A correct local guess doesn't clear anything by itself (see
  // vision-effect.js's _submitIntrusionCommand) — it just asks the table to
  // resolve, same request/authoritative-action split as take-control's own
  // requestControl()/grantControl() pair. Fires only on whichever client
  // actually typed the winning command, since that's the only place the
  // hook gets called from. Kind-gated since blackice-intrusion.js fires the
  // exact same hook for its own solves — this file only ever wants its own.
  Hooks.on(`${MODULE_ID}.intrusionSolved`, (handle, kind) => {
    if (kind !== 'netrunner') return;
    broadcastResolve(handle);
  });
}
