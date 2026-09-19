// The one full-page, pointer-events:none container that overlay.js's
// target-locks and vision-effect.js's hijack beam/burst both append into.
// Shared so there's a single stacking layer for every click-through HTML
// element this module draws over the canvas, instead of one per file.

const LAYER_ID = 'cpr-twins-ai-lock-layer';
const VISION_ID = 'cpr-twins-ai-vision';

export function ensureLockLayer() {
  let layer = document.getElementById(LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    // Always inserted immediately before the vision HUD (if it's mounted
    // yet — insertBefore(el, null) falls back to appending at the end,
    // exactly like appendChild, when it isn't) rather than a plain
    // appendChild. Neither this file nor vision-effect.js's mount()
    // guarantees which one initializes first, and paint order between
    // body children follows DOM order here (no z-index on either) — so
    // whichever happened to append second used to win, letting the
    // take-control boxes end up on top of the terminal/HUD chrome instead
    // of the other way around. Fixing this with DOM order instead of a
    // z-index is deliberate: adding one to #cpr-twins-ai-vision itself is
    // exactly what breaks its duotone layer's mix-blend-mode (see that
    // file's own comment on the specific combinations that trap the
    // blend), so this needs to stay z-index-free.
    document.body.insertBefore(layer, document.getElementById(VISION_ID));
  }
  return layer;
}
