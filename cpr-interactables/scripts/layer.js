import { MODULE_ID, getHotspots, createHotspot, updateHotspot, confirmDeleteHotspot, radiusPixels } from './data.js';
import { openHotspotConfig } from './hotspot-config.js';

export const CONTROL_LAYER_NAME = 'cprInteractablesLayer';

const MARKER_COLOR = 0x3ee6ff;
const DRAG_THRESHOLD_PX = 6;
const SPARKLE_GLYPH = '✨';
const SPARKLE_PERIOD_MS = 1400;

function drawMarkerCircle(marker, radiusPx) {
  marker.lineStyle(2, MARKER_COLOR, 0.85);
  marker.beginFill(MARKER_COLOR, 0.12);
  marker.drawCircle(0, 0, radiusPx);
  marker.endFill();
}

/**
 * GM-only editing surface: renders every hotspot on the current scene as a
 * translucent circle, visible and interactive only while this control group
 * is the active layer (so players — and a GM back on the Token layer during
 * play — never see the trigger zones, same as a poster's actual artwork
 * already being part of the scene background).
 */
export class HotspotLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }

  async _draw(options) {
    await super._draw(options);

    this.hotspotsContainer = this.addChild(new PIXI.Container());
    this.hotspotsContainer.visible = false;
    this.hotspotsContainer.eventMode = 'static';

    // Always-on player-facing affordance — unlike hotspotsContainer above,
    // this stays visible regardless of which control layer is active, the
    // same as Notes pins do.
    this.indicatorsContainer = this.addChild(new PIXI.Container());
    this.indicatorsContainer.eventMode = 'none';

    this.refresh();

    // _draw() can run again on a later scene load against this same,
    // long-lived layer instance — drop any previous instance's ticker
    // callback first so pulses don't stack up and speed up over time.
    if (this._sparkleTicker) canvas.app.ticker.remove(this._sparkleTicker);
    this._sparkleTicker = () => this._animateSparkles();
    canvas.app.ticker.add(this._sparkleTicker);
  }

  /** Redraws every marker/indicator from the scene's current hotspot flags. */
  refresh() {
    if (!this.hotspotsContainer) return;
    for (const child of this.hotspotsContainer.removeChildren()) child.destroy({ children: true });
    for (const child of this.indicatorsContainer.removeChildren()) child.destroy({ children: true });
    if (!canvas.scene) return;

    for (const hotspot of getHotspots(canvas.scene)) {
      this.hotspotsContainer.addChild(this._buildMarker(hotspot));
      if (hotspot.showIndicator) this.indicatorsContainer.addChild(this._buildIndicator(hotspot));
    }
    this.updateIndicatorVisibility();
  }

  _buildIndicator(hotspot) {
    const sparkle = new PIXI.Text(SPARKLE_GLYPH, { fontSize: 20 });
    sparkle.anchor.set(0.5);
    sparkle.position.set(hotspot.x, hotspot.y);
    // Staggered per-marker so a field of sparkles doesn't pulse in lockstep.
    sparkle._cpriPhase = Math.random() * Math.PI * 2;
    sparkle._cpriHotspot = hotspot;
    return sparkle;
  }

  _animateSparkles() {
    if (!this.indicatorsContainer?.children.length) return;
    const t = (performance.now() / SPARKLE_PERIOD_MS) * Math.PI * 2;
    for (const sparkle of this.indicatorsContainer.children) {
      const pulse = 0.5 + 0.5 * Math.sin(t + sparkle._cpriPhase);
      sparkle.alpha = 0.35 + 0.65 * pulse;
      sparkle.scale.set(0.8 + 0.3 * pulse);
    }
  }

  /**
   * Gates each sparkle by `nearbyIds` — the set of hotspot ids proximity.js
   * just determined at least one of this client's tokens is both within
   * reach of and has a sight line to. Driven from there (not from here)
   * so "the glint is visible" and "the interact key would actually do
   * something" are guaranteed to agree. A GM sees every flagged indicator
   * regardless of range, same as the edit-mode circles' omniscience.
   */
  updateIndicatorVisibility(nearbyIds = new Set()) {
    if (!this.indicatorsContainer) return;
    const isGM = game.user.isGM;
    for (const sparkle of this.indicatorsContainer.children) {
      sparkle.visible = isGM || nearbyIds.has(sparkle._cpriHotspot.id);
    }
  }

  activate() {
    super.activate();
    if (this.hotspotsContainer) {
      this.hotspotsContainer.visible = true;
      this.hotspotsContainer.interactiveChildren = true;
    }
  }

  deactivate() {
    super.deactivate();
    if (this.hotspotsContainer) {
      this.hotspotsContainer.visible = false;
      this.hotspotsContainer.interactiveChildren = false;
    }
  }

  /** Clicking empty canvas with the "place" tool active drops a new hotspot here. */
  async _onClickLeft(event) {
    if (!game.user.isGM || game.activeTool !== 'place') return super._onClickLeft(event);

    const pos = event.interactionData?.origin ?? event.getLocalPosition(this);
    const hotspot = await createHotspot(canvas.scene, { x: pos.x, y: pos.y });
    openHotspotConfig(canvas.scene, hotspot.id, { isNew: true });

    // Back to "select" so repeated clicks don't spam more hotspots.
    game.activeTool = 'select';
    ui.controls.render();
  }

  _buildMarker(hotspot) {
    const radiusPx = radiusPixels(hotspot);

    const marker = new PIXI.Graphics();
    marker.eventMode = 'static';
    marker.cursor = 'pointer';
    marker.position.set(hotspot.x, hotspot.y);
    drawMarkerCircle(marker, radiusPx);

    const icon = new PIXI.Text('🖼', { fontSize: 22 });
    icon.anchor.set(0.5);
    marker.addChild(icon);

    if (hotspot.caption) {
      const label = new PIXI.Text(hotspot.caption, {
        fontSize: 14,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3,
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, radiusPx + 4);
      marker.addChild(label);
    }

    this._bindMarkerEvents(marker, hotspot.id);
    return marker;
  }

  /** Left-click (no movement) edits; left-drag repositions; right-click deletes. */
  _bindMarkerEvents(marker, hotspotId) {
    let dragging = false;
    let moved = false;
    let start = null;

    const onMove = (event) => {
      if (!dragging) return;
      const pos = event.getLocalPosition(this.hotspotsContainer);
      if (!moved && Math.hypot(pos.x - start.x, pos.y - start.y) > DRAG_THRESHOLD_PX) moved = true;
      if (moved) marker.position.set(pos.x, pos.y);
    };

    const onUp = async (event) => {
      canvas.stage.off('pointermove', onMove);
      canvas.stage.off('pointerup', onUp);
      canvas.stage.off('pointerupoutside', onUp);
      dragging = false;

      if (moved) {
        const pos = event.getLocalPosition(this.hotspotsContainer);
        await updateHotspot(canvas.scene, hotspotId, { x: pos.x, y: pos.y });
      } else {
        openHotspotConfig(canvas.scene, hotspotId, { isNew: false });
      }
    };

    marker.on('pointerdown', (event) => {
      event.stopPropagation();
      if (!game.user.isGM) return;

      if (event.button === 2) {
        confirmDeleteHotspot(canvas.scene, hotspotId);
        return;
      }
      if (event.button !== 0) return;

      dragging = true;
      moved = false;
      start = event.getLocalPosition(this.hotspotsContainer);
      canvas.stage.on('pointermove', onMove);
      canvas.stage.on('pointerup', onUp);
      canvas.stage.on('pointerupoutside', onUp);
    });
  }
}

export function registerHotspotLayerHooks() {
  Hooks.on('updateScene', (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.hotspots`)) {
      canvas[CONTROL_LAYER_NAME]?.refresh();
    }
  });

  Hooks.on('canvasReady', () => {
    canvas[CONTROL_LAYER_NAME]?.refresh();
  });
}
