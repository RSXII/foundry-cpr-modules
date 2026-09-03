import {
  MODULE_ID,
  isVehicle,
  getSeats,
  ensureSeatsSeeded,
  addSeat,
  updateSeat,
  removeSeat,
  assignOccupant,
  clearOccupant,
} from './data.js';
import { findVehicleToken, snapOccupantToSeat, captureSeatOffset } from './token-follow.js';
import { accessLevelFor, setSeatAccess } from './permissions.js';

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/crew-section.hbs`;

function _resolveOccupant(seat) {
  if (!seat.occupantUuid) return null;
  try {
    return fromUuidSync(seat.occupantUuid);
  } catch (e) {
    return null;
  }
}

function _prepareSeats(vehicleActor) {
  return getSeats(vehicleActor)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((seat) => {
      const occupantActor = _resolveOccupant(seat);
      if (!occupantActor) return { ...seat, occupant: null };

      const access = accessLevelFor(vehicleActor, occupantActor) ?? 'none';
      return {
        ...seat,
        occupant: {
          uuid: occupantActor.uuid,
          name: occupantActor.name,
          img: occupantActor.img,
          accessNone: access === 'none',
          accessObserver: access === 'observer',
          accessOwner: access === 'owner',
        },
      };
    });
}

async function _insertCrewSection(app, html) {
  const actor = app.actor;
  if (!isVehicle(actor)) return;

  if (game.user.isGM) await ensureSeatsSeeded(actor);

  const seats = _prepareSeats(actor);
  const rendered = await renderTemplate(TEMPLATE_PATH, {
    seats,
    hasSeats: seats.length > 0,
    editable: game.user.isGM,
  });

  const anchor = html.find('section.vehicle-notes');
  if (anchor.length) {
    anchor.before(rendered);
  } else {
    html.find('form').append(rendered);
  }

  if (!game.user.isGM) return;
  _bindListeners(app, html, actor);
}

function _bindListeners(app, html, actor) {
  html.find('.crew-add-seat').on('click', async (ev) => {
    ev.preventDefault();
    new Dialog({
      title: 'Add Seat',
      content: `<form><div class="form-group"><label>Label</label><input type="text" name="label" value="Seat"/></div></form>`,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: 'Add',
          callback: async (dialogHtml) => {
            const label = dialogHtml.find('[name="label"]').val();
            await addSeat(actor, label);
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'add',
    }).render(true);
  });

  html.find('.crew-edit-seat').on('click', async (ev) => {
    ev.preventDefault();
    const seatId = ev.currentTarget.dataset.seatId;
    const seat = getSeats(actor).find((s) => s.id === seatId);
    if (!seat) return;

    // Set only when Capture actually runs — the resulting offsetX/offsetY
    // are freshly computed from the vehicle's current center/rotation, so
    // they're guaranteed correct under the current scheme. Hand-typed edits
    // don't get this: if the seat hasn't gone through the offset-origin
    // migration yet, forcing offsetOrigin here would wrongly mark still-old
    // values as already-migrated and skip the auto-conversion for good.
    let capturedOrigin = false;

    new Dialog({
      title: `Edit Seat: ${seat.label}`,
      content: `
        <form>
          <div class="form-group">
            <label>Label</label>
            <input type="text" name="label" value="${seat.label}"/>
          </div>
          <div class="form-group">
            <label>Offset X (px from vehicle center, facing rotation 0)</label>
            <input type="number" name="offsetX" value="${seat.offsetX || 0}"/>
          </div>
          <div class="form-group">
            <label>Offset Y (px from vehicle center, facing rotation 0)</label>
            <input type="number" name="offsetY" value="${seat.offsetY || 0}"/>
          </div>
          <div class="form-group">
            <button type="button" class="crew-capture-offset">
              <i class="fas fa-crosshairs"></i> Capture from selected token
            </button>
            <p class="hint">Drag a token to where this seat should sit on the
              vehicle, select it, then click Capture to fill in Offset X/Y —
              no pixel-math guessing required.</p>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="matchRotation" ${seat.matchRotation ? 'checked' : ''}/>
              Rotate with vehicle
            </label>
          </div>
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (dialogHtml) => {
            const form = dialogHtml[0].querySelector('form');
            const fd = new FormDataExtended(form).object;
            await updateSeat(actor, seatId, capturedOrigin ? { ...fd, offsetOrigin: 'center' } : fd);
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'save',
      render: (dialogHtml) => {
        dialogHtml.find('.crew-capture-offset').on('click', (ev) => {
          ev.preventDefault();
          const controlled = canvas.tokens.controlled;
          if (controlled.length !== 1) {
            ui.notifications.warn('Select exactly one token on the canvas to capture its position.');
            return;
          }
          const vehicleToken = findVehicleToken(actor, app.token);
          if (!vehicleToken) {
            ui.notifications.warn("Could not find this vehicle's token on the current scene.");
            return;
          }
          const { offsetX, offsetY } = captureSeatOffset(vehicleToken, controlled[0].document);
          dialogHtml.find('[name="offsetX"]').val(offsetX);
          dialogHtml.find('[name="offsetY"]').val(offsetY);
          capturedOrigin = true;
        });
      },
    }).render(true);
  });

  html.find('.crew-delete-seat').on('click', async (ev) => {
    ev.preventDefault();
    const seatId = ev.currentTarget.dataset.seatId;
    const confirmed = await Dialog.confirm({
      title: 'Delete Seat',
      content: '<p>Delete this seat? Any occupant is unassigned, not moved.</p>',
    });
    if (confirmed) await removeSeat(actor, seatId);
  });

  html.find('.crew-assign').on('click', async (ev) => {
    ev.preventDefault();
    const seatId = ev.currentTarget.dataset.seatId;
    await _assignControlledToken(app, actor, seatId);
  });

  html.find('.crew-remove-occupant').on('click', async (ev) => {
    ev.preventDefault();
    const seatId = ev.currentTarget.dataset.seatId;
    await clearOccupant(actor, seatId);
  });

  html.find('.crew-access').on('change', async (ev) => {
    const seatId = ev.currentTarget.dataset.seatId;
    const seat = getSeats(actor).find((s) => s.id === seatId);
    const occupantActor = seat?.occupantUuid ? fromUuidSync(seat.occupantUuid) : null;
    if (!occupantActor) return;
    await setSeatAccess(actor, occupantActor, ev.currentTarget.value);
  });

  html.find('.drop-zone').each((i, el) => {
    el.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('dragover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      el.classList.remove('dragover');
      const seatId = el.dataset.seatId;
      let data;
      try {
        data = TextEditor.getDragEventData(ev);
      } catch (e) {
        return;
      }
      if (!data || data.type !== 'Actor') return;
      const occupantActor = await fromUuid(data.uuid);
      if (!occupantActor || occupantActor.id === actor.id) return;
      await _seatOccupant(actor, seatId, occupantActor);
    });
  });
}

async function _assignControlledToken(app, actor, seatId) {
  const controlled = canvas.tokens.controlled;
  if (controlled.length === 0) {
    ui.notifications.warn('Select a token on the canvas first.');
    return;
  }
  if (controlled.length > 1) {
    ui.notifications.warn('Select only one token.');
    return;
  }
  const occupantActor = controlled[0].actor;
  if (!occupantActor || occupantActor.id === actor.id) return;
  await _seatOccupant(actor, seatId, occupantActor, app.token);
}

async function _seatOccupant(vehicleActor, seatId, occupantActor, sheetToken = null) {
  const seat = await assignOccupant(vehicleActor, seatId, occupantActor);
  if (!seat) return;
  const vehicleToken = findVehicleToken(vehicleActor, sheetToken);
  if (vehicleToken) await snapOccupantToSeat(vehicleToken, occupantActor, seat);
}

export function registerSheetInjectorHooks() {
  Hooks.on('renderActorSheet', (app, html) => {
    _insertCrewSection(app, html);
  });
}
