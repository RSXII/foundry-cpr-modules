import { getSound, setSound, clearSound } from './data.js';

const TEMPLATE_PATH = 'modules/cpr-attack-sfx/templates/sfx-row.hbs';

function _soundLabel(path) {
  if (!path) return '';
  const name = path.split('/').pop();
  return name.length > 28 ? `${name.slice(0, 25)}...` : name;
}

async function _insertSfxRow(app, html) {
  const item = app.item ?? app.document;
  if (!item || item.type !== 'weapon') return;

  const soundPath = getSound(item);
  const rendered = await renderTemplate(TEMPLATE_PATH, {
    soundPath,
    soundLabel: _soundLabel(soundPath),
  });

  const list = html.find('ol.items-list');
  if (!list.length) return;
  list.append(rendered);

  if (!app.isEditable) return;
  _bindListeners(html, item);
}

function _bindListeners(html, item) {
  html.find('.cpr-attack-sfx-pick').on('click', (ev) => {
    ev.preventDefault();
    const picker = new FilePicker({
      type: 'audio',
      current: getSound(item) ?? '',
      callback: (path) => setSound(item, path),
    });
    picker.render(true);
  });

  html.find('.cpr-attack-sfx-play').on('click', (ev) => {
    ev.preventDefault();
    const path = getSound(item);
    if (path) AudioHelper.play({ src: path, volume: 0.8 }, false);
  });

  html.find('.cpr-attack-sfx-clear').on('click', (ev) => {
    ev.preventDefault();
    clearSound(item);
  });
}

export function registerSheetInjectorHooks() {
  Hooks.on('renderItemSheet', (app, html) => {
    _insertSfxRow(app, html);
  });
}
