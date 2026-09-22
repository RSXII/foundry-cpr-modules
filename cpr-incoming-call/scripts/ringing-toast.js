// CPR Incoming Call — the top-of-screen ringing / in-call toast
//
// The actual physical control for a call from inside Foundry: stays up for
// as long as a call is ringing or connected (no auto-fade of its own — see
// main.js's state machine for the only things that ever dismiss it), with
// Answer/Reject while ringing, and a single Hang Up once answered. Unlike
// the call card, this one is genuinely interactive, so — unlike the rest of
// this module's DOM, and unlike fc99-bridge's other toasts — it does NOT
// set pointer-events: none on itself.
//
// Purely presentational, same as call-card.js: it takes a `mode` and a
// caller `payload` and renders accordingly. main.js decides when to call it
// and supplies the answer/reject/hangup callbacks; this file has no opinion
// on what those callbacks actually do (e.g. broadcasting the action to
// other clients).

// Same call/hangup glyph used by the Wire phone app's own call screen
// (fate-city-1999/src/routes/phone/+page.svelte) — reused here so the
// iconography reads the same across the whole project rather than
// reinventing a different phone glyph for this one card.
const ICON_CALL = 'M6.7 4h2.7l1.4 3.8-2 1.6a12.3 12.3 0 0 0 5.8 5.8l1.6-2 3.8 1.4v2.7a2 2 0 0 1-2 2C10.8 19.3 4.7 13.2 4.7 6a2 2 0 0 1 2-2z';

function iconSvg(rotated) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="${ICON_CALL}"${rotated ? ' transform="rotate(135 12 12)"' : ''}/>
  </svg>`;
}

let toastEl = null;

export function hideToast() {
  const el = toastEl;
  if (!el) return;
  el.classList.remove('cpr-ring-visible');
  setTimeout(() => el.remove(), 350);
  toastEl = null;
}

/**
 * @param {'ringing'|'in-call'} mode
 * @param {object} payload - the call.incoming payload (callerName, callerSubtitle, callerAvatarUrl)
 * @param {{onAnswer?: () => void, onReject?: () => void, onHangup?: () => void}} handlers
 */
export function showToast(mode, payload, handlers = {}) {
  const isFirstShow = !toastEl;
  const el = toastEl ?? document.createElement('div');
  el.className = `cpr-ring-toast cpr-ring-toast--${mode}`;

  const name = payload.callerName ?? 'Unknown Caller';
  const eyebrow = mode === 'ringing' ? 'INCOMING CALL' : 'IN CALL';

  el.innerHTML = `
    <div class="cpr-ring-head">
      <div class="cpr-ring-avatar-ring">
        ${payload.callerAvatarUrl
          ? `<img class="cpr-ring-avatar" src="${payload.callerAvatarUrl}" alt="">`
          : `<div class="cpr-ring-avatar cpr-ring-avatar--fallback">${iconSvg(false)}</div>`}
      </div>
      <div class="cpr-ring-text">
        <div class="cpr-ring-eyebrow">${eyebrow}</div>
        <div class="cpr-ring-name">${name}</div>
      </div>
    </div>
    <div class="cpr-ring-actions">
      ${mode === 'ringing'
        ? `<button type="button" class="cpr-ring-btn cpr-ring-btn--answer" data-action="answer">${iconSvg(false)}Answer</button>
           <button type="button" class="cpr-ring-btn cpr-ring-btn--reject" data-action="reject">${iconSvg(true)}Reject</button>`
        : `<button type="button" class="cpr-ring-btn cpr-ring-btn--hangup" data-action="hangup">${iconSvg(true)}Hang Up</button>`}
    </div>
  `;

  el.onclick = (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'answer') handlers.onAnswer?.();
    else if (button.dataset.action === 'reject') handlers.onReject?.();
    else if (button.dataset.action === 'hangup') handlers.onHangup?.();
  };

  if (isFirstShow) {
    document.body.appendChild(el);
    toastEl = el;
    requestAnimationFrame(() => el.classList.add('cpr-ring-visible'));
  }
}
