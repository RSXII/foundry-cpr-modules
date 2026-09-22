// CPR Incoming Call module
//
// Cyberpunk 2077-style call handling: a ringing toast (top of screen, with
// Answer/Reject) that becomes an in-call toast (Hang Up) plus a full
// connection card (bottom-right) once answered. This module has no
// transport of its own for the *inbound* leg — it depends on the Fate City
// 1999 project's `fc99-bridge` module (see
// ../../fate-city-1999/foundry-module), which holds the actual WebSocket
// connection to that project's LAN bridge service and turns incoming
// events into a `ChatMessage` flagged with the event envelope. For the
// *player-driven* leg (answer/reject/hang up), this module creates its own
// flagged ChatMessage the same way — see sendAction() below — rather than
// a raw game.socket broadcast, because fc99-bridge's own README documents
// that a self-hosted Foundry server tested during that project's
// development didn't reliably relay custom module-namespaced socket events
// between clients at all; riding the chat document-sync pipeline sidesteps
// that, and this module reuses the exact same lesson.
//
//   fc99-bridge:  ChatMessage flag "fc99-bridge"   -> call.incoming / call.ended
//   this module:  ChatMessage flag "cpr-incoming-call" -> answered / declined / hungup
//                          |
//                          v
//         every client's createChatMessage hook (below) reacts to both,
//         driving one local state machine: idle -> ringing -> in-call -> idle
//
// Foundry already syncs/whispers those ChatMessages to the right clients on
// its own (fc99-bridge resolves a `targetCodename` payload field to a
// whisper list, and this module whispers its own action messages to
// `[game.user.id]` — which Foundry still shows to GMs regardless, per
// fc99-bridge's own dispatch() comment) — so per-player scoping is
// inherited for free on both legs, no extra plumbing needed.

import { showCallCard, hideCallCard } from './call-card.js';
import { showToast, hideToast } from './ringing-toast.js';

const MODULE_ID = 'cpr-incoming-call';
const BRIDGE_MODULE_ID = 'fc99-bridge';

let state = 'idle'; // 'idle' | 'ringing' | 'in-call'
let currentPayload = null;
let autoHangupTimer = null;

function clearAutoHangup() {
  clearTimeout(autoHangupTimer);
  autoHangupTimer = null;
}

function goIdle() {
  clearAutoHangup();
  hideToast();
  hideCallCard();
  state = 'idle';
  currentPayload = null;
}

function goRinging(payload) {
  clearAutoHangup();
  currentPayload = payload;
  state = 'ringing';
  hideCallCard();
  showToast('ringing', payload, {
    onAnswer: () => sendAction('answered'),
    onReject: () => sendAction('declined'),
  });
}

function goInCall(payload) {
  state = 'in-call';
  showCallCard(payload);
  showToast('in-call', payload, {
    onHangup: () => sendAction('hungup'),
  });

  // Optional safety net only — see the `autoHangupMs` setting below. Off by
  // default: the call is meant to stay connected until a real hang-up
  // signal (this module's own Hang Up button, or the ops console's End
  // Call) ends it.
  const autoHangupMs = game.settings.get(MODULE_ID, 'autoHangupMs');
  if (autoHangupMs > 0) {
    autoHangupTimer = setTimeout(() => sendAction('hungup'), autoHangupMs);
  }
}

function actionLine(action, payload) {
  const who = payload?.callerName ?? 'Unknown';
  if (action === 'answered') return `📞 Call answered — ${who}`;
  if (action === 'declined') return `📴 Call declined — ${who}`;
  return `📴 Call ended — ${who}`;
}

// The buttons never touch DOM state directly — they only ever create this
// ChatMessage. The createChatMessage hook below is the single place that
// actually changes what's on screen, for every client including the one
// that clicked, so a local click and a remote one drive identical code.
function sendAction(action) {
  ChatMessage.create({
    content: actionLine(action, currentPayload),
    speaker: { alias: 'Incoming Call' },
    whisper: [game.user.id],
    flags: { [MODULE_ID]: { action, targetCodename: currentPayload?.targetCodename ?? null } },
  });
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'autoHangupMs', {
    name: 'Auto Hang Up After (ms)',
    hint: "Optional safety net: automatically hang up a connected call after this long, in case a hang-up signal never arrives. 0 (default) disables it — a call only ends via Hang Up, Reject, or the ops console's End Call.",
    scope: 'world',
    config: true,
    type: Number,
    default: 0,
  });
});

// Reads both this module's own action flag and fc99-bridge's envelope flag
// off every chat message that syncs in. Runs on every client (GM and
// players alike); whispered messages that aren't meant for this client are
// simply never delivered to this hook at all, so audience scoping is
// inherited for free from Foundry's own whisper delivery.
Hooks.on('createChatMessage', (message) => {
  const bridgeEnvelope = message.getFlag(BRIDGE_MODULE_ID, 'envelope');
  if (bridgeEnvelope) {
    if (bridgeEnvelope.type === 'call.incoming') goRinging(bridgeEnvelope.payload ?? {});
    else if (bridgeEnvelope.type === 'call.ended') goIdle();
    return;
  }

  const action = message.getFlag(MODULE_ID, 'action');
  if (!action) return;
  if (action === 'answered') {
    if (currentPayload) goInCall(currentPayload);
  } else if (action === 'declined' || action === 'hungup') {
    goIdle();
  }
});
