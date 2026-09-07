// The generic terminal keywords — the ones with no state of their own to
// check against, unlike "eccm" (netrunner-intrusion.js) and "sbim"
// (blackice-intrusion.js), which each own the active-intrusion state
// their resolving subcommand actually validates against. Each of these is
// deliberately small; the list is meant to keep growing as more of the
// "event system" gets built out, so a new keyword with real behavior
// later just means another registerTerminalCommand() call somewhere, not
// a rewrite of how the terminal dispatches input.

import { registerTerminalCommand, visionEffect } from './vision-effect.js';
import { handleFindUserAll, tryHandleFind } from './unknown-intrusion.js';

// "find" has three jobs, checked in order:
//  1. "find user -all" — the roster listing (unknown-intrusion.js owns
//     this; always available, not just while something's pending).
//  2. A guess against a pending unknown intrusion's alias, once one's
//     actually running (also unknown-intrusion.js — see tryHandleFind).
//  3. Otherwise, a plain case-insensitive substring search over every
//     token currently on the scene (sees hidden tokens too, same as this
//     module's ambient outline already does elsewhere in overlay.js — an
//     AI with sensor access searching its own scene isn't limited by a
//     player's own vision) — the actual "unrelated to any event" case.
function handleFindCommand(args) {
  const query = args.join(' ').trim();
  if (!query) {
    visionEffect.printTerminalLine('COMMAND NOT RECOGNIZED.', { danger: true });
    return;
  }
  if (args[0]?.toLowerCase() === 'user' && args[1]?.toLowerCase() === '-all') {
    handleFindUserAll();
    return;
  }
  if (tryHandleFind(query)) return;
  const match = canvas.tokens?.placeables.find((t) =>
    t.document.name?.toLowerCase().includes(query.toLowerCase()));
  if (match) {
    visionEffect.printTerminalLine(`TARGET LOCATED: ${match.document.name.toUpperCase()}`, { action: true });
  } else {
    visionEffect.printTerminalLine('NO MATCH FOUND.', { danger: true });
  }
}

// "sendmc <message>" — Send Message to Channel: posts to Foundry's own
// chat log (a real, visible message, not a relay message that gets
// deleted) under the sending player's current speaker, flavored as coming
// over the AI's own channel rather than plain OOC chat — and echoes that
// same message into this terminal as "<Name>: <message>", so it reads
// like the AI is relaying the actual conversation through its own log,
// not just confirming the send happened. getSpeaker().alias is Foundry's
// own "the right name to show for this message" resolution (the user's
// assigned character if they have one, their own name otherwise) — same
// value already going onto the real chat message, so the two stay
// consistent with each other.
async function handleSendmcCommand(args, raw) {
  const message = raw.replace(/^sendmc\s+/i, '').trim();
  if (!message) {
    visionEffect.printTerminalLine('COMMAND NOT RECOGNIZED.', { danger: true });
    return;
  }
  const speaker = ChatMessage.getSpeaker();
  await ChatMessage.create({
    content: message,
    speaker,
    flavor: 'EPSILON CHANNEL',
  });
  visionEffect.printTerminalLine(`${speaker.alias}: ${message}`, { action: true });
}

export function registerBuiltinTerminalCommands() {
  registerTerminalCommand('find', handleFindCommand);
  registerTerminalCommand('sendmc', handleSendmcCommand);
}
