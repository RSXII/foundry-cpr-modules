import { MODULE_ID, getHotspot, updateHotspot, deleteHotspot, confirmDeleteHotspot, DEFAULT_RADIUS_UNITS } from './data.js';

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/hotspot-config.hbs`;

/** GM-only form for one hotspot: pick its image, caption, and trigger radius. */
class HotspotConfigApp extends Application {
  constructor(scene, hotspotId, { isNew = false, ...options } = {}) {
    super(options);
    this.scene = scene;
    this.hotspotId = hotspotId;
    // A stub just created by clicking the map — if this closes without ever
    // saving an image, the stub is removed instead of leaving a dead,
    // image-less hotspot behind.
    this._isNew = isNew;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cpr-interactables-config',
      title: 'Hotspot',
      template: TEMPLATE_PATH,
      classes: ['cpr-interactables-config'],
      width: 360,
      height: 'auto',
      resizable: false,
      popOut: true,
    });
  }

  getData() {
    const hotspot = getHotspot(this.scene, this.hotspotId);
    return { ...hotspot, isNew: this._isNew };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="pick-image"]').on('click', (ev) => {
      ev.preventDefault();
      const picker = new FilePicker({
        type: 'image',
        current: html.find('[name="img"]').val(),
        callback: (path) => {
          html.find('[name="img"]').val(path);
          html.find('[data-preview]').attr('src', path).show();
        },
      });
      picker.render(true);
    });

    html.find('[data-action="save"]').on('click', async (ev) => {
      ev.preventDefault();
      const img = html.find('[name="img"]').val().trim();
      const caption = html.find('[name="caption"]').val().trim();
      const radius = Math.max(0.25, Number(html.find('[name="radius"]').val()) || DEFAULT_RADIUS_UNITS);
      const showIndicator = html.find('[name="showIndicator"]').is(':checked');

      if (!img) {
        ui.notifications.warn('Pick an image before saving this hotspot.');
        return;
      }

      await updateHotspot(this.scene, this.hotspotId, { img, caption, radius, showIndicator });
      this._isNew = false;
      this.close();
    });

    html.find('[data-action="delete"]').on('click', async (ev) => {
      ev.preventDefault();
      const confirmed = await confirmDeleteHotspot(this.scene, this.hotspotId);
      if (confirmed) this.close();
    });

    html.find('[data-action="cancel"]').on('click', (ev) => {
      ev.preventDefault();
      this.close();
    });
  }

  async close(options) {
    if (this._isNew && !getHotspot(this.scene, this.hotspotId)?.img) {
      await deleteHotspot(this.scene, this.hotspotId);
    }
    return super.close(options);
  }
}

let openApp = null;

export function openHotspotConfig(scene, hotspotId, { isNew = false } = {}) {
  openApp?.close();
  openApp = new HotspotConfigApp(scene, hotspotId, { isNew });
  openApp.render(true, { focus: true });
}
