// Ownership writes require GM/Assistant-GM privilege, so a player's "Take
// Control" click can't grant itself. This used to relay the request over
// a raw game.socket.emit/.on() custom event, the same shape as
// ../cpr-vehicle-crew's token-follow sync and ../cpr-ambient-restart's
// broadcastRestart — but testing against a real self-hosted Foundry
// server (v12 build 343, direct IP:port, no proxy) found that custom
// module-namespaced socket events weren't being relayed between clients
// in *either* direction, while Foundry's own built-in traffic (chat,
// document updates) synced fine over the same connection. Rather than
// depend on a relay path that's apparently unreliable in at least one
// real deployment, the request now travels as a GM-only whispered
// ChatMessage instead — riding the same document-sync pipeline that's
// already proven to work, at the cost of a message flashing briefly in
// the GM's chat log before this deletes it.

import {
  MODULE_ID, isModeEnabled, isTakeableType, isTakeable, controllerOf, grantControl,
  claimedTokensOnScene, effectiveMaxActiveLinks,
} from './data.js';

const REQUEST_FLAG = 'requestControl';

/**
 * Player-side: fire off a claim request. No ack — success shows up as the
 * token's controlledBy flag changing (which overlay.js and the
 * auto-select listener in main.js both react to), not as a response to
 * this call. overlay.js's click handler posts the "ASSUMING CONTROL OF"
 * terminal-log line right alongside this call, in place of a toast — that
 * line exists because the lack of an ack is otherwise indistinguishable
 * from "nothing happened": a click with no connected GM client to process
 * it looks and behaves exactly like a click that did nothing at all. The
 * console log below is the same signal for anyone checking devtools.
 */
export async function requestControl(tokenDoc) {
  console.log(`${MODULE_ID} | requesting control of`, tokenDoc.name, tokenDoc.id);
  await ChatMessage.create({
    content: `// requesting control of ${tokenDoc.name}`,
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    flags: { [MODULE_ID]: { [REQUEST_FLAG]: { tokenUuid: tokenDoc.uuid, userId: game.user.id } } },
  });
}

async function handleRequestControl({ tokenUuid, userId } = {}) {
  if (!tokenUuid || !userId) return;
  const tokenDoc = await fromUuid(tokenUuid);
  if (!tokenDoc) {
    console.warn(`${MODULE_ID} | request-control: no token found for`, tokenUuid);
    return;
  }
  if (!isModeEnabled()) {
    console.warn(`${MODULE_ID} | request-control: ignored, mode is off`, tokenDoc.name);
    return;
  }
  if (controllerOf(tokenDoc)) {
    console.warn(`${MODULE_ID} | request-control: ignored, already claimed`, tokenDoc.name);
    return;
  }
  if (!isTakeableType(tokenDoc.actor) || !isTakeable(tokenDoc.actor)) {
    console.warn(`${MODULE_ID} | request-control: ignored, not eligible`, tokenDoc.name);
    return;
  }
  const cap = effectiveMaxActiveLinks();
  if (claimedTokensOnScene(tokenDoc.parent).length >= cap) {
    console.warn(`${MODULE_ID} | request-control: ignored, ${cap} active links already claimed`, tokenDoc.name);
    return;
  }

  console.log(`${MODULE_ID} | granting control of`, tokenDoc.name, 'to', userId);
  // grantControl() re-checks the same cap right before it actually writes —
  // the check above is just for a clear, specific log line here. Two
  // requests landing close enough together to both pass it would otherwise
  // both grant, since neither one can see the other's write yet.
  const granted = await grantControl(tokenDoc, userId);
  if (!granted) {
    console.warn(`${MODULE_ID} | request-control: grantControl refused`, tokenDoc.name);
    return;
  }
  const user = game.users.get(userId);
  ui.notifications.info(`${user?.name ?? 'A player'} took control of ${tokenDoc.name}.`);
}

export function registerSocketHooks() {
  Hooks.on('createChatMessage', (message) => {
    if (!game.user.isGM) return;
    const request = message.getFlag(MODULE_ID, REQUEST_FLAG);
    if (!request) return;

    handleRequestControl(request);
    // Every GM is fine to race on this delete — it's a control-channel
    // message, not real chat, and a missed delete just leaves one extra
    // line rather than breaking anything.
    message.delete().catch(() => {});
  });

  Hooks.once('ready', () => {
    if (game.user.isGM) console.log(`${MODULE_ID} | GM listening for take-control requests via chat relay`);
  });
}
