// The third event in the system, and a different shape than the two
// intrusions: not a "hostile presence" with a name to evict/eliminate, just
// a system fault — one Active Links chip goes offline until someone runs
// "eccm flush cache". Independent of visionEffect's intruding/_intrusionHandle
// state entirely (a netrunner or black ice intrusion can be running at the
// same time as this — extra chaos, not a conflict), and no full-screen
// breach treatment either: a locked chip is a routine glitch, not an
// attack, so it only gets a terminal line and the chip's own visual.
//
// State lives as a world-scoped setting (cacheCorrupted, registered in
// main.js) rather than the ChatMessage-relay broadcast the intrusions use
// — it's a plain shared boolean, and Foundry already syncs world settings
// to every client on its own via the updateSetting hook, so there's no
// reason to build a second sync mechanism for it. The one place that still
// needs a relay is *resolving* it: writing a world setting requires GM
// permission, so a player's "eccm flush cache" can't just call
// game.settings.set() directly — it whispers a request the same way
// requestControl() does in socket.js, and only the GM's own client
// performs the actual write.

import { MODULE_ID, isModeEnabled, isCacheCorrupted } from './data.js';
import { visionEffect, INTRUSION_TIMEOUT_MS } from './vision-effect.js';

const FLUSH_REQUEST_FLAG = 'cacheFlushRequest';

let reminderTimer = null;

/**
 * Locks a chip right now — wired to the "Trigger Cache Corruption"
 * scene-control button in main.js.
 */
export async function triggerCacheCorruption() {
  if (!game.user.isGM) return;
  if (!isModeEnabled()) {
    ui.notifications.warn('Turn on the Rogue AI Vision mode before triggering cache corruption.');
    return;
  }
  if (isCacheCorrupted()) {
    ui.notifications.warn('The cache is already corrupted.');
    return;
  }
  await game.settings.set(MODULE_ID, 'cacheCorrupted', true);
}

/** Player-side: ask the GM to actually flush it (see the file comment for why this can't just write the setting directly). No-op if nothing's corrupted — same "don't spam a request that has nothing to do" guard requestControl() doesn't need but this does, since unlike a token claim there's no per-target eligibility check on the other end to catch a pointless one. */
async function requestFlush() {
  await ChatMessage.create({
    content: '// requesting cache flush',
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    flags: { [MODULE_ID]: { [FLUSH_REQUEST_FLAG]: true } },
  });
}

/**
 * The actual behavior behind "eccm flush cache" — called from
 * netrunner-intrusion.js's own "eccm" dispatch (that keyword's subcommands
 * span both files: "evict" is netrunner-intrusion.js's own state, "flush
 * cache" is this file's) rather than registered here directly, since only
 * one handler can own the "eccm" keyword itself.
 */
export function handleEccmFlushCache() {
  if (!isCacheCorrupted()) {
    // Nothing's actually wrong — same harmless flavor response flush-cache
    // has always given when there's nothing to flush.
    visionEffect.printTerminalLine('ECCM: CACHE FLUSHED.', { action: true });
    return;
  }
  requestFlush();
  visionEffect.printTerminalLine('ECCM: FLUSH REQUEST SENT.', { action: true });
}

export function registerCacheCorruptionHooks() {
  Hooks.on('createChatMessage', (message) => {
    if (!message.getFlag(MODULE_ID, FLUSH_REQUEST_FLAG)) return;
    if (!game.user.isGM) return;
    if (isCacheCorrupted()) {
      game.settings.set(MODULE_ID, 'cacheCorrupted', false);
      ui.notifications.info('Corrupted cache flushed.');
    }
    // Every GM is fine to race on this delete — same reasoning as every
    // other control-channel message in this module.
    message.delete().catch(() => {});
  });

  // Fires on every client (Foundry syncs world settings on its own) —
  // this is the one place that actually reacts to the state, regardless
  // of whether a GM's trigger or a flush caused the change.
  Hooks.on('updateSetting', (setting) => {
    if (setting.key !== `${MODULE_ID}.cacheCorrupted`) return;
    visionEffect.refreshChips();
    if (reminderTimer) {
      clearTimeout(reminderTimer);
      reminderTimer = null;
    }
    if (isCacheCorrupted()) {
      visionEffect.printTerminalLine(
        "CACHE CORRUPTION DETECTED. ACTIVE LINK CAPACITY REDUCED. RUN 'ECCM FLUSH CACHE' TO RESTORE.",
        { danger: true },
      );
      // Same ticking-clock pressure as the intrusions, but nothing here
      // auto-resolves on its own — the lock only ever lifts by someone
      // actually running the flush command, this is just a reminder that
      // it's still broken.
      reminderTimer = window.setTimeout(() => {
        if (isCacheCorrupted()) {
          visionEffect.printTerminalLine('CACHE CORRUPTION STILL UNRESOLVED.', { danger: true });
        }
      }, INTRUSION_TIMEOUT_MS);
    } else {
      visionEffect.printTerminalLine('CACHE FLUSH COMPLETE. CAPACITY RESTORED.', { action: true });
    }
  });
}
