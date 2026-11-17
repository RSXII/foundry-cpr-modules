// "Configure Expressions…" window: the per-actor emotions editor, plus the
// bulk-upload match screen that replaces uploading and assigning images one
// at a time. One Application instance per actor (see openSetupAppFor),
// matching ../cpr-relations's one-instance-per-actor pattern for its
// Personal File app.

import {
  MODULE_ID,
  getConfig,
  getDefaultEmotion,
  setShowName,
  setDefaultEmotion,
  addEmotion,
  updateEmotion,
  removeEmotion,
} from './data.js';
import { refreshOverlay } from './stage-overlay.js';

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/setup-app.hbs`;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "rache_happy.png" -> "Happy"; strips the actor's own name out of the
// guess so a multi-actor export batch (e.g. "nix_angry.png") doesn't end up
// with it baked into the label. Exact port of the mockup's version.
function guessLabelFromFilename(filename, actorName) {
  const base = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  let words = base.split(/\s+/).filter(Boolean);
  const stripped = words.filter((w) => w.toLowerCase() !== actorName.toLowerCase());
  if (stripped.length) words = stripped;
  if (!words.length) return 'New Emotion';
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function uploadStandImage(actor, file) {
  const dir = `worlds/${game.world.id}/${MODULE_ID}/${actor.id}`;
  try {
    await FilePicker.createDirectory('data', dir);
  } catch (err) {
    // Already exists — createDirectory rejects for that case, which is fine to swallow.
  }
  const response = await FilePicker.upload('data', dir, file, {});
  return response?.path ?? null;
}

const openApps = new Map();

/** Reuses an already-open window for this actor instead of stacking duplicates. */
export function openSetupAppFor(actor) {
  let app = openApps.get(actor.id);
  if (!app) {
    app = new VnSetupApp(actor);
    openApps.set(actor.id, app);
  }
  app.render(true, { focus: true });
}

export class VnSetupApp extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this._bulkRows = null; // set while the match modal is open; null otherwise
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cpr-vn-setup',
      classes: ['cpr-vn-setup-app'],
      template: TEMPLATE_PATH,
      width: 480,
      height: 'auto',
      resizable: true,
    });
  }

  get title() {
    return `${this.actor.name} — Expressions`;
  }

  getData() {
    const cfg = getConfig(this.actor);
    const emotions = cfg.emotions.map((e) => ({
      ...e,
      isDefault: e.id === cfg.defaultId,
      canDelete: cfg.emotions.length > 1 && e.id !== cfg.defaultId,
    }));
    return {
      actor: this.actor,
      showName: cfg.showName,
      defaultEmotion: getDefaultEmotion(this.actor),
      emotions,
    };
  }

  close(options) {
    openApps.delete(this.actor.id);
    // The bulk modal is appended to document.body, outside this window's
    // own DOM — closing the window wouldn't otherwise take it down too,
    // leaving an orphaned backdrop stuck on screen.
    this._closeBulkModal();
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-nametoggle]').on('click', async (ev) => {
      await setShowName(this.actor, ev.currentTarget.dataset.nametoggle === 'show');
      refreshOverlay();
      this.render();
    });

    html.find('[data-emdefault]').on('click', async (ev) => {
      await setDefaultEmotion(this.actor, ev.currentTarget.dataset.emdefault);
      refreshOverlay();
      this.render();
    });

    html.find('[data-emdelete]').on('click', async (ev) => {
      if (ev.currentTarget.disabled) return;
      await removeEmotion(this.actor, ev.currentTarget.dataset.emdelete);
      refreshOverlay();
      this.render();
    });

    html.find('[data-emname]').on('change', async (ev) => {
      await updateEmotion(this.actor, ev.currentTarget.dataset.emname, { label: ev.currentTarget.value });
      refreshOverlay();
    });

    html.find('.cpr-vn-add-emotion-btn').on('click', async () => {
      const id = await addEmotion(this.actor, { label: 'New Emotion', img: null });
      refreshOverlay();
      this.render();
      setTimeout(() => html.find(`[data-emname="${id}"]`).trigger('focus').trigger('select'), 0);
    });

    const dropzone = html.find('.cpr-vn-dropzone')[0];
    const fileInput = html.find('.cpr-vn-file-input')[0];
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) this._openBulkModal(Array.from(fileInput.files));
        fileInput.value = '';
      });
      dropzone.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
      dropzone.addEventListener('drop', (ev) => {
        ev.preventDefault();
        dropzone.classList.remove('is-dragover');
        const files = Array.from(ev.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
        if (files.length) this._openBulkModal(files);
      });
    }
  }

  /* -------------------------------------------------------------- *
   * Bulk upload match screen
   * -------------------------------------------------------------- */

  _revokeBulkUrls() {
    this._bulkRows?.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    this._bulkRows = null;
  }

  _openBulkModal(files) {
    const cfg = getConfig(this.actor);
    const byLabel = new Map(cfg.emotions.map((e) => [e.label.toLowerCase(), e.id]));
    this._bulkRows = files.map((file) => {
      const label = guessLabelFromFilename(file.name, this.actor.name);
      return {
        file,
        name: file.name,
        label,
        previewUrl: URL.createObjectURL(file),
        target: byLabel.get(label.toLowerCase()) ?? 'new',
      };
    });
    this._renderBulkModal();
  }

  _closeBulkModal() {
    document.querySelector('.cpr-vn-modal-backdrop')?.remove();
    this._revokeBulkUrls();
  }

  _renderBulkModal() {
    document.querySelector('.cpr-vn-modal-backdrop')?.remove();
    const rows = this._bulkRows;
    if (!rows) return;
    const cfg = getConfig(this.actor);

    const backdrop = document.createElement('div');
    backdrop.className = 'cpr-vn-modal-backdrop';
    backdrop.innerHTML = `
      <div class="cpr-vn-bulk-modal">
        <div class="cpr-vn-bulk-head">
          <div class="cpr-vn-bulk-title">Match images to expressions &mdash; ${esc(this.actor.name)}</div>
          <div class="cpr-vn-bulk-sub">${rows.length} image${rows.length === 1 ? '' : 's'} picked up. We guessed a label from each filename &mdash; fix any that are wrong, and point an image at an existing expression instead of "New emotion" to replace its art.</div>
        </div>
        <div class="cpr-vn-bulk-rows">
          ${rows
            .map((r, i) => {
              const isReplace = r.target !== 'new';
              const opts = `<option value="new">+ New emotion</option>${cfg.emotions
                .map((e) => `<option value="${e.id}" ${r.target === e.id ? 'selected' : ''}>Replace: ${esc(e.label)}</option>`)
                .join('')}`;
              return `<div class="cpr-vn-bulk-row" data-row="${i}">
                <img class="cpr-vn-bulk-thumb" src="${r.previewUrl}" alt="" />
                <div class="cpr-vn-bulk-fields">
                  <input class="cpr-vn-bulk-label" data-bulklabel="${i}" value="${esc(r.label)}" />
                  <div class="cpr-vn-bulk-filename">${esc(r.name)}</div>
                </div>
                <select class="cpr-vn-bulk-select ${isReplace ? 'is-replace' : ''}" data-bulktarget="${i}">${opts}</select>
                <button type="button" class="cpr-vn-icon-btn" data-bulkremove="${i}" title="Remove this image from the import"><i class="fas fa-trash"></i></button>
              </div>`;
            })
            .join('')}
        </div>
        <div class="cpr-vn-bulk-foot">
          <button type="button" class="cpr-vn-modal-btn" data-bulkcancel>Cancel</button>
          <button type="button" class="cpr-vn-modal-btn cpr-vn-modal-btn-primary" data-bulkimport ${rows.length ? '' : 'disabled'}>Import ${rows.length} image${rows.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) this._closeBulkModal();
    });
    backdrop.querySelector('[data-bulkcancel]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._closeBulkModal();
    });
    backdrop.querySelector('[data-bulkimport]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._commitBulkModal();
    });
    backdrop.querySelectorAll('[data-bulklabel]').forEach((input) => {
      input.addEventListener('input', () => {
        rows[Number(input.dataset.bulklabel)].label = input.value;
      });
    });
    backdrop.querySelectorAll('[data-bulktarget]').forEach((select) => {
      select.addEventListener('change', () => {
        rows[Number(select.dataset.bulktarget)].target = select.value;
        this._renderBulkModal();
      });
    });
    backdrop.querySelectorAll('[data-bulkremove]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(btn.dataset.bulkremove);
        URL.revokeObjectURL(rows[idx].previewUrl);
        rows.splice(idx, 1);
        this._renderBulkModal();
      });
    });
  }

  async _commitBulkModal() {
    const rows = this._bulkRows ?? [];
    this._closeBulkModal();
    if (!rows.length) return;

    ui.notifications.info(`Uploading ${rows.length} image${rows.length === 1 ? '' : 's'} for ${this.actor.name}…`);
    for (const row of rows) {
      let path;
      try {
        // eslint-disable-next-line no-await-in-loop -- uploads must land in filename order, not racing
        path = await uploadStandImage(this.actor, row.file);
      } catch (err) {
        console.error(`${MODULE_ID} | failed to upload`, row.name, err);
        ui.notifications.error(`Failed to upload ${row.name} — see console.`);
        continue;
      }
      if (!path) {
        // Foundry's FilePicker.upload resolves falsy (rather than throwing)
        // on some rejected uploads (e.g. a storage/permission issue) — this
        // case matters just as much as the thrown one above, so it gets
        // the same visible notification instead of silently skipping.
        console.error(`${MODULE_ID} | upload returned no path`, row.name);
        ui.notifications.error(`Failed to upload ${row.name} — see console.`);
        continue;
      }
      if (row.target === 'new') {
        // eslint-disable-next-line no-await-in-loop
        await addEmotion(this.actor, { label: row.label || 'New Emotion', img: path });
      } else {
        const patch = { img: path };
        if (row.label) patch.label = row.label;
        // eslint-disable-next-line no-await-in-loop
        await updateEmotion(this.actor, row.target, patch);
      }
    }
    refreshOverlay();
    this.render();
  }
}
