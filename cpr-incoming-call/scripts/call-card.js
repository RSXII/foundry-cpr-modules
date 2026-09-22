// CPR Incoming Call — the answered-call card
//
// Purely presentational: show/hide only, no state of its own beyond "is a
// card currently in the DOM." main.js's state machine decides *when* this
// appears (on answer) and disappears (on hang up / call.ended) — this file
// never listens for hooks or reads settings.

// Static card geometry. Kept as plain numbers rather than CSS vars because
// the inline SVG border below has to match the CSS clip-path exactly, and
// the card itself is a fixed-size widget, not one that needs to track a
// resizable window (only its *position* in the corner does).
const CARD_W = 260;
const CARD_H = 360;
const CARD_CUT = 24;

const CORNER_MARGIN = 24;
const SIDEBAR_FALLBACK_WIDTH = 320;
const HOTBAR_FALLBACK_HEIGHT = 90;

// Deterministic "connection ID" in the CONNECTION 541.44.10 style seen on
// Cyberpunk 2077's call cards — hashed from the caller's name so the same
// caller always reads the same ID rather than re-rolling every call.
function connectionId(seed) {
  const str = String(seed ?? 'unknown');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const a = 100 + (h % 900);
  const b = (h >>> 8) % 100;
  const c = (h >>> 16) % 100;
  return `${a}.${String(b).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function cardFrameSvg() {
  const w = CARD_W, h = CARD_H, cut = CARD_CUT;
  // Chamfered rectangle: corners cut at top-right and bottom-left, matching
  // the CSS clip-path on .cpr-call-portrait below — same six points, so the
  // SVG-drawn border (which clip-path alone can't produce along a cut edge)
  // lines up exactly with the clipped image beneath it.
  const points = [
    `0,0`,
    `${w - cut},0`,
    `${w},${cut}`,
    `${w},${h}`,
    `${cut},${h}`,
    `0,${h - cut}`,
  ].join(' ');
  const tick = 14;
  return `
    <svg class="cpr-call-frame-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polygon class="cpr-call-frame-outline" points="${points}"/>
      <line class="cpr-call-tick" x1="0" y1="${tick}" x2="0" y2="0"/>
      <line class="cpr-call-tick" x1="0" y1="0" x2="${tick}" y2="0"/>
      <line class="cpr-call-tick" x1="${w - tick}" y1="${h}" x2="${w}" y2="${h}"/>
      <line class="cpr-call-tick" x1="${w}" y1="${h}" x2="${w}" y2="${h - tick}"/>
    </svg>
  `;
}

// Measures Foundry's own sidebar/hotbar elements so the card clears them
// regardless of sidebar width (it's user-resizable in v12) or whether the
// hotbar is hidden — rather than guessing fixed pixel margins that only
// hold for one specific layout. Falls back to flat guesses if either
// element isn't found (a future Foundry version renaming/removing them).
function cornerMargins() {
  const sidebar = document.getElementById('sidebar');
  const hotbar = document.getElementById('hotbar');

  const rightMargin = sidebar
    ? Math.max(window.innerWidth - sidebar.getBoundingClientRect().left, 0) + CORNER_MARGIN
    : SIDEBAR_FALLBACK_WIDTH + CORNER_MARGIN;

  const bottomMargin = hotbar
    ? Math.max(window.innerHeight - hotbar.getBoundingClientRect().top, 0) + CORNER_MARGIN
    : HOTBAR_FALLBACK_HEIGHT + CORNER_MARGIN;

  return { rightMargin, bottomMargin };
}

function positionCard(overlayEl) {
  const { rightMargin, bottomMargin } = cornerMargins();
  overlayEl.style.setProperty('--cpr-call-right', `${rightMargin}px`);
  overlayEl.style.setProperty('--cpr-call-bottom', `${bottomMargin}px`);
}

let activeCard = null;
let resizeHandler = null;

export function hideCallCard() {
  const el = activeCard;
  if (!el) return;
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  el.classList.remove('cpr-call-visible');
  setTimeout(() => el.remove(), 500); // matches the CSS transition duration
  activeCard = null;
}

export function showCallCard(payload) {
  hideCallCard();

  const name = payload.callerName ?? 'Unknown Caller';
  const subtitle = payload.callerSubtitle ?? '';
  const connId = connectionId(payload.callerName);

  const el = document.createElement('div');
  el.className = 'cpr-call-overlay';
  el.innerHTML = `
    <div class="cpr-call-card">
      <div class="cpr-call-eyebrow">
        <span class="cpr-call-dot"></span>// CONNECTION ${connId}
      </div>
      <div class="cpr-call-frame" style="width:${CARD_W}px;height:${CARD_H}px">
        <div class="cpr-call-portrait" style="width:${CARD_W}px;height:${CARD_H}px;clip-path:polygon(0 0, calc(100% - ${CARD_CUT}px) 0, 100% ${CARD_CUT}px, 100% 100%, ${CARD_CUT}px 100%, 0 calc(100% - ${CARD_CUT}px))">
          ${payload.callerAvatarUrl
            ? `<img class="cpr-call-portrait-img" src="${payload.callerAvatarUrl}" alt="">`
            : `<div class="cpr-call-portrait-fallback">
                 <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor" aria-hidden="true">
                   <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-9 2.2-9 5v3h18v-3c0-2.8-4.6-5-9-5z"/>
                 </svg>
               </div>`}
          <div class="cpr-call-scan"></div>
          <div class="cpr-call-glitch"></div>
        </div>
        ${cardFrameSvg()}
      </div>
      <div class="cpr-call-name">${name}</div>
      ${subtitle ? `<div class="cpr-call-subtitle">${subtitle}</div>` : ''}
      <div class="cpr-call-label">CALL CONNECTED</div>
    </div>
  `;

  document.body.appendChild(el);
  activeCard = el;
  positionCard(el);

  let resizeDebounce;
  resizeHandler = () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => positionCard(el), 100);
  };
  window.addEventListener('resize', resizeHandler);

  requestAnimationFrame(() => el.classList.add('cpr-call-visible'));
  // Glitch-in burst is a one-shot entrance flourish, not a looping effect —
  // drop the class once its animation has had time to finish so the portrait
  // settles into a clean, static image.
  setTimeout(() => el.querySelector('.cpr-call-glitch')?.classList.add('cpr-call-glitch--done'), 500);
}
