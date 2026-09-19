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
 * Whether the current client is allowed to see this token's name, mirroring
 * Foundry's own nameplate display-mode rules rather than ignoring them. A
 * GM running an "unidentified ganger" beat has already chosen DISPLAY_MODES
 * NONE/OWNER for that reason — this card shouldn't spoil it just because
 * hovering reveals more detail than the nameplate does.
 */
function canViewName(token) {
  const DM = CONST.TOKEN_DISPLAY_MODES;
  const mode = token.document.displayName;
  const isOwner = token.actor?.isOwner ?? false;
  switch (mode) {
    case DM.ALWAYS:
    case DM.HOVER:
      return true;
    case DM.OWNER:
    case DM.OWNER_HOVER:
    case DM.CONTROL:
      return isOwner;
    case DM.NONE:
    default:
      return false;
  }
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
    role: actor.system?.roleInfo?.activeRole || null,
    notes: getNotes(actor),
    weapons: getWeapons(actor),
    cyberware: getCyberware(actor)
  };
}
