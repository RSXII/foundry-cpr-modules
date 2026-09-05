import { getSound, getVolume } from './data.js';

// CPR chat cards carry no roll-type flag, but only attack-style roll cards
// (normal/aimed/autofire/suppressive weapon attacks, plus cyberdeck attacks)
// render a "roll damage" follow-up button. Damage cards use "applyDamage"
// instead, and every other roll type (skill, stat, initiative, etc) has
// neither action. That data-action, plus the item/actor/token ids on the
// same element, is the only place CPR exposes "this was an attack roll for
// this weapon" without patching the system itself.
const ATTACK_MARKER = /data-action="rollDamage"[^>]*/;
const ITEM_ID_RE = /data-item-id="([^"]*)"/;
const ACTOR_ID_RE = /data-actor-id="([^"]*)"/;
const TOKEN_ID_RE = /data-token-id="([^"]*)"/;

function _resolveActor(actorId, tokenId) {
  if (tokenId && game.actors.tokens[tokenId]) return game.actors.tokens[tokenId];
  if (actorId) return game.actors.get(actorId) ?? null;
  return null;
}

function _extractAttackItem(content) {
  const marker = content.match(ATTACK_MARKER);
  if (!marker) return null;

  // Slice from the matched anchor's opening tag so the id lookups below
  // can't accidentally grab attributes from some other element in the card.
  const tagStart = content.lastIndexOf('<a', marker.index);
  const tagEnd = content.indexOf('>', marker.index);
  const tag = content.slice(tagStart, tagEnd + 1);

  const itemId = tag.match(ITEM_ID_RE)?.[1];
  if (!itemId) return null;
  const actorId = tag.match(ACTOR_ID_RE)?.[1];
  const tokenId = tag.match(TOKEN_ID_RE)?.[1];

  const actor = _resolveActor(actorId, tokenId);
  return actor?.items?.get(itemId) ?? null;
}

function _onCreateChatMessage(message) {
  // Only the client that rolled it triggers playback. AudioHelper's second
  // argument broadcasts to every connected client, so if every client also
  // triggered it here, everyone would hear the sound once per client.
  const authorId = message.author?.id ?? message.user?.id;
  if (authorId !== game.user.id) return;

  const item = _extractAttackItem(message.content ?? '');
  if (!item) return;

  const soundPath = getSound(item);
  if (!soundPath) return;

  AudioHelper.play({ src: soundPath, volume: getVolume(item) }, true);
}

export function registerAttackSoundHooks() {
  Hooks.on('createChatMessage', _onCreateChatMessage);
}
