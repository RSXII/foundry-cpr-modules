// Flags read/write layer for hotspots. Nothing outside this file should
// touch scene.getFlag/setFlag for the "cpr-interactables" scope directly.
//
// A hotspot is stored as a plain object in a single array flag on the
// Scene, not a real embedded document — adding a genuinely new embedded
// document type to Scene is a system-level change, out of reach for a
// module. The array-of-plain-objects approach is enough here: GM writes go
// through setFlag, which Foundry already broadcasts to every client as a
// normal updateScene, so there's no socket code needed to keep everyone in
// sync.

export const MODULE_ID = 'cpr-interactables';

const HOTSPOTS_FLAG = 'hotspots';

// Grid squares, not pixels — storing the trigger radius in grid units means
// it scales sensibly if a GM ever changes this scene's grid size later,
// instead of silently becoming the wrong physical size.
export const DEFAULT_RADIUS_UNITS = 0.75;

export function getHotspots(scene) {
  return scene?.getFlag(MODULE_ID, HOTSPOTS_FLAG) ?? [];
}

export function getHotspot(scene, id) {
  return getHotspots(scene).find((h) => h.id === id) ?? null;
}

/** Creates a bare stub at (x, y) with no image yet, and returns it. */
export async function createHotspot(scene, { x, y }) {
  const hotspot = {
    id: foundry.utils.randomID(),
    x,
    y,
    radius: DEFAULT_RADIUS_UNITS,
    img: '',
    caption: '',
    showIndicator: true,
  };
  await scene.setFlag(MODULE_ID, HOTSPOTS_FLAG, [...getHotspots(scene), hotspot]);
  return hotspot;
}

export async function updateHotspot(scene, id, changes) {
  const hotspots = getHotspots(scene).map((h) => (h.id === id ? { ...h, ...changes } : h));
  await scene.setFlag(MODULE_ID, HOTSPOTS_FLAG, hotspots);
}

export async function deleteHotspot(scene, id) {
  const hotspots = getHotspots(scene).filter((h) => h.id !== id);
  await scene.setFlag(MODULE_ID, HOTSPOTS_FLAG, hotspots);
}

/** Confirms with the GM, then deletes — shared by the marker's right-click and the config dialog's Delete button. */
export async function confirmDeleteHotspot(scene, id) {
  const hotspot = getHotspot(scene, id);
  const confirmed = await Dialog.confirm({
    title: 'Delete Hotspot',
    content: `<p>Delete ${hotspot?.caption ? `"${hotspot.caption}"` : 'this hotspot'}? This cannot be undone.</p>`,
  });
  if (confirmed) await deleteHotspot(scene, id);
  return confirmed;
}

/** A hotspot's trigger radius in canvas pixels, against the live canvas grid. */
export function radiusPixels(hotspot) {
  return hotspot.radius * (canvas.grid?.size ?? 100);
}
