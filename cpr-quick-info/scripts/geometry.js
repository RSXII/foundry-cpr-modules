// Screen-space geometry for a token placeable, just enough to anchor a
// floating card next to it. Deliberately not shared with cpr-twins-ai's own
// token-geometry.js (same underlying technique — canvas.stage's
// worldTransform is the one part of the scene graph PIXI recalculates every
// tick regardless of what's rendered — but these are separate modules that
// don't depend on each other).

/** The token's on-screen bounding box, in page pixels. */
export function getTokenScreenBox(token) {
  const gridSize = canvas.grid.size;
  const widthPx = token.document.width * gridSize;
  const heightPx = token.document.height * gridSize;
  const scale = canvas.stage.worldTransform.a || 1;

  const topLeft = canvas.stage.worldTransform.apply(
    new PIXI.Point(token.document.x, token.document.y)
  );
  const rect = canvas.app.view.getBoundingClientRect();

  return {
    left: rect.left + topLeft.x,
    top: rect.top + topLeft.y,
    width: widthPx * scale,
    height: heightPx * scale
  };
}
