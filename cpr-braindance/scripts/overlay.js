// CPR Braindance — the full-screen transition overlay itself.
//
// Purely presentational, same split as ../cpr-twins-ai/scripts/vision-effect.js:
// a mount()/destroy()-style object with no hooks or settings of its own.
// main.js's world-setting trigger is the only thing that calls playEnter()/
// playExit() — this file just knows how to animate between the three beats
// of the sequence once told to:
//
//   mount (black, nothing yet)
//     -> playEnter(): arms swing in from the screen edges toward the
//        viewer, clamp, neural-link flash
//     -> (holds here indefinitely — strobe flashes + glitch bursts + a
//        cycling "loading" label, however long the GM takes to actually
//        swap the scene)
//     -> playExit(): reverse flash, arms retreat off-screen, fade out,
//        unmount
//
// Unlike the clamp/flash entrance (a fixed-length animation), the hold
// phase has no natural end of its own — it's "still loading" for as long
// as nothing has told it otherwise, so its strobe/glitch timers are
// self-rescheduling (setTimeout, not a fixed-duration CSS animation) and
// only stop when playExit()/destroy() clears them.

const FADE_IN_MS = 150;
const ARM_SWING_MS = 850;
const CLAMP_FLASH_MS = 200;
// Beat between the arms finishing their swing and the flash firing — reads
// as "contact, then the link engages" rather than both happening in the
// same instant.
const CLAMP_FLASH_DELAY_MS = ARM_SWING_MS - 120;

const STROBE_MIN_INTERVAL_MS = 1400;
const STROBE_MAX_INTERVAL_MS = 3200;
const STROBE_DURATION_MS = 140;

const GLITCH_MIN_INTERVAL_MS = 900;
const GLITCH_MAX_INTERVAL_MS = 2600;
const GLITCH_DURATION_MS = 260;

const LABEL_CYCLE_MS = 1900;
const LABELS = [
  'INITIALIZING BRAINDANCE',
  'SYNCHRONIZING NEURAL LINK',
  'CALIBRATING SENSORY FEED',
  'BUFFERING MEMORY STREAM',
  'DECRYPTING PLAYBACK TRACK',
];

const EXIT_FLASH_MS = 150;
const EXIT_RETREAT_MS = 650;
const EXIT_FADE_MS = 500;

function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

class BraindanceOverlay {
  constructor() {
    this.el = null;
    this._state = 'idle'; // 'idle' | 'entering' | 'holding' | 'exiting'
    this._strobeTimer = null;
    this._glitchTimer = null;
    this._labelTimer = null;
    this._labelIndex = 0;
    this._labelEl = null;
  }

  get mounted() {
    return !!this.el;
  }

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'cpr-braindance-overlay';
    root.innerHTML = `
      <div class="cpr-bd-arm cpr-bd-arm--left">
        <i class="cpr-bd-arm-cable"></i>
        <i class="cpr-bd-arm-rail"></i>
        <i class="cpr-bd-arm-joint"></i>
        <i class="cpr-bd-arm-pad"><i class="cpr-bd-arm-led"></i></i>
      </div>
      <div class="cpr-bd-arm cpr-bd-arm--right">
        <i class="cpr-bd-arm-cable"></i>
        <i class="cpr-bd-arm-rail"></i>
        <i class="cpr-bd-arm-joint"></i>
        <i class="cpr-bd-arm-pad"><i class="cpr-bd-arm-led"></i></i>
      </div>
      <div class="cpr-bd-scanlines"></div>
      <div class="cpr-bd-glitch-bands" data-glitch></div>
      <div class="cpr-bd-vignette"></div>
      <div class="cpr-bd-hud">
        <svg class="cpr-bd-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="cpr-bd-ring-track" cx="60" cy="60" r="52"/>
          <circle class="cpr-bd-ring-sweep" cx="60" cy="60" r="52"/>
        </svg>
        <div class="cpr-bd-label" data-label>${LABELS[0]}</div>
      </div>
      <div class="cpr-bd-strobe" data-strobe></div>
      <div class="cpr-bd-clamp-flash" data-clamp-flash></div>
    `;
    return root;
  }

  mount() {
    if (this.el) return;
    this.el = this._buildDom();
    document.body.appendChild(this.el);
    this._labelEl = this.el.querySelector('[data-label]');
    requestAnimationFrame(() => this.el?.classList.add('cpr-bd-visible'));
  }

  /** Arms swing in, clamp, flash. Resolves once the flash has fired — the overlay is now "fully entered" and the hold loop (strobe/glitch/label) is running. */
  async playEnter() {
    this.mount();
    this._state = 'entering';

    // Next frame so the 'armed' transform/opacity actually transitions
    // instead of snapping straight to its end state on the same tick the
    // element was created.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.el?.classList.add('cpr-bd-armed');

    if (reduceMotion()) {
      // No swing, no strobe/glitch bursts — just the fade and a steady
      // clamped frame, same accessibility fallback cpr-twins-ai's boot
      // sequence and incoming-call's glitch burst both use.
      await wait(FADE_IN_MS);
      this._state = 'holding';
      this._startLabelCycle();
      return;
    }

    await wait(CLAMP_FLASH_DELAY_MS);
    this._flashClamp();
    await wait(CLAMP_FLASH_MS + (ARM_SWING_MS - CLAMP_FLASH_DELAY_MS));

    this._state = 'holding';
    this._startLabelCycle();
    this._scheduleStrobe();
    this._scheduleGlitch();
  }

  _flashClamp() {
    const el = this.el?.querySelector('[data-clamp-flash]');
    if (!el) return;
    el.classList.remove('cpr-bd-clamp-flash--active');
    void el.offsetWidth; // restart the animation if playExit->playEnter happens back to back
    el.classList.add('cpr-bd-clamp-flash--active');
  }

  _scheduleStrobe() {
    if (this._state !== 'holding') return;
    this._strobeTimer = window.setTimeout(() => {
      const el = this.el?.querySelector('[data-strobe]');
      if (el) {
        el.classList.add('cpr-bd-strobe--active');
        window.setTimeout(() => el.classList.remove('cpr-bd-strobe--active'), STROBE_DURATION_MS);
      }
      this._scheduleStrobe();
    }, randomBetween(STROBE_MIN_INTERVAL_MS, STROBE_MAX_INTERVAL_MS));
  }

  _scheduleGlitch() {
    if (this._state !== 'holding') return;
    this._glitchTimer = window.setTimeout(() => {
      const el = this.el?.querySelector('[data-glitch]');
      if (el) {
        el.classList.add('cpr-bd-glitch-bands--active');
        window.setTimeout(() => el.classList.remove('cpr-bd-glitch-bands--active'), GLITCH_DURATION_MS);
      }
      this._scheduleGlitch();
    }, randomBetween(GLITCH_MIN_INTERVAL_MS, GLITCH_MAX_INTERVAL_MS));
  }

  _startLabelCycle() {
    this._labelIndex = 0;
    const tick = () => {
      if (!this._labelEl) return;
      this._labelIndex = (this._labelIndex + 1) % LABELS.length;
      this._labelEl.textContent = LABELS[this._labelIndex];
      this._labelTimer = window.setTimeout(tick, LABEL_CYCLE_MS);
    };
    this._labelTimer = window.setTimeout(tick, LABEL_CYCLE_MS);
  }

  _clearHoldTimers() {
    if (this._strobeTimer) clearTimeout(this._strobeTimer);
    this._strobeTimer = null;
    if (this._glitchTimer) clearTimeout(this._glitchTimer);
    this._glitchTimer = null;
    if (this._labelTimer) clearTimeout(this._labelTimer);
    this._labelTimer = null;
  }

  /** Reverse flash, arms retreat, fade out, unmount. Resolves once the DOM is gone. */
  async playExit() {
    if (!this.el) return;
    this._state = 'exiting';
    this._clearHoldTimers();

    if (!reduceMotion()) {
      this._flashClamp();
      await wait(EXIT_FLASH_MS);
    }

    // Dropping 'armed' runs the arm/hud/vignette/scanline CSS transitions
    // in reverse — same rules playEnter() used to bring them in, just
    // played backwards, rather than a separate retreat-specific class.
    this.el?.classList.remove('cpr-bd-armed');
    await wait(reduceMotion() ? 0 : EXIT_RETREAT_MS);

    this.el?.classList.remove('cpr-bd-visible');
    await wait(EXIT_FADE_MS);

    this.destroy();
  }

  destroy() {
    this._clearHoldTimers();
    this._state = 'idle';
    this.el?.remove();
    this.el = null;
    this._labelEl = null;
  }
}

export const braindanceOverlay = new BraindanceOverlay();
