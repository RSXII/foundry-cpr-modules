// Reads-only layer: builds the quick-info view model off a token/actor.
// Nothing here writes anything — this module has no state of its own to
// persist, unlike cpr-relations/cpr-vehicle-crew's flag-backed data.js files.

export const MODULE_ID = 'cpr-quick-info';

// CPR's own equip-state enum (CPR.equipped in the system's config.js) is
// "owned" (in inventory, not carried) / "carried" (on their person) /
// "equipped" (currently wielded). Only the latter two are worth surfacing —
// a shotgun sitting in a car trunk isn't part of "what am I looking at".
const CARRIED_STATES = new Set(['carried', 'equipped']);

/**
 * "Enemy", for this module's purposes, is disposition-based rather than
 * ownership-based: anything not FRIENDLY (hostile or neutral) counts,
 * regardless of who owns the actor. That covers ambiguous NPCs a GM hasn't
 * committed to a side yet, and still leaves party members and friendly
 * NPCs alone. Foundry never renders/hovers a token this client can't see
 * (fog of war, GM-hidden), so there's no separate visibility check needed
 * here.
 */
export function isEnemyToken(token) {
  if (!token?.actor) return false;
  return token.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

/**
 * GM-only per-token override (see token-hud.js) that reveals Quick Info for
 * one specific token regardless of the module's table-wide enable()/
 * disable() switch — e.g. after a player calls a Perception check against
 * that target and the GM judges it a hit. Stored on the token *document*,
 * not the actor: mooks are normally unlinked, so five "Ganger" tokens
 * sharing one actor need five independent reveal states, the same reason
 * cpr-twins-ai's claim flag is per-token rather than per-actor.
 */
export function isRevealed(token) {
  return !!token.document.getFlag(MODULE_ID, 'revealed');
}

/**
 * Whether the current client is allowed to see this token's name. Gated on
 * `isRevealed()` — the same GM-controlled per-token flag token-hud.js's eye
 * icon sets — not on the token's own Nameplate display mode.
 *
 * This used to mirror Foundry's nameplate display-mode rules instead
 * (NONE/OWNER/HOVER/ALWAYS), on the theory that a GM who'd already chosen
 * to hide a token's nameplate didn't want this card spoiling it. In
 * practice that mode defaults to NONE for every token in Foundry itself
 * (see common/documents/token.mjs's schema — nobody sets it without
 * deliberately opening Token Config), so that logic meant the name was
 * "Unidentified" for effectively every token, on every table, regardless
 * of GM intent — not a real gate, just permanently off. Tying it to the
 * reveal flag instead means identity now tracks the same in-fiction beat
 * the rest of the card already does: nothing about a target until the GM
 * reveals it.
 */
function canViewName(token) {
  return isRevealed(token);
}

function getWeapons(actor) {
  return (actor.itemTypes?.weapon ?? [])
    .filter((item) => CARRIED_STATES.has(item.system?.equipped))
    .map((item) => ({
      id: item.id,
      name: item.name,
      img: item.img,
      wielded: item.system.equipped === 'equipped'
    }))
    // Wielded weapon(s) first — that's the one about to matter in a fight.
    .sort((a, b) => Number(b.wielded) - Number(a.wielded));
}

function getCyberware(actor) {
  return (actor.itemTypes?.cyberware ?? [])
    .filter((item) => item.system?.isInstalledInActor)
    .map((item) => ({ id: item.id, name: item.name, img: item.img }));
}

/**
 * A CPR character can hold more than one Role item (multiclassing), but
 * only one is ever "active" (`system.roleInfo.activeRole`, a plain name
 * string, not a reference) — showing just that one silently drops any
 * second role a character has. Lists all of them instead, active role
 * first, each with its rank.
 */
function getRoles(actor) {
  const activeName = actor.system?.roleInfo?.activeRole || null;
  return (actor.itemTypes?.role ?? [])
    .map((item) => ({
      id: item.id,
      name: item.name,
      rank: item.system?.rank ?? 0,
      active: item.name === activeName,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.rank - a.rank);
}

/**
 * Discrete wound-state tag (Not/Lightly/Seriously/Mortally Wounded, Dead)
 * rather than exposing exact HP as a number — reads "at a glance" the same
 * way the rest of this card does, not like combat-log bookkeeping. The
 * value stored on the actor is the enum key itself (e.g. "lightlyWounded"),
 * which happens to already be the tail end of its own localization key
 * (`CPR.global.woundState.<value>`, see the system's config.js), so this
 * can reconstruct the label without importing that config just to round-
 * trip a string it already has.
 */
function getWoundState(actor) {
  const key = actor.system?.derivedStats?.currentWoundState;
  if (!key) return null;
  return { key, label: game.i18n.localize(`CPR.global.woundState.${key}`) };
}

function getHumanity(actor) {
  const humanity = actor.system?.derivedStats?.humanity;
  if (!humanity) return null;
  return { value: humanity.value, max: humanity.max };
}

/**
 * Armor SP per location — only locations actually worth reporting, so a
 * mook with no headgear doesn't get a dead "Head 0/0" chip.
 */
function getArmor(actor) {
  const ext = actor.system?.externalData ?? {};
  return [
    { key: 'body', label: 'Body', data: ext.currentArmorBody },
    { key: 'head', label: 'Head', data: ext.currentArmorHead },
    { key: 'shield', label: 'Shield', data: ext.currentArmorShield },
  ]
    .filter((loc) => loc.data?.max > 0)
    .map((loc) => ({ key: loc.key, label: loc.label, value: loc.data.value, max: loc.data.max }));
}

/**
 * Critical Injury items, same "just read what's on the actor" pattern as
 * getWeapons()/getCyberware(). CPR has no healed/treated flag on these — a
 * table deletes the item once it's treated — so anything present is
 * presumed currently active.
 */
function getCriticalInjuries(actor) {
  return (actor.itemTypes?.criticalInjury ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    img: item.img,
    location: item.system?.location
      ? game.i18n.localize(`CPR.global.location.${item.system.location}`)
      : null,
  }));
}

// Long enough for a couple of sentences, short enough to still read as "at
// a glance" rather than the full sheet — the rest stays one click away on
// the actual actor sheet.
const NOTES_MAX_CHARS = 260;

function stripHtml(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

/**
 * `system.information.notes` — CPR's own "Player Notes" field (see the
 * character sheet's lifepath tab and the mook's limited-permission sheet,
 * which surfaces *only* this field of the four under `information`). It's
 * the one bio field the system itself already treats as meant for players
 * to read, not GM-only background — `alias`/`description`/`history` are
 * deliberately left out here for the same reason CPR's own mook "Limited"
 * sheet leaves them out.
 */
function getNotes(actor) {
  const text = stripHtml(actor.system?.information?.notes);
  return text ? truncate(text, NOTES_MAX_CHARS) : null;
}

/** Builds the full render model for the quick-info template off a token. */
export function buildQuickInfo(token) {
  const actor = token.actor;
  const nameVisible = canViewName(token);

  return {
    name: nameVisible ? (token.document.name || actor.name) : 'Unidentified',
    nameHidden: !nameVisible,
    img: actor.img,
    roles: getRoles(actor),
    wound: getWoundState(actor),
    humanity: getHumanity(actor),
    armor: getArmor(actor),
    notes: getNotes(actor),
    criticalInjuries: getCriticalInjuries(actor),
    weapons: getWeapons(actor),
    cyberware: getCyberware(actor)
  };
}
