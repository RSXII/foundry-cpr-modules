export const MODULE_ID = 'hdsfnz';
export const CHARACTER_TYPE = `${MODULE_ID}.character`;
export const GEAR_TYPE = `${MODULE_ID}.gear`;

// Flavor-only class metadata (see hdsfnz-foundry-handoff.md) — mottos and
// signature gear are canon from the concept art, abilities are named but
// deliberately not mechanized ("not meant to be a deep tactical system").
// Esper has no motto/gear locked yet, unlike the other four classes.
export const CLASSES = {
  gunner: {
    label: 'Gunner',
    motto: 'Strike From a Distance.',
    abilities: ['Multiple Attacks', 'Stealth'],
    gear: ['AR-9 Sidearm', 'R-77 Specter Rifle'],
  },
  pilot: {
    label: 'Pilot',
    motto: 'Control Beyond Limits.',
    abilities: ['Summoned Gear', 'High Mobility'],
    gear: ['VX-01 Sky Pack', 'MS-02 Falcon'],
  },
  blade: {
    label: 'Blade',
    motto: 'Stand at the Front.',
    abilities: ['Guard Break', 'Taunt'],
    gear: ['GR-09 Jotun', 'SB-01 Aegis'],
  },
  medic: {
    label: 'Medic',
    motto: 'Life Keeps Moving.',
    abilities: ['Adrenaline', 'Revive'],
    gear: ['MX-03 Life Scan', 'MD-01 Heal Drone'],
  },
  esper: {
    label: 'Esper',
    motto: null,
    abilities: ['Mindspike', 'Null Field', 'Read'],
    gear: [],
  },
};

export const GEAR_SLOTS = {
  main: 'Main',
  sub: 'Sub',
  other: 'Other',
};

/**
 * The hdsfnz.character actor this client's HUD/sheet should center on:
 * - GM: whatever token they have controlled or targeted, if it's an
 *   hdsfnz character — falling back to the first one that exists in the
 *   world, so the HUD has something to preview before any token is
 *   selected.
 * - Players: the first hdsfnz character they own. One player-owned unit
 *   at a time keeps this simple; nothing here stops a player from owning
 *   more than one, it just always shows the first.
 */
export function getViewerActor() {
  if (game.user.isGM) {
    const controlled = canvas.tokens?.controlled?.[0]?.actor;
    if (controlled?.type === CHARACTER_TYPE) return controlled;
    const targeted = game.user.targets?.first()?.actor;
    if (targeted?.type === CHARACTER_TYPE) return targeted;
    return game.actors?.find((a) => a.type === CHARACTER_TYPE) ?? null;
  }
  return game.actors?.find((a) => a.type === CHARACTER_TYPE && a.isOwner) ?? null;
}

export function isHudEnabledOnScene(scene) {
  return !!scene?.getFlag(MODULE_ID, 'hudEnabled');
}
