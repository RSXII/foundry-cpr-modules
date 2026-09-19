const OVERLAY_ID = "cpr-live-translation-overlay";

// Glyphs used for the "decrypting" glitch band between settled English text
// and the still-untranslated source text. Mixes CJK-ish strokes, box-drawing,
// and symbols for a terminal/decoder feel.
const GLYPHS =
  "田力上下中口字化ソアユニシフミ〆" +
  "0123456789#$%&*+=<>/\\|~^※△▲▽▼◆◇○●■□";

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

function escapeHtml(char) {
  switch (char) {
    case "<": return "&lt;";
    case ">": return "&gt;";
    case "&": return "&amp;";
    default: return char;
  }
}

/** Waits up to `ms`, but resolves immediately once `state.skip` is set. */
function wait(ms, state) {
  return new Promise((resolve) => {
    if (state.skip) return resolve();
    let start = null;
    const frame = (ts) => {
      if (start === null) start = ts;
      if (state.skip || ts - start >= ms) return resolve();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Renders a single frame of the decrypt animation: settled English on the
 * left, a flickering glitch band in the middle, and the (shrinking) source
 * text on the right.
 *
 * The trailing source text is always a plain, contiguous slice of the real
 * source string (never resampled/stretched character-by-character) - index
 * remapping to cover a length mismatch would sometimes duplicate letters,
 * which can accidentally spell something unintended. If the remaining slice
 * is shorter than the space available, the rest is filled with glitch
 * glyphs rather than repeating characters.
 */
function renderFrame(source, english, progress, settledCount, bandWidth) {
  const len = english.length;
  const sourceCutoff = Math.floor(progress * source.length);
  const remainder = source.slice(sourceCutoff);

  let html = "";
  for (let i = 0; i < len; i++) {
    if (i < settledCount) {
      html += escapeHtml(english[i]);
    } else if (i < settledCount + bandWidth) {
      html += `<span class="cpr-glitch-char">${escapeHtml(randomGlyph())}</span>`;
    } else {
      const remIdx = i - (settledCount + bandWidth);
      const ch = remainder[remIdx];
      html += `<span class="cpr-source-char">${escapeHtml(ch ?? randomGlyph())}</span>`;
    }
  }
  return html;
}

export class TranslationEffect {
  /**
   * Plays a sequence of source/english cues, one after another, on this client.
   * @param {object} data
   * @param {{source: string, english: string}[]} data.cues
   * @param {"top"|"bottom"} [data.position]
   * @param {number} [data.charSpeed]       ms per character while decrypting
   * @param {number} [data.sourceHoldTime]  ms to show the plain, untranslated source text before decrypting starts
   * @param {number} [data.holdTime]        ms to hold the settled english line before clearing/advancing
   */
  static async play({ cues, position = "bottom", charSpeed = 55, sourceHoldTime = 1800, holdTime = 4000 } = {}) {
    if (!cues?.length) return;

    const overlay = this._buildOverlay(position);
    const state = { skip: false };
    const onClick = () => { state.skip = true; };
    overlay.addEventListener("click", onClick);

    try {
      for (const cue of cues) {
        state.skip = false;
        await this._playCue(overlay, cue, { charSpeed, sourceHoldTime, holdTime, state });
      }
    } finally {
      overlay.removeEventListener("click", onClick);
      this._teardownOverlay(overlay);
    }
  }

  static _buildOverlay(position) {
    document.getElementById(OVERLAY_ID)?.remove();
    const el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.className = `cpr-translation-overlay position-${position}`;
    el.innerHTML = `<div class="cpr-translation-line"></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("visible"));
    return el;
  }

  static _teardownOverlay(el) {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 400);
  }

  static async _playCue(overlay, { source = "", english = "" }, { charSpeed, sourceHoldTime, holdTime, state }) {
    const lineEl = overlay.querySelector(".cpr-translation-line");
    lineEl.classList.remove("settled");

    // Show the plain, untranslated source text first and let it sit on
    // screen for a beat before the decrypt sweep begins.
    lineEl.textContent = source || english;
    lineEl.classList.add("pre-translation");
    await wait(sourceHoldTime, state);
    lineEl.classList.remove("pre-translation");

    const targetLen = Math.max(english.length, 1);
    const bandWidth = Math.max(3, Math.round(targetLen * 0.08));
    const duration = Math.max(200, targetLen * charSpeed);

    await new Promise((resolve) => {
      let start = null;

      const frame = (ts) => {
        if (start === null) start = ts;
        const elapsed = ts - start;
        const progress = state.skip ? 1 : Math.min(1, elapsed / duration);
        const settled = Math.floor(progress * targetLen);

        if (progress < 1) {
          lineEl.innerHTML = renderFrame(source, english, progress, settled, bandWidth);
          requestAnimationFrame(frame);
        } else {
          lineEl.textContent = english;
          lineEl.classList.add("settled");
          resolve();
        }
      };

      requestAnimationFrame(frame);
    });

    await wait(holdTime, state);
  }
}
