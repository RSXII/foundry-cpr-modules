// The on-screen HUD: the GM's dock (off/preview/live toggles) and the
// character stands themselves. Built with plain DOM injection and re-
// rendered in full on every state change — same idiom as
// ../cpr-incoming-call's call-card.js — rather than a Foundry Application,
// since this has to coexist permanently over the canvas rather than open
// and close like a window.
//
// Two different audiences read two different stores here (see data.js's
// header comment for the full why): the GM's own client renders live
// entries from the world-synced `liveStage` setting *plus* its own local
// preview entries from the client-only `dock` setting; every other client
// only ever reads `liveStage` — a preview entry is never even constructed
// on a player's screen, let alone hidden with CSS.

import {
  liveSettingKey,
  dockedActorIds,
  getStageState,
  getCurrentEmotionId,
  getLiveStage,
  getConfig,
  getEmotions,
  toggleDockState,
  toggleBroadcast,
  removeFromScene,
  chooseEmotion,
  setShowName,
} from './data.js';
import { openSetupAppFor } from './setup-app.js';

const MARGIN = 16;
const SIDEBAR_FALLBACK = 320;
const HOTBAR_FALLBACK = 90;
const PLAYERS_FALLBACK = 150;

let layerEl = null;
let popoverActorId = null; // ephemeral UI state only — never persisted, never synced

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * Positioning — clears Foundry's own sidebar/hotbar/players list
 * rather than assuming fixed widths, same technique as call-card.js's
 * cornerMargins(), extended with a left-side measurement for the
 * players list this HUD also has to clear.
 * ------------------------------------------------------------------ */

function computeClearance() {
  const sidebar = document.getElementById('sidebar');
  const hotbar = document.getElementById('hotbar');
  const players = document.getElementById('players');

  const right = sidebar
    ? Math.max(window.innerWidth - sidebar.getBoundingClientRect().left, 0) + MARGIN
    : SIDEBAR_FALLBACK + MARGIN;
  const bottom = hotbar
    ? Math.max(window.innerHeight - hotbar.getBoundingClientRect().top, 0) + MARGIN
    : HOTBAR_FALLBACK + MARGIN;
  const left = players
    ? Math.max(players.getBoundingClientRect().right, 0) + MARGIN
    : PLAYERS_FALLBACK + MARGIN;

  return { right, bottom, left };
}

function positionLayer() {
  if (!layerEl) return;
  const { right, bottom, left } = computeClearance();
  layerEl.style.setProperty('--cpr-vn-right', `${right}px`);
  layerEl.style.setProperty('--cpr-vn-bottom', `${bottom}px`);
  layerEl.style.setProperty('--cpr-vn-left', `${left}px`);
}

/* ------------------------------------------------------------------ *
 * Stand list assembly
 * ------------------------------------------------------------------ */

/** Everyone's view: just what liveStage actually holds, verbatim. */
function liveEntries() {
  const stage = getLiveStage();
  return Object.entries(stage.actors ?? {}).map(([actorId, payload]) => ({
    actorId,
    name: payload.name,
    img: payload.img,
    showName: payload.showName,
    isPreview: false,
  }));
}

/** GM-only extra: actors this client is previewing, built straight off the actor + its config. */
function previewEntries() {
  if (!game.user.isGM) return [];
  return dockedActorIds()
    .filter((id) => getStageState(id) === 'preview')
    .map((actorId) => {
      const actor = game.actors.get(actorId);
      if (!actor) return null;
      const cfg = getConfig(actor);
      const emotion = cfg.emotions.find((e) => e.id === getCurrentEmotionId(actorId)) ?? cfg.emotions[0];
      return { actorId, name: actor.name, img: emotion?.img ?? null, showName: cfg.showName, isPreview: true };
    })
    .filter(Boolean);
}

function standArtHTML(img, name) {
  if (img) return `<img src="${esc(img)}" alt="" />`;
  // No art uploaded yet — same "unidentified" silhouette fallback cpr-incoming-call
  // uses for a caller with no avatar, not a broken-image icon.
  return `<div class="cpr-vn-stand-fallback" title="${esc(name)} has no stand art yet">
    <i class="fas fa-user-astronaut"></i>
  </div>`;
}

function renderStands() {
  const wrap = layerEl.querySelector('#cpr-vn-stands');
  const entries = game.user.isGM ? [...liveEntries(), ...previewEntries()] : liveEntries();

  wrap.innerHTML = entries
    .map((entry) => {
      const emoteBtn = game.user.isGM
        ? `<button type="button" class="cpr-vn-emote-btn" data-emote="${entry.actorId}" title="Change ${esc(entry.name)}'s expression"><i class="fas fa-masks-theater"></i></button>`
        : '';

      const previewFlag = entry.isPreview
        ? `<div class="cpr-vn-preview-flag"><i class="fas fa-eye"></i> Preview &mdash; players can't see this</div>`
        : '';

      let nameTag = '';
      if (game.user.isGM) {
        const title = entry.showName
          ? `Click to hide ${esc(entry.name)}'s name from players`
          : `Click to show ${esc(entry.name)}'s name to players`;
        nameTag = `<button type="button" class="cpr-vn-name-tag cpr-vn-name-tag-btn ${entry.showName ? '' : 'is-hidden'}" data-nametag="${entry.actorId}" title="${title}">
          <span>${esc(entry.name)}</span>
        </button>`;
      } else if (entry.showName) {
        nameTag = `<div class="cpr-vn-name-tag"><span>${esc(entry.name)}</span></div>`;
      }

      return `<div class="cpr-vn-stand is-visible ${entry.isPreview ? 'is-preview' : ''}" data-stand="${entry.actorId}">
        ${previewFlag}
        ${emoteBtn}
        <div class="cpr-vn-stand-art">${standArtHTML(entry.img, entry.name)}</div>
        ${nameTag}
      </div>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ *
 * GM dock
 * ------------------------------------------------------------------ */

function renderDock() {
  const dock = layerEl.querySelector('#cpr-vn-dock');
  if (!game.user.isGM) {
    dock.style.display = 'none';
    return;
  }
  dock.style.display = 'flex';

  const ids = dockedActorIds();
  if (!ids.length) {
    dock.innerHTML = `<div class="cpr-vn-dock-empty">No one on stage &mdash; right-click an actor in the sidebar &rarr; "Add to Scene (VN)"</div>`;
    return;
  }

  dock.innerHTML = ids
    .map((actorId) => {
      const actor = game.actors.get(actorId);
      if (!actor) return '';
      const stageState = getStageState(actorId);
      const avatarTitle = stageState === 'off'
        ? `${esc(actor.name)} &mdash; click to preview (only you can see it)`
        : `${esc(actor.name)} &mdash; click to take off stage`;

      let html = `<button type="button" class="cpr-vn-dock-icon is-${stageState}" data-dock="${actorId}" title="${avatarTitle}">
        <span class="cpr-vn-ring"></span>
        <img class="cpr-vn-dock-fill" src="${esc(actor.img)}" alt="" />
        <span class="cpr-vn-state-dot"></span>
      </button>`;

      if (stageState !== 'off') {
        const isLive = stageState === 'live';
        const bcTitle = isLive
          ? 'Live &mdash; visible to players. Click to take offline (back to GM-only preview).'
          : 'Previewing &mdash; only you can see this. Click to go live for players.';
        html += `<button type="button" class="cpr-vn-dock-broadcast ${isLive ? 'is-live' : ''}" data-broadcast="${actorId}" title="${bcTitle}">
          <i class="fas fa-tower-broadcast"></i>
        </button>`;
      }

      html += `<button type="button" class="cpr-vn-dock-remove" data-remove="${actorId}" title="Remove ${esc(actor.name)} from scene">
        <i class="fas fa-xmark"></i>
      </button>`;
      return html;
    })
    .join('');
}

/* ------------------------------------------------------------------ *
 * Expression popover
 * ------------------------------------------------------------------ */

function renderPopover() {
  const existing = document.querySelector('.cpr-vn-popover');
  if (existing) existing.remove();
  if (!popoverActorId) return;

  const actor = game.actors.get(popoverActorId);
  const anchor = layerEl.querySelector(`[data-emote="${popoverActorId}"]`);
  if (!actor || !anchor || getStageState(popoverActorId) === 'off') {
    popoverActorId = null;
    return;
  }

  const emotions = getEmotions(actor);
  const currentId = getCurrentEmotionId(popoverActorId);

  // Appended to document.body, not layerEl — layerEl is `position: fixed`,
  // which would make it the positioning context for an absolutely
  // positioned child and throw off the viewport-relative math below (the
  // mockup's equivalent worked because its #overlayLayer had no `position`
  // of its own, so the popover fell through to the viewport itself).
  const pop = document.createElement('div');
  pop.className = 'cpr-vn-popover';
  pop.innerHTML = `
    <div class="cpr-vn-popover-head">${esc(actor.name)}'s expression</div>
    <div class="cpr-vn-popover-grid">
      ${emotions
        .map(
          (e) => `<div class="cpr-vn-mood-chip ${e.id === currentId ? 'is-current' : ''}" data-mood="${e.id}">
            ${e.img ? `<img src="${esc(e.img)}" alt="" />` : '<i class="fas fa-user-astronaut"></i>'}
            <span>${esc(e.label)}</span>
          </div>`,
        )
        .join('')}
    </div>
    <div class="cpr-vn-popover-foot"><button type="button" class="cpr-vn-link-btn" data-manage>Manage emotions &rarr;</button></div>
  `;
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.top - pop.offsetHeight - 10}px`;

  pop.querySelectorAll('.cpr-vn-mood-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      await chooseEmotion(actor, chip.dataset.mood);
      popoverActorId = null;
      refreshOverlay();
    });
  });
  pop.querySelector('[data-manage]').addEventListener('click', () => {
    popoverActorId = null;
    refreshOverlay();
    openSetupAppFor(actor);
  });
}

/* ------------------------------------------------------------------ *
 * Event wiring (delegated — the DOM underneath gets fully replaced on
 * every render, same reason the mockup wires everything at the
 * document level instead of per-element).
 * ------------------------------------------------------------------ */

function bindEvents() {
  layerEl.addEventListener('click', async (ev) => {
    const dockIcon = ev.target.closest('.cpr-vn-dock-icon');
    if (dockIcon) {
      const actor = game.actors.get(dockIcon.dataset.dock);
      if (actor) await toggleDockState(actor);
      refreshOverlay();
      return;
    }

    const broadcastBtn = ev.target.closest('.cpr-vn-dock-broadcast');
    if (broadcastBtn) {
      const actor = game.actors.get(broadcastBtn.dataset.broadcast);
      if (actor) await toggleBroadcast(actor);
      refreshOverlay();
      return;
    }

    const removeBtn = ev.target.closest('.cpr-vn-dock-remove');
    if (removeBtn) {
      await removeFromScene(removeBtn.dataset.remove);
      popoverActorId = null;
      refreshOverlay();
      return;
    }

    const emoteBtn = ev.target.closest('.cpr-vn-emote-btn');
    if (emoteBtn) {
      const id = emoteBtn.dataset.emote;
      popoverActorId = popoverActorId === id ? null : id;
      refreshOverlay();
      return;
    }

    const nameTagBtn = ev.target.closest('.cpr-vn-name-tag-btn');
    if (nameTagBtn) {
      const actor = game.actors.get(nameTagBtn.dataset.nametag);
      if (actor) await setShowName(actor, getConfig(actor).showName === false);
      refreshOverlay();
      return;
    }
  });

  // The popover lives outside layerEl (see renderPopover's comment on why),
  // so dismissing it on an outside click has to be a document-level
  // listener rather than part of the delegated one above — a click
  // anywhere that isn't the popover itself or the button that opened it.
  document.addEventListener('click', (ev) => {
    if (!popoverActorId) return;
    if (ev.target.closest('.cpr-vn-popover') || ev.target.closest('.cpr-vn-emote-btn')) return;
    popoverActorId = null;
    refreshOverlay();
  });

  let resizeDebounce;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(positionLayer, 100);
  });

  // The only cross-client signal this module needs: liveStage is a real
  // Setting document, so every connected client (GM included, redundantly
  // but harmlessly) gets this the moment the GM publishes/withdraws a
  // stand — see data.js's header comment for why this is trustworthy where
  // a raw socket event wasn't.
  Hooks.on('updateSetting', (setting) => {
    if (setting.key === liveSettingKey()) renderStands();
  });
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

export function initOverlay() {
  layerEl = document.createElement('div');
  layerEl.id = 'cpr-vn-stage-layer';
  layerEl.className = 'cpr-vn-layer';
  layerEl.innerHTML = `
    <div id="cpr-vn-stands" class="cpr-vn-stands"></div>
    <div id="cpr-vn-dock" class="cpr-vn-dock"></div>
  `;
  document.body.appendChild(layerEl);
  positionLayer();
  bindEvents();
  refreshOverlay();
}

/** Called after any mutation (context menu, dock clicks, setup app saves) so the GM's own screen updates immediately, without waiting on a setting hook that only fires for world-scope changes. */
export function refreshOverlay() {
  if (!layerEl) return;
  renderDock();
  renderStands();
  renderPopover();
}
