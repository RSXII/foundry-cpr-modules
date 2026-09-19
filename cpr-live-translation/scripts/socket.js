import { SOCKET_NAME } from "./constants.js";
import { TranslationEffect } from "./translation-effect.js";

export function initSocket() {
  game.socket.on(SOCKET_NAME, (data) => TranslationEffect.play(data));
}

/**
 * Plays the translation effect locally and, unless suppressed, broadcasts it
 * to every other connected client so everyone sees the same decrypt in sync.
 * @param {object} data          See TranslationEffect.play.
 * @param {object} [options]
 * @param {boolean} [options.broadcast=true]
 */
export function trigger(data, { broadcast = true } = {}) {
  if (broadcast) game.socket.emit(SOCKET_NAME, data);
  TranslationEffect.play(data);
}
