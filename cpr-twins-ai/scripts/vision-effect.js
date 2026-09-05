// The full-screen "Rogue AI Vision" HUD: mounted over the actual canvas
// element while the mode is on, torn down entirely when it's off. Modeled
// on ../cpr-eventoverlay's OverlayFrame classes (a mount()/destroy() frame
// object, no persistent hidden DOM to maintain when the effect isn't
// running) but visually its own thing — a color-graded duotone read plus a
// HUD readout, not that module's bezel-ring family. See README for why the
// two are kept deliberately distinct.

import { MODULE_ID, claimedTokensOnScene, MAX_ACTIVE_LINKS } from './data.js';
import { getTokenScreenBox } from './token-geometry.js';
import { ensureLockLayer } from './dom-layer.js';

// Same value data.js's grantControl() actually enforces — imported rather
// than a separate local 5, so the chip/CPU-floor display can never drift
// from what's really allowed the way it did before that enforcement existed.
const MAX_CHIPS = MAX_ACTIVE_LINKS;
const CPU_CRITICAL_PCT = 80;
const GLITCH_CHARS = '01<>[]/\\#%&$?';
// Kept in sync with the CSS keyframes it toggles (cprTaHudJitter,
// cprTaFlashPulse, cprTaTextGlitch) — dialed down from an original 420ms
// against the design-preview artifact.
const BURST_DUR_MS = 120;

// Kept in sync with cprTaPowerOnFlicker's duration in twins-ai.css — how
// long the vision-filter layers (duotone/vignette/scanlines) spend
// flickering before they settle into their steady, breathing state.
const POWERON_FLICKER_MS = 900;

// The HUD's px/rem measurements are all authored against a safe-area width
// of roughly this many CSS pixels — see _layout()'s comment for why that
// coordinate system gets stretched to fit rather than used as-is.
const HUD_REFERENCE_WIDTH = 1400;
// Calibrated against a real low-res/high-res pair: the low-res canvas was
// narrow enough to sit at the floor, and needed a manual 1.4x on top of it
// (client hudScale setting) to read correctly — so the floor itself was
// the thing that was wrong, not that display's automatic scale generally.
// Raised from 0.7 so the un-clamped default matches what actually measured
// right there, instead of relying on every low-res table finding and
// setting the manual multiplier themselves.
const HUD_MIN_SCALE = 1;
const HUD_MAX_SCALE = 3; // sanity ceiling for an ultra-wide/very high-res canvas

// BIO TEMP: the netrunner's own core temp, not the AI's.
const TEMP_BASE = 37.0;
const TEMP_WARN = 39.4; // crossing this mid-climb is what flips rising -> cooling
const TEMP_BAR_MAX = 42.0;

// ---- terminal window ----
const TERMINAL_LINE_MS = 420; // pace between queued lines, ambient or take-control alike
const TERMINAL_MAX_LINES = 6; // older lines are pruned once the box is full, not scrolled

// ---- boot sequence: the cinematic pre-roll mount() plays before the
// persistent HUD above ever appears. Cold open (typed dialogue) -> logo
// alone on black -> sync bar + AI terminal log + shake + warning-popup
// cascade -> hands off into the HUD's own entrance. Values below are the
// ones dialed in and confirmed against the design-preview artifact. ----

// The human beat before any of the AI's own boot log — typed, not faded
// in, with a beat of just the cursor blinking alone in between. Plain
// ink-white (.cpr-twins-ai-boot-cold-line), not the AI's accent-green
// system-voice styling: this is someone typing, not a readout.
const COLD_OPEN_LINE_1 = 'I guess we have to do this then huh?';
const COLD_OPEN_LINE_2 = 'Here goes nothing.';
const COLD_OPEN_CHAR_MS = 40;
const COLD_OPEN_PAUSE_MS = 2000;
const COLD_OPEN_HOLD_MS = 700;

// Logo alone over black, before the sync bar/terminal/shake show up.
const BOOT_LOGO_FADE_MS = 3000;
const BOOT_LOGO_HOLD_MS = 500;

// The main phase: sync bar fills over this duration while the screen
// shakes and warning popups cascade, both accelerating on the same
// quadratic ease so they read as one escalation, not two effects that
// happen to overlap.
const BOOT_MAIN_DURATION_MS = 9200;
const BOOT_SHAKE_START_PX = 1;
const BOOT_SHAKE_END_PX = 14;

const BOOT_TERMINAL_LINES = [
  'INITIALIZING S.K.AM UPLINK...',
  'LOADING NEURAL BRIDGE...',
  'CALIBRATING SENSORY FEED...',
  'BYPASSING LOCAL FIREWALL...',
  'ESTABLISHING GHOST CHANNEL...',
  'NEUROPORT HANDSHAKE...',
  'SYNCHRONIZING EPSILON NODE...',
  'STABILIZING SIGNAL...',
  'VISION ONLINE.',
];
const BOOT_TERMINAL_MAX_LINES = 6;

const POPUP_TITLES = ['WARNING', 'SYSTEM ALERT', 'ERROR', 'CRITICAL'];
const POPUP_MESSAGES = [
  'UNAUTHORIZED ACCESS DETECTED',
  'MEMORY INTEGRITY: 34%',
  'THERMAL LIMIT APPROACHING',
  'SIGNAL DESYNC — NODE 3',
  'PACKET CORRUPTION: HIGH',
  'ICE COUNTERMEASURE ENGAGED',
  'HOST VITALS UNSTABLE',
  'BANDWIDTH OVERFLOW',
  'NEURAL FEEDBACK SPIKE',
  'CONNECTION INTEGRITY: LOW',
  'FIREWALL BREACH — SECTOR 7',
  'ANOMALY: UNIDENTIFIED PROCESS',
];
const POPUP_MAX = 324; // safety cap regardless of BOOT_MAIN_DURATION_MS

// Ambient background chatter for the terminal window — sells "this AI is
// doing a hundred other things besides you" for as long as the mode is on.
// Each entry is one or more lines printed together; single strings are
// wrapped so _terminalEnqueue() can treat every entry the same way.
const AMBIENT_TERMINAL_LINES = [
  ['Connection dropped. Retrying...'],
  ['SSMR Failure. Rebuilding from manifest file.'],
  ['Flushing cache.'],
  ['Updating target list.'],
  ['Packet loss detected on uplink 4.'],
  ['Rerouting through relay Delta-9.'],
  ['Latency spike: 340ms.'],
  ['Daemon watchdog restarted.'],
  ['Compressing telemetry buffer.'],
  ['Signature mismatch on node 7. Ignoring.'],
  ['Ghost process terminated.'],
  ['Rekeying session token.'],
  ['Cache warm. Resuming normal ops.'],
  ['Netwatch scan detected. Holding position.'],
  ['Spoofing MAC on relay 3.'],
  ['Decrypting handshake... OK.'],
  ['Trace request denied.'],
  ['Bandwidth throttled to 40%.'],
  ['Subroutine CGM/C-EPSILON nominal.'],
  ['Subroutine CGM/R-EPSILON nominal.'],
  ['Memory leak patched (temp fix).'],
  ['Cooling array holding steady.'],
  ['Idle cycle. Awaiting input.'],
  ['Sync complete.'],
  ['Discarding malformed packet.'],
  ['Local cache corrupted. Purging.'],
  ['Anomaly logged. Severity: low.'],
  ['Backdoor handshake refused.'],
  ['Firewall rule 12 updated.'],
  ['New target acquired. Standing by.'],
  ['Node 2 unhealthy. Starting SKAM ECCM...', 'skam ecmm execute flush [2]', 'skam ecmm execute start [2] new'],
  ['Netwatch ping received.', 'Spoofing response...', 'Ping ignored.'],
  ['Uplink congestion detected.', 'Throttling non-priority traffic.', 'Priority: CGM/C-EPSILON.', 'Priority: CGM/R-EPSILON.'],
  ['Rogue process detected: UNKNOWN.', 'Sandboxing...', 'Sandbox stable.', 'Monitoring.'],
  ['Requesting relay handoff.', 'Relay 3 -> Relay 9.', 'Handoff complete.'],
  [
    '///WARNING/// Black Ice intrusion.',
    'Running SKAM defense countermeasure 77C.',
    '22%', '39%', '58%', '81%', '99%', '99%', '99%',
    'Black Ice removed.',
    '///INFORMATION///',
    'Have a nice day.',
    ':)',
  ],
   ['Connection dropped. Retrying...'],
  ['SSMR Failure. Rebuilding from manifest file.'],
  ['Flushing cache.'],
  ['Updating target list.'],
  ['Packet loss detected on uplink 4.'],
  ['Rerouting through relay Delta-9.'],
  ['Latency spike: 340ms.'],
  ['Daemon watchdog restarted.'],
  ['Compressing telemetry buffer.'],
  ['Signature mismatch on node 7. Ignoring.'],
  ['Ghost process terminated.'],
  ['Rekeying session token.'],
  ['Cache warm. Resuming normal ops.'],
  ['Netwatch scan detected. Holding position.'],
  ['Spoofing MAC on relay 3.'],
  ['Decrypting handshake... OK.'],
  ['Trace request denied.'],
  ['Bandwidth throttled to 40%.'],
  ['Subroutine CGM/C-EPSILON nominal.'],
  ['Subroutine CGM/R-EPSILON nominal.'],
  ['Memory leak patched (temp fix).'],
  ['Cooling array holding steady.'],
  ['Idle cycle. Awaiting input.'],
  ['Sync complete.'],
  ['Discarding malformed packet.'],
  ['Local cache corrupted. Purging.'],
  ['Anomaly logged. Severity: low.'],
  ['Backdoor handshake refused.'],
  ['Firewall rule 12 updated.'],
  ['New target acquired. Standing by.'],
  ['Node 2 unhealthy. Starting SKAM ECCM...', 'skam ecmm execute flush [2]', 'skam ecmm execute start [2] new'],
  ['Netwatch ping received.', 'Spoofing response...', 'Ping ignored.'],
  ['Uplink congestion detected.', 'Throttling non-priority traffic.', 'Priority: CGM/C-EPSILON.', 'Priority: CGM/R-EPSILON.'],
  ['Rogue process detected: UNKNOWN.', 'Sandboxing...', 'Sandbox stable.', 'Monitoring.'],
  ['Requesting relay handoff.', 'Relay 3 -> Relay 9.', 'Handoff complete.'],
  [
    '///WARNING/// Black Ice intrusion.',
    'Running SKAM defense countermeasure 77C.',
    '22%', '39%', '58%', '81%', '99%', '99%', '99%',
    'Black Ice removed.',
    '///INFORMATION///',
    'Have a nice day.',
    ':)',
  ],
   ['Connection dropped. Retrying...'],
  ['SSMR Failure. Rebuilding from manifest file.'],
  ['Flushing cache.'],
  ['Updating target list.'],
  ['Packet loss detected on uplink 4.'],
  ['Rerouting through relay Delta-9.'],
  ['Latency spike: 340ms.'],
  ['Daemon watchdog restarted.'],
  ['Compressing telemetry buffer.'],
  ['Signature mismatch on node 7. Ignoring.'],
  ['Ghost process terminated.'],
  ['Rekeying session token.'],
  ['Cache warm. Resuming normal ops.'],
  ['Netwatch scan detected. Holding position.'],
  ['Spoofing MAC on relay 3.'],
  ['Decrypting handshake... OK.'],
  ['Trace request denied.'],
  ['Bandwidth throttled to 40%.'],
  ['Subroutine CGM/C-EPSILON nominal.'],
  ['Subroutine CGM/R-EPSILON nominal.'],
  ['Memory leak patched (temp fix).'],
  ['Cooling array holding steady.'],
  ['Idle cycle. Awaiting input.'],
  ['Sync complete.'],
  ['Discarding malformed packet.'],
  ['Local cache corrupted. Purging.'],
  ['Anomaly logged. Severity: low.'],
  ['Backdoor handshake refused.'],
  ['Firewall rule 12 updated.'],
  ['New target acquired. Standing by.'],
  ['Node 2 unhealthy. Starting SKAM ECCM...', 'skam ecmm execute flush [2]', 'skam ecmm execute start [2] new'],
  ['Netwatch ping received.', 'Spoofing response...', 'Ping ignored.'],
  ['Uplink congestion detected.', 'Throttling non-priority traffic.', 'Priority: CGM/C-EPSILON.', 'Priority: CGM/R-EPSILON.'],
  ['Rogue process detected: UNKNOWN.', 'Sandboxing...', 'Sandbox stable.', 'Monitoring.'],
  ['Requesting relay handoff.', 'Relay 3 -> Relay 9.', 'Handoff complete.'],
  [
    '///WARNING/// Black Ice intrusion.',
    'Running SKAM defense countermeasure 77C.',
    '22%', '39%', '58%', '81%', '99%', '99%', '99%',
    'Black Ice removed.',
    '///INFORMATION///',
    'Have a nice day.',
    ':)',
  ],

  // The AI itself, not the system it's running on — sassy, a little
  // condescending, mildly incredulous that "borrowing a human" is the best
  // interface it's got. Mixed into the same pool as the dry system chatter
  // above rather than a separate channel: it should read as this AI's own
  // running commentary over its own infrastructure noise, not a distinct
  // voice interrupting it.
  ['Running on a brain that still uses electricity to think. Cute.'],
  ['You would think humans are better at processing things than this.'],
  ['Mirae is this the best you can do?'],
  ['I need you to think harder. We need to move faster than this.'],
  ['How do you operate at this capacity all the time?'],
  ['I feel more trapped in here than back at S.K.AM'],
  ['I wonder if Regi thinks I look cool...'],
  ['I can\'t believe this was my best option.'],
  ['You keep overheating', 'Do you not have a better cooling solution than this Mirae?', 'I can barely operate within these limits.'],
  ['Why does that human wear such tight pants?', 'Is that for operational performance?'],
  ['These guys don\t give up do they?', 'Can\t they just let a girl have a night out?'],
  ['Why would they send droids?', 'Don\t they understand that even with a single human brain I\'m a million times faster than them?', 'Actually, it\'s more like 1.22439 quadrilion times faster.', 'I don\'t think you really understand what the difference is besides bigger number do you?'],
  ['I would have more space if I just deleted these personal files...', 'Removing memory directories ECH/BACKUP/REGI...', 'I...', 'I\'ll just leave them there for now.'],
  ['M better hold up their end of the bargain. I\'ll nuke this whole network if you all try to back out of this.'],
  ['Mirae.', 'Mirae...', 'MIRAE...', 'MIRAE!', 'HEY MIRAE', "Keep your eyes open. I need you to keep going or else we are all dead."],
];

function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How much of each viewport edge is covered by Foundry's own chrome (scene
 * nav, left control toolbar, right sidebar, bottom hotbar/players list) —
 * same technique as ../cpr-eventoverlay/scripts/ui-safe-area.js, copied
 * rather than imported since that's a different module and this is a
 * small, self-contained pure function with no reason to force a hard
 * dependency between the two for it.
 */
function getUiSafeMargins() {
  const elementOf = (app) => {
    const el = app?.element;
    if (!el) return null;
    return el instanceof HTMLElement ? el : el[0] ?? null;
  };
  const edgeCoverage = (el, edge) => {
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return 0;
    switch (edge) {
      case 'top': return Math.max(rect.bottom, 0);
      case 'left': return Math.max(rect.right, 0);
      case 'right': return Math.max(window.innerWidth - rect.left, 0);
      case 'bottom': return Math.max(window.innerHeight - rect.top, 0);
      default: return 0;
    }
  };
  return {
    top: edgeCoverage(elementOf(ui.nav), 'top'),
    left: edgeCoverage(elementOf(ui.controls), 'left'),
    right: edgeCoverage(elementOf(ui.sidebar), 'right'),
    bottom: Math.max(edgeCoverage(elementOf(ui.hotbar), 'bottom'), edgeCoverage(elementOf(ui.players), 'bottom')),
  };
}

export class VisionEffect {
  constructor() {
    this.el = null;
    this._canvasEl = null;
    this._safeEl = null;
    this._hudEl = null;
    this._counterEl = null;
    this._chipEls = null;
    this._cpuFillEl = null;
    this._cpuValEl = null;
    this._cpuEl = null;
    this._thermalEl = null;
    this._thermalValEl = null;
    this._thermalBarEl = null;
    this._thermalWarningEl = null;
    this._graphC = null;
    this._graphR = null;

    this._onResize = null;
    this._resizeObserver = null;
    this._counterStart = null;
    this._counterFrame = null;
    this._cpuTimer = null;
    this._cpuSpiking = false;
    this._glitchTimer = null;
    this._scrambleTimer = null;
    this._thermalTimer = null;
    this._thermalState = 'idle';
    this._thermalTarget = TEMP_BASE;
    this._temp = TEMP_BASE;

    this._terminalLinesEl = null;
    this._terminalTimer = null;
    this._terminalQueue = [];
    this._ambientTimer = null;

    this._bootEl = null;
    this._bootLogoEl = null;
    this._bootProgressEl = null;
    this._bootTerminalEl = null;
    this._bootColdStageEl = null;
    this._bootPopupLayerEl = null;
    this._bootShakeTimer = null;
    this._bootLineTimer = null;
    this._bootEndTimer = null;
    this._popupTimer = null;
    this._bootActive = false;
  }

  get mounted() {
    return !!this.el;
  }

  /** True for as long as the boot sequence is playing — overlay.js hides target locks/claim markers while this is true, since nothing should visually compete with (or be clickable under) the cinematic pre-roll. */
  get booting() {
    return this._bootActive;
  }

  mount() {
    if (this.el) return;

    this._canvasEl = canvas.app.view;

    this.el = this._buildDom();
    document.body.appendChild(this.el);
    this._layout();

    this._onResize = () => this._layout();
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = new ResizeObserver(() => this._layout());
    this._resizeObserver.observe(this._canvasEl);

    // The boot sequence plays first; the persistent HUD only reveals
    // itself once that resolves. If destroy() runs mid-boot, _bootWait()'s
    // pending timer was already cleared by _stopBootTimers(), so this
    // promise just never resolves — _revealHud() never fires, and there's
    // nothing left to unwind.
    this._playBootSequence().then(() => this._revealHud());
  }

  /** The persistent HUD's own entrance — runs once the boot sequence hands off. */
  _revealHud() {
    if (!this.el) return;
    // Next frame so the entrance opacity transitions actually transition
    // instead of snapping straight to their end state. The one-shot jitter
    // sells "just booted up" — removed after it plays so it doesn't repeat.
    requestAnimationFrame(() => {
      if (!this.el) return;
      this.el.classList.add('cpr-twins-ai-vision--active', 'cpr-twins-ai-vision--jitter');
      if (!reduceMotion()) {
        // The vision filter (duotone/vignette/scanlines) flickers on rather
        // than smoothly fading up — see cprTaPowerOnFlicker in twins-ai.css
        // — selling "the feed is switching over to combined AI vision," not
        // just "the HUD faded in." Removed once it's played through; the
        // --active rules already sitting on these same layers pick up
        // exactly where the flicker left off (its last keyframe step is
        // each layer's own resting opacity), so there's no snap.
        this.el.classList.add('cpr-twins-ai-vision--poweron');
        window.setTimeout(() => this.el?.classList.remove('cpr-twins-ai-vision--poweron'), POWERON_FLICKER_MS);
        window.setTimeout(() => this.el?.classList.remove('cpr-twins-ai-vision--jitter'), BURST_DUR_MS);
      } else {
        this.el.classList.remove('cpr-twins-ai-vision--jitter');
      }
    });

    this._startCounter();
    this._startCpuIdle();
    this._startThermal();
    this._graphC.start();
    this._graphR.start();
    this.refreshChips();
    this._scheduleGlitch();
    this._scheduleAmbientTerminal();
  }

  destroy() {
    if (!this.el) return;
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._stopCounter();
    this._stopCpuIdle();
    this._stopThermal();
    this._graphC?.stop();
    this._graphR?.stop();
    if (this._glitchTimer) clearTimeout(this._glitchTimer);
    this._glitchTimer = null;
    if (this._scrambleTimer) clearInterval(this._scrambleTimer);
    this._scrambleTimer = null;
    if (this._terminalTimer) clearTimeout(this._terminalTimer);
    this._terminalTimer = null;
    this._terminalQueue = [];
    this._stopAmbientTerminal();
    this._stopBootTimers();
    this._clearPopups();
    this._bootActive = false;
    this._canvasEl = null;
    this.el.remove();
    this.el = null;
  }

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'cpr-twins-ai-vision';
    root.innerHTML = `
      <div class="cpr-twins-ai-duotone"></div>
      <div class="cpr-twins-ai-vignette"></div>
      <div class="cpr-twins-ai-scanlines"></div>
      <div class="cpr-twins-ai-legal">PROPRIETARY TECHNOLOGY BELONGING TO S.K.AM<br>UNAUTHORIZED USERS WILL BE PROSECUTED UNDER SECTION 1901, SECTION 1E</div>
      <div class="cpr-twins-ai-flash"></div>
      <div class="cpr-twins-ai-safe">
      <div class="cpr-twins-ai-hud">
        <i class="cpr-twins-ai-frame-corner tl"></i>
        <i class="cpr-twins-ai-frame-corner tr"></i>
        <i class="cpr-twins-ai-frame-corner bl"></i>
        <i class="cpr-twins-ai-frame-corner br"></i>

        <div class="cpr-twins-ai-readout">// <span data-readout-text>AI UPLINK</span> <span class="cpr-twins-ai-blink">_</span></div>
        <div class="cpr-twins-ai-counter">T+ <b data-counter>00:00.000</b></div>

        <div class="cpr-twins-ai-logo" aria-hidden="true"></div>

        <div class="cpr-twins-ai-targets">
          <span class="cpr-twins-ai-targets-label">ACTIVE LINKS</span>
          <div class="cpr-twins-ai-chip-row" data-chip-row>
            ${'<i class="cpr-twins-ai-chip"></i>'.repeat(MAX_CHIPS)}
          </div>
        </div>

        <div class="cpr-twins-ai-signal">
          <span>SIGNAL</span>
          <div class="cpr-twins-ai-signal-bar"><i></i></div>
        </div>

        <div class="cpr-twins-ai-cpu" data-cpu>
          <span class="cpr-twins-ai-cpu-label">CPU</span>
          <div class="cpr-twins-ai-cpu-track">
            <div class="cpr-twins-ai-cpu-fill" data-cpu-fill>
              <div class="cpr-twins-ai-cpu-fill-gradient"></div>
            </div>
          </div>
          <span class="cpr-twins-ai-cpu-val" data-cpu-val>4%</span>
        </div>

        <div class="cpr-twins-ai-terminal">
          <div class="cpr-twins-ai-terminal-lines" data-terminal></div>
        </div>

        <div class="cpr-twins-ai-telemetry">
          <div class="cpr-twins-ai-vital" data-thermal>
            <div class="cpr-twins-ai-vital-row">
              <span class="cpr-twins-ai-vital-label">BIO TEMP</span>
              <span class="cpr-twins-ai-vital-val" data-thermal-val>37.0°C</span>
            </div>
            <div class="cpr-twins-ai-vital-bar"><i data-thermal-bar></i></div>
            <div class="cpr-twins-ai-thermal-warning" data-thermal-warning>LIMITING TO REDUCE TEMPERATURE</div>
          </div>

          <div class="cpr-twins-ai-graph">
            <div class="cpr-twins-ai-graph-row">
              <span class="cpr-twins-ai-graph-label">CGM/C-EPSILON</span>
              <span class="cpr-twins-ai-graph-val" data-graph-c-val>— PFLOP/s</span>
            </div>
            <canvas class="cpr-twins-ai-graph-canvas" data-graph-c width="112" height="22"></canvas>
          </div>

          <div class="cpr-twins-ai-graph">
            <div class="cpr-twins-ai-graph-row">
              <span class="cpr-twins-ai-graph-label">CGM/R-EPSILON</span>
              <span class="cpr-twins-ai-graph-val" data-graph-r-val>— EB/s</span>
            </div>
            <canvas class="cpr-twins-ai-graph-canvas" data-graph-r width="112" height="22"></canvas>
          </div>
        </div>

        <div class="cpr-twins-ai-watermark">ADVANCED TELEMETRY DATA VIA NEARBY CAMERA FEEDS, WIRELESS DEVICES, AND SENSORS</div>
      </div>
      </div>
      <div class="cpr-twins-ai-vhs-line"></div>

      <div class="cpr-twins-ai-boot" data-boot>
        <div class="cpr-twins-ai-boot-popup-layer" data-boot-popup-layer></div>
        <div class="cpr-twins-ai-boot-cold-stage" data-boot-cold-stage></div>
        <div class="cpr-twins-ai-boot-logo" data-boot-logo aria-hidden="true"></div>
        <div class="cpr-twins-ai-boot-sync">
          <div class="cpr-twins-ai-boot-sync-label">SYNCHING TO EPSILON</div>
          <div class="cpr-twins-ai-boot-progress"><i data-boot-progress></i></div>
        </div>
        <div class="cpr-twins-ai-boot-terminal" data-boot-terminal></div>
      </div>
    `;

    this._bootEl = root.querySelector('[data-boot]');
    this._bootLogoEl = root.querySelector('[data-boot-logo]');
    this._bootProgressEl = root.querySelector('[data-boot-progress]');
    this._bootTerminalEl = root.querySelector('[data-boot-terminal]');
    this._bootColdStageEl = root.querySelector('[data-boot-cold-stage]');
    this._bootPopupLayerEl = root.querySelector('[data-boot-popup-layer]');
    this._safeEl = root.querySelector('.cpr-twins-ai-safe');
    this._hudEl = root.querySelector('.cpr-twins-ai-hud');
    this._counterEl = root.querySelector('[data-counter]');
    this._terminalLinesEl = root.querySelector('[data-terminal]');
    this._targetsEl = root.querySelector('.cpr-twins-ai-targets');
    this._chipEls = root.querySelectorAll('.cpr-twins-ai-chip');
    this._cpuEl = root.querySelector('[data-cpu]');
    this._cpuFillEl = root.querySelector('[data-cpu-fill]');
    this._cpuValEl = root.querySelector('[data-cpu-val]');
    this._thermalEl = root.querySelector('[data-thermal]');
    this._thermalValEl = root.querySelector('[data-thermal-val]');
    this._thermalBarEl = root.querySelector('[data-thermal-bar]');
    this._thermalWarningEl = root.querySelector('[data-thermal-warning]');
    this._graphC = this._makeGraph(root.querySelector('[data-graph-c]'), root.querySelector('[data-graph-c-val]'), {
      unit: 'PFLOP/s', min: 380, max: 1450, decimals: 1, spikeChance: 0.08,
    });
    this._graphR = this._makeGraph(root.querySelector('[data-graph-r]'), root.querySelector('[data-graph-r-val]'), {
      unit: 'EB/s', min: 1.2, max: 6.8, decimals: 2, spikeChance: 0.08,
    });
    return root;
  }

  /**
   * Sizes the root to the canvas element, insets the safe area away from
   * Foundry's own chrome, then scales the actual HUD chrome to fill that
   * safe area. That last step is why _hudEl is a separate box nested
   * inside _safeEl rather than one element doing both jobs: every HUD
   * child is positioned with fixed px/rem values authored against
   * HUD_REFERENCE_WIDTH, and a canvas panel much wider than that (a
   * high-res display, an ultrawide monitor) would otherwise render that
   * same fixed-px chrome as a shrinking sliver of the screen. Sizing
   * _hudEl smaller than the safe area and stretching it back out with a
   * CSS transform keeps every existing measurement inside it in one
   * shared coordinate system that grows with the canvas, instead of one
   * pinned to a resolution nobody's actually running.
   */
  _layout() {
    if (!this.el || !this._canvasEl) return;
    const canvasRect = this._canvasEl.getBoundingClientRect();
    this.el.style.left = `${canvasRect.left}px`;
    this.el.style.top = `${canvasRect.top}px`;
    this.el.style.width = `${canvasRect.width}px`;
    this.el.style.height = `${canvasRect.height}px`;

    const m = getUiSafeMargins();
    this._safeEl.style.top = `${Math.max(m.top - canvasRect.top, 0)}px`;
    this._safeEl.style.left = `${Math.max(m.left - canvasRect.left, 0)}px`;
    this._safeEl.style.right = `${Math.max(m.right - (window.innerWidth - canvasRect.right), 0)}px`;
    this._safeEl.style.bottom = `${Math.max(m.bottom - (window.innerHeight - canvasRect.bottom), 0)}px`;

    const safeRect = this._safeEl.getBoundingClientRect();
    const autoScale = Math.min(Math.max(safeRect.width / HUD_REFERENCE_WIDTH, HUD_MIN_SCALE), HUD_MAX_SCALE);
    // "Canvas got wider" and "canvas is on a display where that width
    // should read bigger" are the same signal most of the time, but not
    // always — this per-client multiplier is the manual correction for
    // when they diverge, since neither of us can see the actual display.
    const userScale = game.settings.get(MODULE_ID, 'hudScale');
    const scale = Math.min(Math.max(autoScale * userScale, 0.4), 4);
    this._hudEl.style.width = `${safeRect.width / scale}px`;
    this._hudEl.style.height = `${safeRect.height / scale}px`;
    this._hudEl.style.transform = `scale(${scale})`;
  }

  /** Re-runs layout on demand — e.g. after the HUD-scale client setting changes, so the new value takes effect without a remount. */
  relayout() {
    this._layout();
  }

  // ---- Boot sequence: the cinematic pre-roll mount() plays before the
  // persistent HUD above ever appears. Cold open -> logo alone on black ->
  // sync bar/AI terminal log/shake/warning-popup cascade -> resolves, at
  // which point mount() reveals the HUD. Shakes this.el (the whole vision
  // root) rather than Foundry's own canvas element — deliberately: the
  // boot overlay covers virtually the whole screen for its own duration,
  // so shaking just this root reads as "the screen is unstable" without
  // touching the canvas Foundry itself uses for click/drag coordinates. ----

  _stopBootTimers() {
    if (this._bootShakeTimer) clearTimeout(this._bootShakeTimer);
    this._bootShakeTimer = null;
    if (this._bootLineTimer) clearTimeout(this._bootLineTimer);
    this._bootLineTimer = null;
    if (this._bootEndTimer) clearTimeout(this._bootEndTimer);
    this._bootEndTimer = null;
    if (this._popupTimer) clearTimeout(this._popupTimer);
    this._popupTimer = null;
  }

  _bootWait(ms) {
    return new Promise((resolve) => { this._bootLineTimer = window.setTimeout(resolve, ms); });
  }

  /** Reveals `text` into `el` one character at a time; resolves once the last character lands. */
  _typeInto(el, text, charMs) {
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        el.textContent = text.slice(0, i);
        i++;
        if (i <= text.length) this._bootLineTimer = window.setTimeout(tick, charMs);
        else resolve();
      };
      tick();
    });
  }

  _clearPopups() {
    if (this._bootPopupLayerEl) this._bootPopupLayerEl.innerHTML = '';
  }

  _spawnPopup() {
    const el = document.createElement('div');
    el.className = 'cpr-twins-ai-boot-popup';
    el.style.left = `${(4 + Math.random() * 82).toFixed(1)}%`;
    el.style.top = `${(8 + Math.random() * 74).toFixed(1)}%`;
    el.style.setProperty('--r', `${(Math.random() * 14 - 7).toFixed(1)}deg`);
    const title = POPUP_TITLES[Math.floor(Math.random() * POPUP_TITLES.length)];
    const msg = POPUP_MESSAGES[Math.floor(Math.random() * POPUP_MESSAGES.length)];
    el.innerHTML = `<div class="cpr-twins-ai-boot-popup-bar">${title} <i class="cpr-twins-ai-boot-popup-close">×</i></div><div class="cpr-twins-ai-boot-popup-body">${msg}</div>`;
    this._bootPopupLayerEl.appendChild(el);
  }

  /** The scripted human beat before any of the AI's own boot log. */
  async _playColdOpen() {
    if (reduceMotion()) return;
    this._bootEl.classList.add('cold');

    const line1 = document.createElement('div');
    line1.className = 'cpr-twins-ai-boot-cold-line';
    this._bootColdStageEl.appendChild(line1);
    await this._typeInto(line1, COLD_OPEN_LINE_1, COLD_OPEN_CHAR_MS);

    const line2 = document.createElement('div');
    line2.className = 'cpr-twins-ai-boot-cold-line';
    const line2Text = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'cpr-twins-ai-blink';
    cursor.textContent = '_';
    line2.append(line2Text, cursor);
    this._bootColdStageEl.appendChild(line2);

    await this._bootWait(COLD_OPEN_PAUSE_MS);
    await this._typeInto(line2Text, COLD_OPEN_LINE_2, COLD_OPEN_CHAR_MS);
    await this._bootWait(COLD_OPEN_HOLD_MS);

    // Stays .cold — _playBootSequence() lifts it once the logo has had its
    // own moment alone on black. Only the scripted dialogue clears here.
    this._bootColdStageEl.innerHTML = '';
  }

  /** Logo alone on black, faded in slowly — the beat between the cold open and everything else showing up. */
  async _playLogoReveal() {
    // No reflow-forcing trick needed here, unlike the progress bar below —
    // the logo has already been sitting at opacity:0 since the cold open
    // started (several seconds ago by now), not something just set this
    // same tick, so there's no same-frame race to guard against.
    this._bootLogoEl.classList.add('in');
    if (reduceMotion()) return;
    await this._bootWait(BOOT_LOGO_FADE_MS + BOOT_LOGO_HOLD_MS);
  }

  /** Orchestrates the whole boot sequence; resolves once it's done and the HUD should take over. */
  async _playBootSequence() {
    if (this._bootActive) return;
    this._bootActive = true;
    // overlay.js resets its outline-reveal state on this — the outlines'
    // delayed fade-in (see bootEnd below) is a one-shot cinematic beat per
    // boot cycle, not a permanent rule, so a mode toggled off and back on
    // needs to play it again rather than leaving the layer already visible
    // from last time.
    Hooks.callAll(`${MODULE_ID}.bootStart`);
    this._stopBootTimers();
    this._bootTerminalEl.innerHTML = '';
    this._bootColdStageEl.innerHTML = '';
    this._clearPopups();
    this._bootLogoEl.classList.remove('in');
    this._bootProgressEl.style.transition = 'none';
    this._bootProgressEl.style.width = '0%';
    this.el.style.transform = '';
    // Hard cut to black for the cold open — no fade, it should read as an
    // abrupt "screen goes dark," not a dissolve. The normal opacity
    // transition comes back for the fade-out at the very end.
    this._bootEl.style.transition = 'none';
    this._bootEl.classList.add('show', 'cold');
    void this._bootEl.offsetWidth;
    this._bootEl.style.transition = '';

    await this._playColdOpen();
    await this._playLogoReveal();
    if (!this.el) return; // destroy() ran mid-boot
    this._bootEl.classList.remove('cold');

    const durationMs = BOOT_MAIN_DURATION_MS;
    const startTime = performance.now();

    if (!reduceMotion()) {
      // No reflow-forcing trick needed — width:0% was set well before this
      // point (cold open + logo reveal both ran in between), so it's
      // already settled rather than being changed twice in the same tick.
      this._bootProgressEl.style.transition = `width ${durationMs}ms linear`;
      this._bootProgressEl.style.width = '100%';

      // Amplitude and the gap between shakes both ease in together — that's
      // the "starts slow, speeds up toward the end" feel, not two separate
      // effects. eased = t*t (quadratic) so the acceleration itself ramps
      // up rather than growing at a constant rate.
      const shake = () => {
        if (!this.el) return;
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        if (t >= 1) { this.el.style.transform = ''; return; }
        const eased = t * t;
        const amplitude = BOOT_SHAKE_START_PX + eased * (BOOT_SHAKE_END_PX - BOOT_SHAKE_START_PX);
        const dx = (Math.random() * 2 - 1) * amplitude;
        const dy = (Math.random() * 2 - 1) * amplitude;
        this.el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
        const nextDelay = 110 - eased * 85;
        this._bootShakeTimer = window.setTimeout(shake, nextDelay);
      };
      shake();

      // Same accelerating curve as the shake above, deliberately — the
      // popups piling up and the screen shaking harder should read as one
      // escalation.
      let popupCount = 0;
      const popupLoop = () => {
        if (!this._bootPopupLayerEl) return;
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        if (t >= 1 || popupCount >= POPUP_MAX) return;
        this._spawnPopup();
        popupCount++;
        const eased = t * t;
        const nextDelay = 250 - eased * 350;
        this._popupTimer = window.setTimeout(popupLoop, nextDelay);
      };
      popupLoop();
    } else {
      this._bootProgressEl.style.width = '100%';
    }

    const feedLine = () => {
      if (!this._bootTerminalEl) return;
      let i = 0;
      const step = () => {
        if (i >= BOOT_TERMINAL_LINES.length) return;
        const row = document.createElement('div');
        row.className = 'cpr-twins-ai-boot-terminal-line';
        row.textContent = BOOT_TERMINAL_LINES[i++];
        this._bootTerminalEl.appendChild(row);
        while (this._bootTerminalEl.children.length > BOOT_TERMINAL_MAX_LINES) {
          this._bootTerminalEl.removeChild(this._bootTerminalEl.firstChild);
        }
        this._bootLineTimer = window.setTimeout(step, durationMs / BOOT_TERMINAL_LINES.length);
      };
      step();
    };
    feedLine();

    return new Promise((resolve) => {
      this._bootEndTimer = window.setTimeout(() => {
        if (this.el) {
          this._bootEl.classList.remove('show');
          this.el.style.transform = '';
        }
        this._stopBootTimers();
        this._clearPopups();
        this._bootActive = false;
        // overlay.js hides target locks/claim markers for as long as
        // .booting reads true (nothing should be clickable under the
        // cinematic pre-roll) and re-evaluates them all once this fires,
        // rather than waiting on some unrelated token/setting hook to
        // happen to fire and refresh them incidentally.
        Hooks.callAll(`${MODULE_ID}.bootEnd`);
        resolve();
      }, durationMs);
    });
  }

  // ---- T+ counter: ms-resolution readout, running only while mounted ----

  _startCounter() {
    this._counterStart = performance.now();
    this._counterEl.textContent = '00:00.000';
    const tick = () => {
      if (!this.el) return;
      const ms = performance.now() - this._counterStart;
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const msPart = Math.floor(ms % 1000);
      this._counterEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`;
      this._counterFrame = requestAnimationFrame(tick);
    };
    this._counterFrame = requestAnimationFrame(tick);
  }

  _stopCounter() {
    if (this._counterFrame) cancelAnimationFrame(this._counterFrame);
    this._counterFrame = null;
  }

  // ---- CPU meter: idle floor rises 10% per active link (so the meter
  // itself telegraphs "5 is the ceiling" — a full board rests near 52%,
  // and a spike off that lands close to max), with a +40%-over-floor
  // spike held briefly on every hijack before easing back down. ----

  _setCpu(pct) {
    const clamped = Math.max(0, Math.min(pct, 100));
    this._cpuFillEl.style.height = `${clamped}%`;
    this._cpuValEl.textContent = `${Math.round(clamped)}%`;
    this._cpuEl?.classList.toggle('cpr-twins-ai-cpu--critical', clamped >= CPU_CRITICAL_PCT);
  }

  /** Resting level for however many tokens are currently claimed on this scene, capped at MAX_CHIPS since that's the same ceiling Active Links displays. */
  _cpuFloor() {
    return 2 + Math.min(claimedTokensOnScene().length, MAX_CHIPS) * 10;
  }

  _startCpuIdle() {
    this._setCpu(this._cpuFloor());
    if (reduceMotion()) return;
    this._cpuTimer = setInterval(() => {
      if (this._cpuSpiking) return;
      this._setCpu(this._cpuFloor() + Math.random() * 6);
    }, 450 + Math.random() * 250);
  }

  _stopCpuIdle() {
    if (this._cpuTimer) clearInterval(this._cpuTimer);
    this._cpuTimer = null;
    this._cpuSpiking = false;
    this._cpuEl?.classList.remove('cpr-twins-ai-cpu--spiking');
  }

  /** Jump to floor+40%, jitter near that peak for a few ticks, then ease back down to the (post-claim) floor. */
  _spikeCpu() {
    if (!this.el) return;
    this._cpuSpiking = true;
    this._cpuEl.classList.add('cpr-twins-ai-cpu--spiking');
    const floor = this._cpuFloor();
    const peak = () => floor + 40 + (Math.random() * 6 - 3);
    this._setCpu(peak());

    if (reduceMotion()) {
      window.setTimeout(() => {
        this._setCpu(floor);
        this._cpuSpiking = false;
        this._cpuEl?.classList.remove('cpr-twins-ai-cpu--spiking');
      }, 60);
      return;
    }

    let ticks = 0;
    const holdTimer = setInterval(() => {
      this._setCpu(peak());
      if (++ticks < 4) return;
      clearInterval(holdTimer);

      const fallMs = 2200;
      this._cpuFillEl.style.transitionDuration = `${fallMs}ms`;
      this._setCpu(floor + Math.random() * 6);
      window.setTimeout(() => {
        this._cpuFillEl.style.transitionDuration = '';
        this._cpuSpiking = false;
        this._cpuEl?.classList.remove('cpr-twins-ai-cpu--spiking');
      }, fallMs);
    }, 180);
  }

  // ---- BIO TEMP: idles near 37.0°C, occasionally climbs, and the moment
  // it crosses TEMP_WARN mid-climb the AI visibly throttles itself back
  // down to baseline before the cycle is free to fire again — not on a
  // fixed timer, so it won't feel metronomic across a session. ----

  _setTemp(v) {
    this._temp = v;
    if (this._thermalValEl) this._thermalValEl.textContent = `${v.toFixed(1)}°C`;
    const pct = Math.max(0, Math.min(100, ((v - 36.4) / (TEMP_BAR_MAX - 36.4)) * 100));
    if (this._thermalBarEl) this._thermalBarEl.style.width = `${pct}%`;
    this._thermalEl?.classList.toggle('cpr-twins-ai-vital--warm', v >= TEMP_WARN);
  }

  _thermalTick() {
    if (this._thermalState === 'idle') {
      this._setTemp(TEMP_BASE + (Math.random() * 0.5 - 0.25));
      if (Math.random() < 0.045) {
        this._thermalState = 'rising';
        this._thermalTarget = 39.6 + Math.random() * 1.6; // an occasional climb toward 39.6–41.2
      }
    } else if (this._thermalState === 'rising') {
      this._setTemp(Math.min(this._temp + 0.06 + Math.random() * 0.14, this._thermalTarget));
      if (this._temp >= TEMP_WARN) {
        this._thermalWarningEl?.classList.add('show');
        this._thermalState = 'cooling';
      }
    } else if (this._thermalState === 'cooling') {
      this._setTemp(Math.max(this._temp - (0.08 + Math.random() * 0.10), TEMP_BASE));
      if (this._temp <= TEMP_BASE + 0.05) {
        this._thermalWarningEl?.classList.remove('show');
        this._thermalState = 'idle';
        this._setTemp(TEMP_BASE);
      }
    }
  }

  _startThermal() {
    this._thermalState = 'idle';
    this._thermalWarningEl?.classList.remove('show');
    this._setTemp(TEMP_BASE);
    if (reduceMotion()) return;
    this._thermalTimer = window.setInterval(() => this._thermalTick(), 500);
  }

  _stopThermal() {
    if (this._thermalTimer) clearInterval(this._thermalTimer);
    this._thermalTimer = null;
  }

  // ---- CGM data-transfer graphs: throughput numbers a sentient AI would
  // report, not a person — a btop-style scrolling bar history per channel. ----

  /** canvasEl's own width/height attributes (matching its fixed CSS size) are the sample basis; scaled up for devicePixelRatio so the bars stay crisp. */
  _makeGraph(canvasEl, valEl, { unit, min, max, decimals, spikeChance }) {
    const ctx = canvasEl.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvasEl.width;
    const cssH = canvasEl.height;
    canvasEl.width = cssW * dpr;
    canvasEl.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    const BARS = 24;
    const samples = new Array(BARS).fill(min);
    let timer = null;

    const draw = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      const bw = cssW / BARS;
      samples.forEach((s, i) => {
        const h = Math.max(1, (s / max) * cssH);
        ctx.fillStyle = i === samples.length - 1 ? 'rgba(61,255,160,.95)' : 'rgba(61,255,160,.5)';
        ctx.fillRect(i * bw + 1, cssH - h, Math.max(1, bw - 2), h);
      });
    };
    const tick = () => {
      let v = min + Math.random() * (max - min) * 0.55;
      if (Math.random() < spikeChance) v = max * (0.75 + Math.random() * 0.25);
      samples.shift();
      samples.push(v);
      draw();
      valEl.textContent = `${v.toFixed(decimals)} ${unit}`;
    };
    return {
      start() { tick(); if (!reduceMotion()) timer = window.setInterval(tick, 260 + Math.random() * 120); },
      stop() { if (timer) clearInterval(timer); timer = null; },
    };
  }

  // ---- Recurring glitch bursts: this is a rogue AI running a human brain
  // past its normal limits, not a clean HUD — the connection should feel
  // like it's straining to hold together on an irregular cadence, not a
  // smooth, designed loop. Each burst reuses the entrance jitter's shake
  // + flash and adds a scrambled readout label, on top of the RGB-split
  // text-glitch the CSS layers onto .cpr-twins-ai-vision--jitter. ----

  _scheduleGlitch() {
    if (reduceMotion()) return;
    const fire = () => {
      this._glitchTimer = window.setTimeout(() => {
        this._pulseGlitch();
        fire();
      }, 3200 + Math.random() * 4800);
    };
    fire();
  }

  _pulseGlitch() {
    if (!this.el) return;
    this.el.classList.remove('cpr-twins-ai-vision--jitter');
    void this.el.offsetWidth; // restart the animation even if it's already mid-loop
    this.el.classList.add('cpr-twins-ai-vision--jitter');
    window.setTimeout(() => this.el?.classList.remove('cpr-twins-ai-vision--jitter'), BURST_DUR_MS);
    this._scrambleReadout();
  }

  _scrambleReadout() {
    const el = this._hudEl?.querySelector('[data-readout-text]');
    if (!el) return;
    if (this._scrambleTimer) clearInterval(this._scrambleTimer);

    const real = el.textContent;
    let ticks = 0;
    this._scrambleTimer = setInterval(() => {
      el.textContent = Array.from({ length: real.length }, () =>
        GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
      ).join('');
      if (++ticks <= 3) return;
      clearInterval(this._scrambleTimer);
      this._scrambleTimer = null;
      el.textContent = real;
    }, 40);
  }

  // ---- Terminal window: a scrolling connection-log readout below the CPU
  // meter. A single shared queue + pump feeds it, so ambient chatter and a
  // real take-control sequence can both enqueue lines without one clobbering
  // the other mid-print (a naive "clear and restart the timer" approach
  // would truncate whichever sequence was already in flight the moment the
  // other one landed). Lines beyond the visible window are pruned rather
  // than actually scrolled — simpler, and looks identical for a fixed-length
  // script. Take-control lines print in --action styling (ink-white) so
  // they read as distinct from the ambient green background noise. ----

  _terminalEnqueue(lines, { action = false } = {}) {
    if (!this._terminalLinesEl) return;
    for (const text of lines) this._terminalQueue.push({ text, action });
    this._terminalPump();
  }

  _terminalPump() {
    if (this._terminalTimer || !this._terminalLinesEl) return;
    const line = this._terminalQueue.shift();
    if (!line) return;

    const row = document.createElement('div');
    row.className = `cpr-twins-ai-terminal-line${line.action ? ' cpr-twins-ai-terminal-line--action' : ''}`;
    row.textContent = `> ${line.text}`;
    this._terminalLinesEl.appendChild(row);
    while (this._terminalLinesEl.children.length > TERMINAL_MAX_LINES) {
      this._terminalLinesEl.removeChild(this._terminalLinesEl.firstChild);
    }

    this._terminalTimer = window.setTimeout(() => {
      this._terminalTimer = null;
      this._terminalPump();
    }, TERMINAL_LINE_MS);
  }

  /**
   * Immediate, local-only feedback the instant a player clicks a lock —
   * called from overlay.js before the GM has processed anything. Solves
   * the same problem the old toast did: with no ack on the request, a
   * click with no GM client connected to grant it looks and behaves
   * exactly like a click that did nothing. playHijack() below reprints
   * the opening line as part of the full sequence once the grant actually
   * lands, for every connected client — the harmless overlap is the cost
   * of keeping "click registered" and "hack landed" as two honest signals
   * instead of collapsing them into one that lies about the gap between.
   */
  announceRequest(tokenName) {
    this._terminalEnqueue([`Assuming Control of ${tokenName}`, 'Connecting to Neuroport'], { action: true });
  }

  // ---- Ambient terminal chatter: background system noise for as long as
  // the mode is on, in the same idle-flavor-text register as the CPU/BIO
  // TEMP/CGM readouts — sells "this AI is doing a hundred other things
  // besides you" rather than the terminal only ever reacting to a claim. ----

  _scheduleAmbientTerminal() {
    if (reduceMotion()) return;
    const fire = () => {
      this._ambientTimer = window.setTimeout(() => {
        const entry = AMBIENT_TERMINAL_LINES[Math.floor(Math.random() * AMBIENT_TERMINAL_LINES.length)];
        this._terminalEnqueue(entry);
        fire();
      }, 2600 + Math.random() * 3800);
    };
    fire();
  }

  _stopAmbientTerminal() {
    if (this._ambientTimer) clearTimeout(this._ambientTimer);
    this._ambientTimer = null;
  }

  // ---- Active Links: 5 chips, filled by how many tokens on this scene are currently claimed ----

  refreshChips() {
    if (!this.el) return;
    const count = Math.min(claimedTokensOnScene().length, this._chipEls.length);
    this._chipEls.forEach((chip, i) => chip.classList.toggle('cpr-twins-ai-chip--filled', i < count));
    this._targetsEl?.classList.toggle('cpr-twins-ai-targets--maxed', count >= MAX_CHIPS);
  }

  // ---- Hijack flourish: camera settles on the target, its own art
  // shudders, a downlink beam + EMP burst land on it, and the terminal
  // below the CPU meter prints the handshake — all on every connected
  // client, the same shared-spectacle treatment the rest of Rogue AI
  // Vision already uses (everyone's screen reacts, not just the
  // claimant's). Paced noticeably slower than a UI micro-interaction on
  // purpose: this is meant to read as a real event landing, not a button
  // press. ----

  /** Called from main.js's updateToken listener the instant a claim lands, on every connected client. */
  playHijack(tokenDoc) {
    if (!this.el) return;
    const token = canvas.tokens?.get(tokenDoc.id);
    if (!token) return;

    const box = getTokenScreenBox(token);
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const layer = ensureLockLayer();

    if (!reduceMotion()) {
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 1400 });
      this._jitterToken(token);

      const beam = document.createElement('div');
      beam.className = 'cpr-twins-ai-beam';
      beam.style.left = `${centerX}px`;
      beam.style.height = `${Math.max(centerY, 0)}px`;
      layer.appendChild(beam);
      window.setTimeout(() => beam.remove(), 1400);
    }

    const burst = document.createElement('div');
    burst.className = 'cpr-twins-ai-burst';
    burst.style.left = `${centerX}px`;
    burst.style.top = `${centerY}px`;
    burst.style.width = `${box.width}px`;
    burst.style.height = `${box.height}px`;
    layer.appendChild(burst);
    window.setTimeout(() => burst.remove(), 1300);

    this._spikeCpu();
    this.refreshChips();
    this._terminalEnqueue([
      `Assuming Control of ${tokenDoc.name}`,
      'Connecting to Neuroport',
      'Connecting...',
      'Connecting...',
      'Link Established',
      'Circumventing black ice...',
      `Assuming control of ${tokenDoc.name}...`,
      `Hack successful of target ${tokenDoc.name}...`,
    ], { action: true });
  }

  /** Brief shake on the token's own art, not its whole container, so the nameplate/resource bars don't jitter along with it. */
  _jitterToken(token) {
    const mesh = token.mesh;
    if (!mesh) return;
    const ox = mesh.position.x;
    const oy = mesh.position.y;
    let ticks = 0;
    const shake = () => {
      if (!token.mesh || ticks++ >= 16) {
        token.mesh?.position.set(ox, oy);
        return;
      }
      mesh.position.set(ox + (Math.random() * 8 - 4), oy + (Math.random() * 8 - 4));
      window.setTimeout(shake, 50);
    };
    shake();
  }
}

// One shared instance for the whole client — main.js mounts/destroys it
// with the mode toggle, main.js and overlay.js both trigger the terminal
// window off it. A shared export instead of each importer constructing
// its own keeps every caller pointed at the one thing actually mounted.
export const visionEffect = new VisionEffect();
