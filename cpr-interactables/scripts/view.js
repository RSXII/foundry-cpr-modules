// Opens a hotspot's "view". Only one type exists today — an image, shown
// via Foundry's own ImagePopout (zoomable, closable, and a GM gets its
// built-in "share with players" button for free) — but this is the one
// seam meant to grow if a future hotspot type isn't just a picture.
export function openHotspotView(hotspot) {
  if (!hotspot?.img) return;
  new ImagePopout(hotspot.img, {
    title: hotspot.caption || 'Hotspot',
    shareable: game.user.isGM,
  }).render(true);
}
