// Flags/settings read-write layer for VN Stage. Nothing outside this file
// should touch these directly — three stores, each picked for what it has
// to guarantee, not interchangeably:
//
//   - actor flag "config"       Durable per-actor setup: emotions, default
//                               stand, name-tag preference. Read/written by
//                               the GM's own client only — a GM always has
//                               full actor access regardless of a player's
//                               ownership on that actor, so this is never a
//                               permission problem even for NPCs a party
//                               doesn't own.
//
//   - client setting "dock"     Which actors are on *this* GM's dock right
//                               now, and whether each is off / previewing /
//                               live. `scope: "client"` is stored in that
//                               browser's own localStorage and never
//                               reaches the server or any other client — so
//                               "preview" genuinely cannot leak to a player,
//                               not even one poking at console, because the
//                               data simply never exists outside the GM's
//                               own browser.
//
//   - world setting "liveStage" The one thing players actually see: name,
//                               art and name-tag visibility for every
//                               currently *live* actor, and nothing else.
//                               A `scope: "world"` setting is a real Setting
//                               document under the hood (Foundry v10+), so
//                               it rides the same document-sync pipeline as
//                               a ChatMessage or Actor update — the pipeline
//                               ../cpr-incoming-call and ../cpr-twins-ai
//                               both found reliable in real testing, unlike
//                               a bare game.socket.emit/.on() custom event
//                               (see either module's socket.js for that
//                               lesson). It also solves "a player reloads
//                               mid-scene" for free: game.settings.get()
//                               already holds the latest value the moment
//                               that client's ready hook fires — no replay-
//                               of-past-events needed the way a ChatMessage-
//                               driven state machine would require.
//
// GM-only gating is enforced here, not just in the UI that calls these —
// every write function bails if the calling client isn't a GM.

export const MODULE_ID = 'cpr-vn-stage';

const DOCK_SETTING = 'dock';
const LIVE_SETTING = 'liveStage';

export function registerSettings() {
  game.settings.register(MODULE_ID, DOCK_SETTING, {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(MODULE_ID, LIVE_SETTING, {
    scope: 'world',
    config: false,
    type: Object,
    default: { actors: {} },
  });
}

export function liveSettingKey() {
  return `${MODULE_ID}.${LIVE_SETTING}`;
}

/* ------------------------------------------------------------------ *
 * Actor VN config — emotions, default stand, name-tag preference
 * ------------------------------------------------------------------ */

/** Never-null read: callers always get a usable config, even before it's been seeded. */
export function getConfig(actor) {
  const raw = actor?.getFlag(MODULE_ID, 'config');
  if (raw?.emotions?.length) return raw;
  return { showName: true, defaultId: null, emotions: [] };
}

/**
 * First-touch convenience: seeds one "Neutral" emotion off the actor's own
 * portrait, so Add to Scene never puts someone on stage with zero stands —
 * same shape of fix as ../cpr-vehicle-crew's ensureSeatsSeeded().
 */
export async function ensureSeeded(actor) {
  if (!game.user.isGM) return;
  if (actor.getFlag(MODULE_ID, 'config')) return;
  const seedId = foundry.utils.randomID();
  await actor.setFlag(MODULE_ID, 'config', {
    showName: true,
    defaultId: seedId,
    emotions: [{ id: seedId, label: 'Neutral', img: actor.img ?? null }],
  });
}

export function getEmotions(actor) {
  return getConfig(actor).emotions;
}

export function getEmotion(actor, emotionId) {
  const cfg = getConfig(actor);
  return cfg.emotions.find((e) => e.id === emotionId) ?? null;
}

export function getDefaultEmotion(actor) {
  const cfg = getConfig(actor);
  return cfg.emotions.find((e) => e.id === cfg.defaultId) ?? cfg.emotions[0] ?? null;
}

export async function setShowName(actor, showName) {
  if (!game.user.isGM) return;
  const cfg = getConfig(actor);
  await actor.setFlag(MODULE_ID, 'config', { ...cfg, showName });
  if (getStageState(actor.id) === 'live') await publishLive(actor, getCurrentEmotionId(actor.id));
}

export async function setDefaultEmotion(actor, emotionId) {
  if (!game.user.isGM) return;
  const cfg = getConfig(actor);
  await actor.setFlag(MODULE_ID, 'config', { ...cfg, defaultId: emotionId });
}

export async function addEmotion(actor, { label, img }) {
  if (!game.user.isGM) return null;
  const cfg = getConfig(actor);
  const id = foundry.utils.randomID();
  const emotions = [...cfg.emotions, { id, label: label || 'New Emotion', img: img ?? null }];
  const defaultId = cfg.defaultId ?? id;
  await actor.setFlag(MODULE_ID, 'config', { ...cfg, emotions, defaultId });
  return id;
}

export async function updateEmotion(actor, emotionId, patch) {
  if (!game.user.isGM) return;
  const cfg = getConfig(actor);
  const emotions = cfg.emotions.map((e) => (e.id === emotionId ? { ...e, ...patch } : e));
  await actor.setFlag(MODULE_ID, 'config', { ...cfg, emotions });
  if (getStageState(actor.id) === 'live' && getCurrentEmotionId(actor.id) === emotionId) {
    await publishLive(actor, emotionId);
  }
}

// The default stand can't be deleted without picking a new default first —
// same "set another default first" rule the mockup's trash icon enforced,
// re-stated here as the real rule rather than just a disabled button.
export async function removeEmotion(actor, emotionId) {
  if (!game.user.isGM) return;
  const cfg = getConfig(actor);
  if (cfg.emotions.length <= 1 || cfg.defaultId === emotionId) return;
  const emotions = cfg.emotions.filter((e) => e.id !== emotionId);
  await actor.setFlag(MODULE_ID, 'config', { ...cfg, emotions });
}

/* ------------------------------------------------------------------ *
 * Dock — GM-local "who's on stage, and in what state" bookkeeping
 * ------------------------------------------------------------------ */

function emptyDockEntry() {
  return { inScene: false, stageState: 'off', currentId: null };
}

export function getDock() {
  return game.settings.get(MODULE_ID, DOCK_SETTING);
}

function getDockEntry(actorId) {
  return getDock()[actorId] ?? emptyDockEntry();
}

async function writeDock(dock) {
  await game.settings.set(MODULE_ID, DOCK_SETTING, dock);
}

export function isInScene(actorId) {
  return !!getDockEntry(actorId).inScene;
}

export function getStageState(actorId) {
  return getDockEntry(actorId).stageState;
}

export function getCurrentEmotionId(actorId) {
  return getDockEntry(actorId).currentId;
}

/** Actor ids on the dock, insertion order (good enough — same as the mockup's actorOrder). */
export function dockedActorIds() {
  const dock = getDock();
  return Object.keys(dock).filter((id) => dock[id].inScene);
}

export async function addToScene(actorId) {
  if (!game.user.isGM) return;
  const dock = getDock();
  dock[actorId] = emptyDockEntry();
  dock[actorId].inScene = true;
  await writeDock(dock);
}

export async function removeFromScene(actorId) {
  if (!game.user.isGM) return;
  const dock = getDock();
  delete dock[actorId];
  await writeDock(dock);
  await clearLive(actorId);
}

/**
 * off -> preview (and resets to the actor's default stand); anything else
 * -> off entirely, which also pulls it off the live broadcast if it was
 * there. Matches the mockup's dock-avatar click exactly: a single click is
 * always the "safe" direction (show only to me, or hide from everyone) —
 * going live is a separate, deliberate action (see toggleBroadcast below).
 */
export async function toggleDockState(actor) {
  if (!game.user.isGM) return;
  const dock = getDock();
  const entry = dock[actor.id] ?? emptyDockEntry();
  if (entry.stageState === 'off') {
    const def = getDefaultEmotion(actor);
    dock[actor.id] = { ...entry, inScene: true, stageState: 'preview', currentId: def?.id ?? null };
    await writeDock(dock);
  } else {
    dock[actor.id] = { ...entry, stageState: 'off' };
    await writeDock(dock);
    await clearLive(actor.id);
  }
}

/** preview <-> live. Live publishes the world-visible payload; dropping back to preview withdraws it. */
export async function toggleBroadcast(actor) {
  if (!game.user.isGM) return;
  const dock = getDock();
  const entry = dock[actor.id];
  if (!entry || entry.stageState === 'off') return;
  if (entry.stageState === 'live') {
    dock[actor.id] = { ...entry, stageState: 'preview' };
    await writeDock(dock);
    await clearLive(actor.id);
  } else {
    dock[actor.id] = { ...entry, stageState: 'live' };
    await writeDock(dock);
    await publishLive(actor, entry.currentId);
  }
}

/** Expression-popover pick. Updates the GM's working value, and re-publishes immediately if already live. */
export async function chooseEmotion(actor, emotionId) {
  if (!game.user.isGM) return;
  const dock = getDock();
  const entry = dock[actor.id] ?? emptyDockEntry();
  dock[actor.id] = { ...entry, currentId: emotionId };
  await writeDock(dock);
  if (entry.stageState === 'live') await publishLive(actor, emotionId);
}

/* ------------------------------------------------------------------ *
 * Live stage — the only thing players ever see
 * ------------------------------------------------------------------ */

export function getLiveStage() {
  return game.settings.get(MODULE_ID, LIVE_SETTING);
}

async function writeLiveStage(stage) {
  await game.settings.set(MODULE_ID, LIVE_SETTING, stage);
}

export async function publishLive(actor, emotionId) {
  if (!game.user.isGM) return;
  const cfg = getConfig(actor);
  const emotion = cfg.emotions.find((e) => e.id === emotionId) ?? getDefaultEmotion(actor);
  const stage = getLiveStage();
  await writeLiveStage({
    ...stage,
    actors: {
      ...stage.actors,
      [actor.id]: { name: actor.name, img: emotion?.img ?? null, showName: cfg.showName },
    },
  });
}

export async function clearLive(actorId) {
  if (!game.user.isGM) return;
  const stage = getLiveStage();
  if (!(actorId in stage.actors)) return;
  const actors = { ...stage.actors };
  delete actors[actorId];
  await writeLiveStage({ ...stage, actors });
}
