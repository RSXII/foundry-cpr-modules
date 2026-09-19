import { MODULE_ID, CHARACTER_TYPE, GEAR_TYPE, CLASSES, getViewerActor, isHudEnabledOnScene } from './data.js';

// Appended straight to document.body as a fixed, full-viewport frame — NOT
// scoped to #ui-middle. First cut mounted inside #ui-middle (the exact gap
// between the scene-control rail and the sidebar), which kept the frame
// tidy but wasted the real estate Foundry itself leaves empty beside the
// control-icon column (that column reserves more width than its two icon
// rows need — the rest was just dead gray space). The brief for this HUD is
// an ornamental frame that visibly eats into the screen ("Heavy ornamental/
// HUD framing... not minimal chrome"), so it now deliberately claims that
// space too and lets Foundry's own chrome paint on top of it instead of
// tiptoeing around it:
// z-index sits between canvas#board (--z-index-canvas, 0) and Foundry's own
// #ui-left/#ui-middle/#ui-right (--z-index-app, 30) — above the canvas, but
// below the control icons, player list, and sidebar, all of which have
// their own opaque backgrounds. So those stay fully visible and clickable
// exactly where they already are; this frame just fills in the space
// around and behind them instead of stopping short of it.
// pointer-events stays off throughout (see styles/hdsfnz.css) — this build
// has nothing clickable yet (decorative nav/minimap, per the handoff doc),
// so canvas clicks/panning underneath are unaffected regardless of how far
// the frame visually extends.
const HUD_ID = 'hdsfnz-hud';

let mounted = false;

// The most recent chat message, shown in the bottom-strip dialogue box —
// cheap flavor that reuses Foundry's own chat log instead of inventing a
// narration data model the handoff doc explicitly says not to assume
// exists yet.
let lastChat = null;

function pct(pool) {
  if (!pool || !pool.max) return 0;
  return Math.max(0, Math.min(100, Math.round((pool.value / pool.max) * 100)));
}

const CONDITIONS = [
  { max: 0, id: 'down', label: 'DOWN' },
  { max: 33, id: 'critical', label: 'CRITICAL' },
  { max: 66, id: 'hurt', label: 'HURT' },
  { max: 100, id: 'good', label: 'GOOD' },
];

// id drives the heartbeat pulse's color in the template (styles/hdsfnz.css
// maps each id to a color via currentColor); label is what's actually
// printed — kept as data rather than a Handlebars uppercase helper since
// core doesn't register one.
function condition(hpPct) {
  return CONDITIONS.find((c) => hpPct <= c.max) ?? CONDITIONS[CONDITIONS.length - 1];
}

function buildTemplateData() {
  const actor = getViewerActor();
  const system = actor?.system;
  const hp = system?.hp ?? { value: 0, max: 1 };
  const ep = system?.ep ?? { value: 0, max: 1 };
  const stam = system?.stam ?? { value: 0, max: 1 };
  const ammo = system?.ammo ?? { value: 0, max: 1 };
  const cls = system ? CLASSES[system.class] : null;
  const gear = actor?.items.filter((i) => i.type === GEAR_TYPE) ?? [];

  return {
    hasActor: !!actor,
    actorName: actor?.name ?? '',
    unitNumber: system?.unitNumber ?? '--',
    portraitImg: actor?.img && !actor.img.includes('mystery-man') ? actor.img : null,
    className: cls?.label ?? '',
    classMotto: cls?.motto ?? null,
    hp, ep, stam, ammo,
    hpPct: pct(hp), epPct: pct(ep), stamPct: pct(stam), ammoPct: pct(ammo),
    condition: condition(pct(hp)),
    speshal: system?.speshal ?? 0,
    mainGear: gear.filter((i) => i.system.slot === 'main'),
    subGear: gear.filter((i) => i.system.slot === 'sub'),
    dialogueSpeaker: lastChat?.speaker ?? null,
    dialogueLine: lastChat?.content ?? null,
  };
}

async function render() {
  let root = document.getElementById(HUD_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = HUD_ID;
    document.body.appendChild(root);
  }
  root.innerHTML = await renderTemplate(`modules/${MODULE_ID}/templates/hud.hbs`, buildTemplateData());
}

export function mountHud() {
  if (mounted) return;
  mounted = true;
  render();
}

export function unmountHud() {
  mounted = false;
  document.getElementById(HUD_ID)?.remove();
}

export function refreshHud() {
  if (mounted) render();
}

function syncToScene(scene) {
  if (isHudEnabledOnScene(scene)) mountHud();
  else unmountHud();
}

export function registerHudHooks() {
  Hooks.on('canvasReady', () => syncToScene(canvas.scene));

  Hooks.on('updateScene', (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.hudEnabled`)) syncToScene(scene);
  });

  Hooks.on('updateActor', (actor) => {
    if (actor.type === CHARACTER_TYPE) refreshHud();
  });

  const onGearChange = (item) => {
    if (item.parent?.type === CHARACTER_TYPE) refreshHud();
  };
  Hooks.on('createItem', onGearChange);
  Hooks.on('updateItem', onGearChange);
  Hooks.on('deleteItem', onGearChange);

  // GM-only concerns: getViewerActor() prefers the GM's current
  // control/target, so switching either should re-pick which unit's data
  // the HUD is previewing.
  Hooks.on('controlToken', () => { if (game.user.isGM) refreshHud(); });
  Hooks.on('targetToken', () => { if (game.user.isGM) refreshHud(); });

  Hooks.on('createChatMessage', (msg) => {
    // Chat content is HTML (roll templates included) — stripped to plain
    // text and capped since the dialogue box has room for a line or two,
    // not a full roll card.
    const text = msg.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    lastChat = {
      speaker: msg.speaker?.alias || msg.author?.name || 'UNKNOWN',
      content: text.length > 200 ? `${text.slice(0, 200)}…` : text,
    };
    refreshHud();
  });
}
