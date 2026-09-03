// Screen-space geometry for a token placeable. Shared by overlay.js (sizing
// the target-lock bracket) and vision-effect.js (aiming the hijack beam) so
// there's exactly one place that understands how token-local coordinates
// map to page pixels.

/**
 * Screen position of a point in `token`'s own local space (its container
 * origin — top-left, unrotated — is (0, 0)). Going through the token's own
 * worldTransform rather than canvas.stage's means this needs no assumption
 * about what's parented between the two: pan, zoom, and any intermediate
 * layer containers are all already baked in. Foundry keeps a token's own
 * container unrotated (only its inner art mesh rotates, the same reason
 * nameplates and resource bars never render upside down), so a local point
 * like "top-center" stays above the token regardless of the token's facing.
 */
export function tokenLocalToScreen(token, localX, localY) {
  const point = token.worldTransform.apply(new PIXI.Point(localX, localY));
  const rect = canvas.app.view.getBoundingClientRect();
  return { x: rect.left + point.x, y: rect.top + point.y };
}

/**
 * The token's on-screen bounding box in page pixels — top-left corner plus
 * width/height scaled for the current canvas zoom. `worldTransform.a` is
 * the combined x-scale baked into that matrix (canvas zoom * any per-token
 * scale); since the token's own container doesn't rotate, that's also a
 * valid stand-in for the y-scale, so one read covers both axes.
 */
export function getTokenScreenBox(token) {
  const gridSize = canvas.grid.size;
  const widthPx = token.document.width * gridSize;
  const heightPx = token.document.height * gridSize;
  const scale = token.worldTransform.a || 1;
  const topLeft = tokenLocalToScreen(token, 0, 0);
  return { left: topLeft.x, top: topLeft.y, width: widthPx * scale, height: heightPx * scale };
}
