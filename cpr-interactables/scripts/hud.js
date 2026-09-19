import { MODULE_ID } from './data.js';

let promptEl = null;

function ensureEl() {
  if (promptEl) return promptEl;
  promptEl = document.createElement('div');
  promptEl.className = 'cpri-prompt';
  document.body.appendChild(promptEl);
  return promptEl;
}

/** Human-readable label for whatever key is currently bound to "interact". */
function keyLabel() {
  const binding = game.keybindings.get(MODULE_ID, 'interact')?.[0];
  return binding?.key?.replace(/^(Key|Digit)/, '') ?? 'E';
}

export function showPrompt(hotspot) {
  const el = ensureEl();
  const what = hotspot.caption ? `Inspect ${hotspot.caption}` : 'Inspect';
  el.replaceChildren();
  const keyEl = document.createElement('span');
  keyEl.className = 'cpri-key';
  keyEl.textContent = keyLabel();
  el.append(keyEl, ` ${what}`);
  el.classList.add('cpri-visible');
}

export function hidePrompt() {
  promptEl?.classList.remove('cpri-visible');
}
