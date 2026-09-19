// The fourth event: the intrusion's TYPE is unknown at first — the
// terminal only shows an unauthorized login alias (e.g. "MCG"), not a
// real handle or ICE name. Solving it is an investigation, not a
// decoding puzzle:
//   find user -all         -> lists the roster, the alias shows up on it
//                              as an unauthorized entry
//   find <alias>            -> pulls that entry's actual record: Type
//                              (what kind of thing it is) and Login (the
//                              real name to use against it)
//   eccm evict <login>       -> if Type said it's a remote user
//   sbim elim <login>        -> if Type said it's a root process
// Once identified it seamlessly becomes a normal netrunner or black ice
// intrusion (see vision-effect.js#revealIntrusion) — same timer, same
// breach visuals, already running the whole time; only the terminal-
// facing story changes. That also means the investigation costs time out
// of the same clock you'd then need to actually run eccm/sbim before it
// times out — deliberate, not an oversight.
//
// Worth being upfront about: the real identity does travel to every
// client the instant this starts (same public-broadcast pattern as every
// other intrusion here), just not *displayed* until revealed — a player
// determined to open devtools could read the answer directly off the
// synced flag. Building a version where only the GM's client ever knows
// the answer, and "find" round-trips through them to check a guess,
// would close that gap, but is a meaningfully bigger lift than this
// module's fully client-trusted design anywhere else — reasonable for a
// table of friends, not for a puzzle that needs to resist someone
// actually looking.

import { MODULE_ID, isModeEnabled } from './data.js';
import { visionEffect } from './vision-effect.js';
import { randomHandle } from './netrunner-intrusion.js';
import { randomIceName } from './blackice-intrusion.js';

const START_FLAG = 'unknownIntrusionStart';
const REVEAL_FLAG = 'unknownIntrusionReveal';

// The party's own roster, always listed first — Epsilon included, since
// it's asking about itself as much as anyone. Real character names from
// this campaign (see the ambient chatter's own "Mirae"/"Regi"/"M" lines),
// so an unauthorized entry actually stands out as not belonging.
const ROSTER = [
  'Epsilon - AICU',
  'Mirae - Authorized User',
  'Val Hallow - Authorized User',
  'Regi X - Authorized User',
  'M - Authorized User',
];

// Short, cryptic login aliases — the thing that shows up on the roster
// before anyone's actually pulled the record behind it.
const ALIASES = ['MCG', 'XRT', 'KVL', 'DNP', 'QZR', 'TBH', 'WYK', 'JFL', 'ORN', 'ZXC'];

// What "Type" reads as per real kind — a netrunner is a person connected
// in from outside, black ice is a hostile program running with system
// access, so the record's own wording is what actually tells a player
// which resolving command applies, without just spelling out "netrunner"
// or "black ice" directly.
const TYPE_LABEL = {
  netrunner: 'Remote User',
  blackice: 'Root Process',
};

// Set locally the instant the start broadcast lands (every client gets
// it, see the file comment above) — cleared the moment it's revealed, or
// the intrusion ends any other way (see intrusionEnd below).
let pending = null; // { alias, realHandle, realKind }

export async function triggerUnknownIntrusion() {
  if (!game.user.isGM) return;
  if (!isModeEnabled()) {
    ui.notifications.warn('Turn on the Rogue AI Vision mode before triggering an unknown intrusion.');
    return;
  }
  if (visionEffect.intruding) {
    ui.notifications.warn('An intrusion is already in progress.');
    return;
  }
  const realKind = Math.random() < 0.5 ? 'netrunner' : 'blackice';
  const realHandle = realKind === 'netrunner' ? randomHandle() : randomIceName();
  const alias = ALIASES[Math.floor(Math.random() * ALIASES.length)];
  await ChatMessage.create({
    content: `// unknown intrusion detected (${alias})`,
    flags: { [MODULE_ID]: { [START_FLAG]: { alias, realHandle, realKind } } },
  });
}

async function broadcastReveal(alias, realHandle, realKind) {
  await ChatMessage.create({
    content: `// unknown intrusion identified (${realHandle})`,
    flags: { [MODULE_ID]: { [REVEAL_FLAG]: { alias, realHandle, realKind } } },
  });
}

/**
 * "find user -all" — the roster, plus the pending alias tacked on as an
 * unauthorized entry if there's an unknown intrusion actually running.
 * Always available (same "known, working command with nothing special to
 * report" idea as sbim's own idle stub), not gated behind anything —
 * checking who's logged in is a legitimate thing to do any time.
 */
export function handleFindUserAll() {
  const lines = ['Listing users', ...ROSTER];
  if (pending) lines.push(`${pending.alias} - Unauthorized User Alias`);
  visionEffect.printTerminalLines(lines, { action: true });
}

/**
 * "find <string>" once something's actually pending — checked against the
 * alias, not the real identity (a player has no way to know the real
 * name yet; that's what this reveals). A wrong guess is only this
 * client's business, printed locally right away — but a correct one asks
 * the table to reveal it (same request/authoritative-action split as
 * every other solve in this module: this client asks, it doesn't decide)
 * rather than printing the record immediately just for the one player who
 * happened to type it; the actual User/Type/Login block prints for
 * everyone at once, in registerUnknownIntrusionHooks() below, once that
 * broadcast lands. Returns whether it actually handled the input at all,
 * so terminal-commands.js's own "find" knows whether to fall back to its
 * normal token-search behavior — this only intercepts it while an alias
 * is genuinely pending, and is entirely uninvolved the rest of the time.
 */
export function tryHandleFind(query) {
  if (!pending) return false;
  if (query.toLowerCase() !== pending.alias.toLowerCase()) {
    visionEffect.printTerminalLine('NO MATCH FOUND.', { danger: true });
    return true;
  }
  Hooks.callAll(`${MODULE_ID}.unknownIntrusionSolved`, pending.alias, pending.realHandle, pending.realKind);
  return true;
}

export function registerUnknownIntrusionHooks() {
  Hooks.on('createChatMessage', (message) => {
    const start = message.getFlag(MODULE_ID, START_FLAG);
    const reveal = message.getFlag(MODULE_ID, REVEAL_FLAG);
    if (!start && !reveal) return;

    if (start) {
      pending = { alias: start.alias, realHandle: start.realHandle, realKind: start.realKind };
      visionEffect.startIntrusion(start.alias, 'unknown');
    }
    if (reveal) {
      pending = null;
      visionEffect.revealIntrusion(reveal.realHandle, reveal.realKind);
      visionEffect.printTerminalLines(
        [`User: ${reveal.alias}`, `Type: ${TYPE_LABEL[reveal.realKind]}`, `Login: ${reveal.realHandle}`],
        { danger: true },
      );
    }

    if (game.user.isGM) message.delete().catch(() => {});
  });

  Hooks.on(`${MODULE_ID}.unknownIntrusionSolved`, (alias, realHandle, realKind) => {
    broadcastReveal(alias, realHandle, realKind);
  });

  // Covers every way the intrusion can end without ever being identified
  // (it timed out) — without this, a stale `pending` would let a "find"
  // typed well after the fact still match against last time's alias.
  // Already cleared above when a reveal happens, so this is a no-op then.
  Hooks.on(`${MODULE_ID}.intrusionEnd`, () => {
    pending = null;
  });
}
