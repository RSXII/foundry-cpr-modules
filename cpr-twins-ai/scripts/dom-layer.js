// The one full-page, pointer-events:none container that overlay.js's
// target-locks and vision-effect.js's hijack beam/burst both append into.
// Shared so there's a single stacking layer for every click-through HTML
// element this module draws over the canvas, instead of one per file.

const LAYER_ID = 'cpr-twins-ai-lock-layer';

export function ensureLockLayer() {
  let layer = document.getElementById(LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    document.body.appendChild(layer);
  }
  return layer;
}
