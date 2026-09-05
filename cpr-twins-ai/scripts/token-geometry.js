// Screen-space geometry for a token placeable. Shared by overlay.js (sizing
// the target-lock bracket) and vision-effect.js (aiming the hijack beam) so
// there's exactly one place that understands how token-local coordinates
// map to page pixels.

/**
 * Screen position of a point in `token`'s own local space (its container
 * origin — top-left, unrotated — is (0, 0)). Foundry keeps a token's own
 * container unrotated (only its inner art mesh rotates, the same reason
 * nameplates and resource bars never render upside down), so a local point
 * like "top-center" stays above the token regardless of the token's facing.
 *
 * Deliberately built from canvas.stage's worldTransform plus the token's
 * raw document x/y, NOT from the token's own worldTransform. PIXI only
 * recalculates a display object's worldTransform as part of actually
 * rendering it — once Foundry stops drawing a token (hidden by another
 * player's vision), its worldTransform freezes at wherever the camera was
 * the last moment it was visible, and stays frozen even as the camera keeps
 * panning. canvas.stage is the root of the scene graph: the render loop
 * recalculates its own transform every tick regardless of any child's
 * visibility, so it never goes stale. Combined with the token's document
 * x/y (plain data, always current regardless of render state), this keeps
 * tracking a token that's genuinely invisible right now — which is exactly
 * what this module's "wallhack" outline needs: it's meant to follow a
 * hidden token's real position, not the last place it was rendered.
 */
export function tokenLocalToScreen(token, localX, localY) {
  const point = canvas.stage.worldTransform.apply(
    new PIXI.Point(token.document.x + localX, token.document.y + localY),
  );
  const rect = canvas.app.view.getBoundingClientRect();
  return { x: rect.left + point.x, y: rect.top + point.y };
}

/**
 * The token's on-screen bounding box in page pixels — top-left corner plus
 * width/height scaled for the current canvas zoom. canvas.stage's
 * worldTransform.a is the combined x-scale (canvas zoom); since the token's
 * own container doesn't rotate, that's also a valid stand-in for the
 * y-scale, so one read covers both axes.
 */
export function getTokenScreenBox(token) {
  const gridSize = canvas.grid.size;
  const widthPx = token.document.width * gridSize;
  const heightPx = token.document.height * gridSize;
  const scale = canvas.stage.worldTransform.a || 1;
  const topLeft = tokenLocalToScreen(token, 0, 0);
  return { left: topLeft.x, top: topLeft.y, width: widthPx * scale, height: heightPx * scale };
}
