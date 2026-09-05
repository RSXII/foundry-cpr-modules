// Flags read/write layer. Nothing outside this file should touch
// item.setFlag/unsetFlag for the "cpr-attack-sfx" scope directly.

export const MODULE_ID = 'cpr-attack-sfx';

export const DEFAULT_VOLUME = 0.8;

export function getSound(item) {
  return item?.getFlag(MODULE_ID, 'soundPath') || null;
}

export function getVolume(item) {
  const v = item?.getFlag(MODULE_ID, 'volume');
  return typeof v === 'number' ? v : DEFAULT_VOLUME;
}

export async function setSound(item, path) {
  await item.setFlag(MODULE_ID, 'soundPath', path);
}

export async function clearSound(item) {
  await item.unsetFlag(MODULE_ID, 'soundPath');
}

export async function setVolume(item, volume) {
  await item.setFlag(MODULE_ID, 'volume', volume);
}
