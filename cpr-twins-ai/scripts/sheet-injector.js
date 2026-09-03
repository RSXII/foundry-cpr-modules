// Injects the "Player-Takeable" eligibility checkbox into mook/vehicle actor
// sheets. GM-only, same as the equivalent injections in
// ../cpr-ambient-restart (checkbox bound straight to a flag path) and
// ../cpr-vehicle-crew (GM-only editing, players see nothing extra). No
// template file for a single checkbox — same lightweight raw-DOM approach
// ambient-restart uses for its one Restart-on-Load checkbox.

import { MODULE_ID, isTakeableType } from './data.js';

function onRenderActorSheet(app, html) {
  if (!game.user.isGM) return;
  if (!isTakeableType(app.actor)) return;

  // jQuery on v12's AppV1 sheets, a raw HTMLElement on v13's ApplicationV2 —
  // normalize once and use native DOM calls either way (same trick as
  // ambient-restart's onRenderAmbientSoundConfig).
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  const checked = app.actor.getFlag(MODULE_ID, 'takeable') ? 'checked' : '';
  const group = document.createElement('div');
  group.className = 'form-group cpr-twins-ai-toggle';
  group.innerHTML = `
    <label>Player-Takeable</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.${MODULE_ID}.takeable" ${checked}>
    </div>
    <p class="notes">While CPR Twins AI's mode is on, players see a
      "Take Control" prompt above this actor's tokens and can claim one for
      themselves.</p>
  `;

  const form = root.querySelector('form') ?? root;
  const footer = root.querySelector('footer') ?? root.querySelector('button[type="submit"]');
  if (footer) footer.before(group);
  else form.appendChild(group);
}

export function registerSheetInjectorHooks() {
  Hooks.on('renderActorSheet', onRenderActorSheet);
}
