// CPR Terminal module
//
// Opens the FCOS app (../../skamterminal — a fake in-browser OS) inside a
// Foundry window, via a plain iframe. FCOS reads/writes the same Firebase
// project as the fate-city-1999 "Wire" phone app, so nothing here needs to
// sync anything itself — except the GM "send location" signal below, which
// this module writes and every client (GM and players) listens for.

const MODULE_ID = 'cpr-terminal';
const CONTROL_LAYER_NAME = 'cprTerminalLayer';

// Same shared Firebase project as skamterminal/lib/firebase.ts and
// fate-city-1999/src/lib/firebase-db.js. Foundry modules load as plain
// browser ES modules with no bundler, so this talks to both Firebase APIs
// over bare REST (fetch + EventSource) rather than pulling in the SDKs.
const RTDB_BASE = 'https://cpr-wire-device-default-rtdb.firebaseio.com';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/cpr-wire-device/databases/(default)/documents';

// The Terminal control group has no real canvas tools, only action buttons
// — but Foundry's scene-control click handler only re-renders the toolbar
// when the click actually causes a layer transition. Pointing `layer` at
// an existing, already-active layer would make the click a no-op.
// Registering a real (if empty) layer for the group to target guarantees
// every click is a genuine transition. (Same pattern as
// ../fate-city-1999/foundry-module-phone's Fc99PhoneLayer.)
class CprTerminalLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: CONTROL_LAYER_NAME });
  }
}

class FcosTerminalApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cpr-terminal-app',
      title: 'FCOS',
      template: `modules/${MODULE_ID}/templates/terminal.html`,
      classes: ['cpr-terminal-app'],
      width: 1540,
      height: 1008,
      resizable: true,
      popOut: true,
    });
  }

  getData() {
    return { url: game.settings.get(MODULE_ID, 'terminalUrl') };
  }
}

/** Unwraps a Firestore REST field value — this module only ever reads stringValue fields. */
function fsString(fields, key) {
  return fields?.[key]?.stringValue ?? '';
}

/** Every district + location entity, for the Send Location picker. Always fetched fresh — the roster changes as the GM adds locations on the map. */
async function fetchNavigableEntities() {
  const districts = [];
  const locations = [];
  let pageToken = '';
  do {
    const url = new URL(`${FIRESTORE_BASE}/entities`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore request failed (${res.status})`);
    const data = await res.json();
    for (const doc of data.documents ?? []) {
      const id = doc.name.split('/').pop();
      const fields = doc.fields ?? {};
      const kind = fsString(fields, 'kind');
      const name = fsString(fields, 'name') || id;
      if (kind === 'district') districts.push({ id, name });
      else if (kind === 'location') locations.push({ id, name, districtId: fsString(fields, 'district') });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  districts.sort((a, b) => a.name.localeCompare(b.name));
  locations.sort((a, b) => a.name.localeCompare(b.name));
  return { districts, locations };
}

/** GM-only dialog: pick a district (and optionally a location inside it) and broadcast it to every connected FCOS terminal. */
class SendLocationApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cpr-terminal-send-location',
      title: 'Send Location',
      template: `modules/${MODULE_ID}/templates/send-location.html`,
      classes: ['cpr-terminal-send-location'],
      width: 360,
      height: 'auto',
      resizable: false,
      popOut: true,
    });
  }

  async getData() {
    try {
      const { districts, locations } = await fetchNavigableEntities();
      return { districts, locations, loadError: null };
    } catch (err) {
      console.error('cpr-terminal | failed to load entities', err);
      return { districts: [], locations: [], loadError: err.message };
    }
  }

  activateListeners(html) {
    super.activateListeners(html);
    const districtSelect = html.find('[name="districtId"]')[0];
    const locationSelect = html.find('[name="locationId"]')[0];
    if (!districtSelect || !locationSelect) return; // load error — form didn't render

    const syncLocations = () => {
      const districtId = districtSelect.value;
      for (const opt of locationSelect.options) {
        opt.hidden = opt.value !== '' && opt.dataset.district !== districtId;
      }
      if (locationSelect.selectedOptions[0]?.hidden) locationSelect.value = '';
    };
    districtSelect.addEventListener('change', syncLocations);
    syncLocations();

    html.find('[data-action="send"]').on('click', async (event) => {
      event.preventDefault();
      const districtId = districtSelect.value;
      if (!districtId) return;
      const locationId = locationSelect.value;

      const payload = locationId
        ? {
            targetId: locationId,
            targetKind: 'location',
            districtId,
            label: locationSelect.selectedOptions[0]?.textContent?.trim() ?? locationId,
            requestedAt: Date.now(),
          }
        : {
            targetId: districtId,
            targetKind: 'district',
            districtId,
            label: districtSelect.selectedOptions[0]?.textContent?.trim() ?? districtId,
            requestedAt: Date.now(),
          };

      try {
        const res = await fetch(`${RTDB_BASE}/nav/current.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`RTDB write failed (${res.status})`);
        this.close();
      } catch (err) {
        console.error('cpr-terminal | failed to send location', err);
        ui.notifications.error('Failed to send location — check your connection.');
      }
    });

    // nav/current is a standing value, not a one-shot event — every terminal that opens or
    // reloads re-reads it and replays the travel animation, forever, until something clears
    // it. This is that something (same pattern as fate-city-1999's ops-7e4f console explicitly
    // dbDelete-ing incomingCall/timer once they're done being relevant).
    html.find('[data-action="clear"]').on('click', async (event) => {
      event.preventDefault();
      try {
        const res = await fetch(`${RTDB_BASE}/nav/current.json`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`RTDB delete failed (${res.status})`);
        this.close();
      } catch (err) {
        console.error('cpr-terminal | failed to clear location', err);
        ui.notifications.error('Failed to clear location — check your connection.');
      }
    });
  }
}

let terminalApp = null;
let sendLocationApp = null;

function toggleTerminal() {
  if (!terminalApp) terminalApp = new FcosTerminalApp();
  if (terminalApp.rendered) terminalApp.close();
  else terminalApp.render(true);
}

/** Unlike toggleTerminal, never closes an already-open window — this is what the nav-signal listener calls so a GM's send doesn't blink a player's terminal shut. */
function openTerminal() {
  if (!terminalApp) terminalApp = new FcosTerminalApp();
  if (terminalApp.rendered) terminalApp.bringToTop();
  else terminalApp.render(true);
}

function openSendLocationDialog() {
  if (!sendLocationApp) sendLocationApp = new SendLocationApp();
  sendLocationApp.render(true, { focus: true });
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'terminalUrl', {
    name: 'Terminal URL',
    hint: 'Address the terminal window loads. Defaults to the public Vercel build; point this at a LAN dev server (npm run dev) instead if you need one.',
    scope: 'world',
    config: true,
    type: String,
    default: 'https://skamterminal.vercel.app',
  });

  CONFIG.Canvas.layers[CONTROL_LAYER_NAME] = {
    layerClass: CprTerminalLayer,
    group: 'interface',
  };
});

// Every connected client (GM and players) listens for the GM's "send
// location" signal and force-opens its own terminal window when a new one
// arrives — this is what makes it feel like something was "sent" rather
// than something you have to go check for. Firebase's Realtime Database
// REST API streams value changes as Server-Sent Events on the same .json
// endpoint used for plain reads/writes, so a bare EventSource is enough;
// no SDK needs bundling into this module.
Hooks.once('ready', () => {
  let lastAppliedRequestedAt = 0;
  const applyIfNew = (signal) => {
    if (!signal || typeof signal.requestedAt !== 'number') return;
    if (signal.requestedAt === lastAppliedRequestedAt) return;
    lastAppliedRequestedAt = signal.requestedAt;
    openTerminal();
  };

  const stream = new EventSource(`${RTDB_BASE}/nav/current.json`);
  const onStreamEvent = (event) => {
    try {
      applyIfNew(JSON.parse(event.data)?.data);
    } catch (err) {
      console.error('cpr-terminal | malformed nav stream event', err);
    }
  };
  // "put" = whole-node overwrite (the normal case — Send Location always
  // PUTs); "patch" handled defensively too in case that ever changes.
  stream.addEventListener('put', onStreamEvent);
  stream.addEventListener('patch', onStreamEvent);
  // EventSource retries transient drops on its own; nothing to do here.
});

Hooks.on('getSceneControlButtons', (controls) => {
  const tools = [
    {
      name: 'open',
      title: 'Open FCOS Terminal',
      icon: 'fa-solid fa-terminal',
      button: true,
      onClick: toggleTerminal,
    },
  ];

  if (game.user.isGM) {
    tools.push({
      name: 'send-location',
      title: 'Send Location',
      icon: 'fa-solid fa-location-arrow',
      button: true,
      onClick: openSendLocationDialog,
    });
  }

  const group = {
    name: MODULE_ID,
    title: 'FCOS Terminal',
    icon: 'fa-solid fa-terminal',
    layer: CONTROL_LAYER_NAME,
    tools,
  };

  // v12 passes an array; v13+ passes an object keyed by control name.
  if (Array.isArray(controls)) controls.push(group);
  else controls[group.name] = group;
});
