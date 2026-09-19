// The full-screen "Rogue AI Vision" HUD: mounted over the actual canvas
// element while the mode is on, torn down entirely when it's off. Modeled
// on ../cpr-eventoverlay's OverlayFrame classes (a mount()/destroy() frame
// object, no persistent hidden DOM to maintain when the effect isn't
// running) but visually its own thing — a color-graded duotone read plus a
// HUD readout, not that module's bezel-ring family. See README for why the
// two are kept deliberately distinct.

import { MODULE_ID, claimedTokensOnScene, MAX_ACTIVE_LINKS, isCacheCorrupted } from './data.js';
import { getTokenScreenBox } from './token-geometry.js';
import { ensureLockLayer } from './dom-layer.js';

// Same value data.js's grantControl() actually enforces — imported rather
// than a separate local 5, so the chip/CPU-floor display can never drift
// from what's really allowed the way it did before that enforcement existed.
const MAX_CHIPS = MAX_ACTIVE_LINKS;
const CPU_CRITICAL_PCT = 80;
// How wildly CPU/MEM swing for as long as a netrunner intrusion is active
// — "the netrunner is doing damage," not a normal hijack spike, so this is
// a chaotic jump between half-load and maxed out, not a steady near-ceiling
// peg. Ticking BREACH_TICK_SPEEDUP times faster on top of that (see
// _startCpuIdle/_startMemIdle/_makeGraph) is what actually sells "jumping
// around quickly" instead of just "a wide but slow drift."
const BREACH_LOAD_LOW_PCT = 50;
const BREACH_LOAD_HIGH_PCT = 100;
// Applies to CPU/MEM's own tick rate and (on top of their already-doubled
// rate) the CGM graphs' — quadruple speed altogether during a breach.
const BREACH_TICK_SPEEDUP = 4;
// Glitch bursts (_scheduleGlitch) and the terminal (both its print pace
// and the ambient-chatter cadence) run even faster still — double
// BREACH_TICK_SPEEDUP on top of itself, not just matching it.
const BREACH_FAST_SPEEDUP = BREACH_TICK_SPEEDUP * 2;
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
// Where it pins — not cycling, not cooling back down — for as long as a
// netrunner intrusion is live. Set to the real warning threshold itself,
// so the reading is exactly what's already driving the alert rather than
// a separate number that happens to look alarming.
const BREACH_TEMP = TEMP_WARN;

// ---- terminal window ----
const TERMINAL_LINE_MS = 420; // pace between queued lines, ambient or take-control alike
const TERMINAL_MAX_LINES = 9; // older lines are pruned once the box is full, not scrolled

// How long an intrusion's input stays open with nobody typing the right
// command before it's treated as unresolved — shared by every intrusion
// kind below (netrunner, black ice, ...). Re-exported from each kind's
// own trigger file would be circular (those files import visionEffect
// already) — kept here since this is the side that actually owns the
// countdown, and they read it back via INTRUSION_TIMEOUT_MS to know when
// it's safe to trigger the next one.
export const INTRUSION_TIMEOUT_MS = 90_000;

// One "hostile presence" system drives every intrusion kind — same
// breach flash/CPU-MEM chaos/jitter speedup/terminal speedup regardless
// of which — only the wording (and, elsewhere, the resolving command and
// name pool) actually differs per kind. Adding a new kind means adding an
// entry here plus a BREACH_TERMINAL_LINES pool below; nothing about
// startIntrusion()/resolveIntrusion()/_failIntrusion() needs to change.
const INTRUSION_KINDS = {
  netrunner: {
    bannerLabel: 'HOSTILE NETRUNNER',
    command: 'ECCM EVICT',
    alertLine: (h) => `ENEMY NETRUNNER INTRUSION DETECTED. TO EVICT SESSION TRY 'ECCM EVICT ${h}'`,
    resolvedLine: (h) => `INTRUSION FROM ${h} EVICTED. SESSION SECURE.`,
    failedLine: (h) => `${h} CONNECTION LOST. INTRUSION UNRESOLVED.`,
  },
  blackice: {
    bannerLabel: 'BLACK ICE',
    command: 'SBIM ELIM',
    alertLine: (h) => `BLACK ICE INTRUSION DETECTED. TO ELIMINATE TRY 'SBIM ELIM ${h}'`,
    resolvedLine: (h) => `BLACK ICE ${h} ELIMINATED. SESSION SECURE.`,
    failedLine: (h) => `${h} BREACHED DEFENSES. INTRUSION UNRESOLVED.`,
  },
  // The fourth kind: type unknown at first, presented as an unauthorized
  // login alias (see unknown-intrusion.js) rather than a real handle —
  // "find user -all" lists it alongside the rest of the roster, "find
  // <alias>" pulls its actual Type/Login record. "resolvedLine" here is a
  // fallback that shouldn't normally get hit — see revealIntrusion()
  // below, which swaps this over to a real netrunner/blackice kind (with
  // its own resolvedLine) the moment the login's identified, well before
  // any eccm/sbim command could resolve it.
  unknown: {
    bannerLabel: 'UNIDENTIFIED SIGNAL',
    command: null,
    alertLine: (alias) => `UNAUTHORIZED USER DETECTED: ${alias}. RUN 'FIND USER -ALL' TO INVESTIGATE.`,
    resolvedLine: (alias) => `USER ${alias} NEUTRALIZED.`,
    failedLine: (alias) => `USER ${alias} LOST TRACE. INTRUSION UNRESOLVED.`,
  },
};

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

// Epsilon yelling straight at Mirae once an intrusion is underway — mixed
// in with AMBIENT_TERMINAL_LINES the rest of the time (see
// _scheduleAmbientTerminal's BREACH_CHANCE): the AI has one thing on its
// mind right now, on top of its usual background chatter. <HANDLE> gets
// swapped for the live intrusion's handle, same substitution as the main
// breach terminal line and the center banner. Keyed by intrusion kind
// (see INTRUSION_KINDS) since the wording references the intruder type
// by name, not just the handle.
const BREACH_TERMINAL_LINES = {
  netrunner: [
    ['MIRAE DO SOMETHING.'],
    ["LET'S GO MIRAE."],
    ['WE NEED TO EVICT THE NETRUNNER.'],
    ["ECCM EVICT <HANDLE>. C'MON"],
    ["WE CAN'T KEEP THIS TOGETHER WITH A NETRUNNER ON OUR BACK."],
    ['GET THIS DAMN NETRUNNER OFF OUR BACK! ECCM EVICT <HANDLE>.'],
  ],
  blackice: [
    ['MIRAE DO SOMETHING.'],
    ["LET'S GO MIRAE."],
    ['WE NEED TO ELIMINATE THE BLACK ICE.'],
    ["SBIM ELIM <HANDLE>. C'MON"],
    ["WE CAN'T KEEP THIS TOGETHER WITH BLACK ICE ON OUR BACK."],
    ['GET THIS DAMN ICE OFF OUR BACK! SBIM ELIM <HANDLE>.'],
  ],
  // <HANDLE> is the login alias here (e.g. "MCG"), not the real
  // identity underneath it — Epsilon doesn't know who this actually is
  // yet either, just that <HANDLE> shouldn't be on the user list.
  unknown: [
    ['MIRAE WE HAVE AN UNAUTHORIZED USER.'],
    ['CHECK THE USER LIST, MIRAE.'],
    ["WE CAN'T RESPOND UNTIL WE KNOW WHO THIS IS."],
    ['<HANDLE> IS NOT ON THE ROSTER. FIND OUT WHO THEY ARE.'],
    ["THIS ALIAS WON'T HOLD FOREVER, MIRAE."],
    ['PULL THEIR RECORD NOW! FIND USER -ALL.'],
  ],
};

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

// ---- Terminal command registry: the growing list of recognized keywords
// (eccm, sbim, find, sendmc, ...) live wherever their behavior actually
// belongs — netrunner-intrusion.js registers "eccm" since evicting only
// means anything alongside its own intrusion state, terminal-commands.js
// registers the rest — rather than vision-effect.js hardcoding every
// command itself. This file only owns matching a typed keyword to its
// handler and the fallback when nothing matches; see
// VisionEffect#_submitTerminalInput below. A handler receives (args, raw)
// — args is the whitespace-split tail after the keyword, raw is the whole
// typed line — and is responsible for printing its own response via
// VisionEffect#printTerminalLine. ----
const terminalCommands = new Map();

export function registerTerminalCommand(keyword, handler) {
  terminalCommands.set(keyword.toLowerCase(), handler);
}

export class VisionEffect {
  constructor() {
    this.el = null;
    this._canvasEl = null;
    this._safeEl = null;
    this._hudEl = null;
    this._counterEl = null;
    this._breachBannerEl = null;
    this._chipEls = null;
    this._cpuFillEl = null;
    this._cpuValEl = null;
    this._cpuEl = null;
    this._memFillEl = null;
    this._memValEl = null;
    this._memEl = null;
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
    this._memTimer = null;
    this._glitchTimer = null;
    this._scrambleTimer = null;
    this._thermalTimer = null;
    this._thermalState = 'idle';
    this._thermalTarget = TEMP_BASE;
    this._temp = TEMP_BASE;

    this._terminalStackEl = null;
    this._terminalEl = null;
    this._terminalLinesEl = null;
    this._terminalResultEl = null;
    this._terminalTimer = null;
    this._terminalQueue = [];
    this._terminalInputRowEl = null;
    this._terminalInputEl = null;
    this._intrusionHandle = null;
    this._intrusionKind = null;
    this._intrusionTimer = null;
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

  /**
   * `skipBoot` — for main.js's "Restart Vision (Skip Animation)" button:
   * a GM restarting the HUD to clear up some local glitch shouldn't have
   * to sit through the cinematic pre-roll every single time. Jumps
   * straight to _revealHud() instead of playing _playBootSequence() at
   * all; every other mount() caller (main.js's own ready/updateSetting
   * hooks) leaves this at its default and gets the normal boot.
   */
  mount({ skipBoot = false } = {}) {
    if (this.el) return;

    this._canvasEl = canvas.app.view;

    this.el = this._buildDom();
    document.body.appendChild(this.el);
    this._layout();

    this._onResize = () => this._layout();
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = new ResizeObserver(() => this._layout());
    this._resizeObserver.observe(this._canvasEl);

    if (skipBoot) {
      this._revealHud();
      return;
    }

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
    this._startMemIdle();
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
    this._stopMemIdle();
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
    if (this._intrusionTimer) clearTimeout(this._intrusionTimer);
    this._intrusionTimer = null;
    // Abrupt teardown mid-intrusion/mid-boot (mode toggled off) wouldn't
    // otherwise fire these — normal completion already does (see
    // _endIntrusion() and _playBootSequence()'s own resolve path), so
    // these only actually fire here for the "cut short" case. Without
    // them, overlay.js's outline flicker and chrome-effects.js's
    // sidebar/nav blur would both be stuck on with nothing left running
    // to ever turn them back off.
    if (this._intrusionHandle) Hooks.callAll(`${MODULE_ID}.intrusionEnd`);
    if (this._bootActive) Hooks.callAll(`${MODULE_ID}.bootEnd`);
    this._intrusionHandle = null;
    this._intrusionKind = null;
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

        <div class="cpr-twins-ai-cpu-mem-row" data-cpu-mem-row>
          <div class="cpr-twins-ai-cpu" data-cpu>
            <span class="cpr-twins-ai-cpu-label">CPU</span>
            <div class="cpr-twins-ai-cpu-track">
              <div class="cpr-twins-ai-cpu-fill" data-cpu-fill>
                <div class="cpr-twins-ai-cpu-fill-gradient"></div>
              </div>
            </div>
            <span class="cpr-twins-ai-cpu-val" data-cpu-val>4%</span>
          </div>

          <div class="cpr-twins-ai-mem" data-mem>
            <span class="cpr-twins-ai-mem-label">MEM</span>
            <div class="cpr-twins-ai-mem-track">
              <div class="cpr-twins-ai-mem-fill" data-mem-fill>
                <div class="cpr-twins-ai-mem-fill-gradient"></div>
              </div>
            </div>
            <span class="cpr-twins-ai-mem-val" data-mem-val>4%</span>
          </div>
        </div>

        <div class="cpr-twins-ai-terminal-stack" data-terminal-stack>
          <div class="cpr-twins-ai-terminal" data-terminal-root>
            <div class="cpr-twins-ai-terminal-lines" data-terminal></div>
          </div>
          <div class="cpr-twins-ai-terminal-result" data-terminal-result></div>
          <div class="cpr-twins-ai-terminal-input-row" data-terminal-input-row>
            <span class="cpr-twins-ai-terminal-input-prompt">&gt;</span>
            <input type="text" class="cpr-twins-ai-terminal-input" data-terminal-input
              autocomplete="off" spellcheck="false">
          </div>
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

        <div class="cpr-twins-ai-command-ref">
          <span class="cpr-twins-ai-command-ref-item">eccm evict &lt;username&gt;</span>
          <span class="cpr-twins-ai-command-ref-item">eccm flush cache</span>
          <span class="cpr-twins-ai-command-ref-item">sbim elim -all</span>
          <span class="cpr-twins-ai-command-ref-item">find user -all</span>
          <span class="cpr-twins-ai-command-ref-item">find &lt;string&gt;</span>
          <span class="cpr-twins-ai-command-ref-item">sendmc &lt;message&gt;</span>
        </div>

        <div class="cpr-twins-ai-watermark">ADVANCED TELEMETRY DATA VIA NEARBY CAMERA FEEDS, WIRELESS DEVICES, AND SENSORS</div>
      </div>
      </div>
      <div class="cpr-twins-ai-vhs-line"></div>

      <div class="cpr-twins-ai-breach-flash"></div>
      <div class="cpr-twins-ai-breach-banner" data-breach-banner></div>

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
    this._breachBannerEl = root.querySelector('[data-breach-banner]');
    this._terminalStackEl = root.querySelector('[data-terminal-stack]');
    this._terminalEl = root.querySelector('[data-terminal-root]');
    this._terminalLinesEl = root.querySelector('[data-terminal]');
    this._terminalResultEl = root.querySelector('[data-terminal-result]');
    this._terminalInputRowEl = root.querySelector('[data-terminal-input-row]');
    this._terminalInputEl = root.querySelector('[data-terminal-input]');
    this._terminalInputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this._submitTerminalInput();
    });
    this._targetsEl = root.querySelector('.cpr-twins-ai-targets');
    this._chipEls = root.querySelectorAll('.cpr-twins-ai-chip');
    this._cpuEl = root.querySelector('[data-cpu]');
    this._cpuFillEl = root.querySelector('[data-cpu-fill]');
    this._cpuValEl = root.querySelector('[data-cpu-val]');
    this._memEl = root.querySelector('[data-mem]');
    this._memFillEl = root.querySelector('[data-mem-fill]');
    this._memValEl = root.querySelector('[data-mem-val]');
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
    // chrome-effects.js listens for this to start the same sidebar/nav
    // blur the netrunner intrusion uses — the escalating shake/popup
    // phase is about to start below, this is where it should kick in,
    // not the whole cold-open/logo-reveal lead-up before it.
    Hooks.callAll(`${MODULE_ID}.bootMainStart`);

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

  /** Chaotic half-load-to-maxed reading used by both CPU and MEM for as long as a netrunner intrusion is active. */
  _breachLoadValue() {
    return BREACH_LOAD_LOW_PCT + Math.random() * (BREACH_LOAD_HIGH_PCT - BREACH_LOAD_LOW_PCT);
  }

  // ---- CPU meter: idle floor rises 10% per active link (so the meter
  // itself telegraphs "5 is the ceiling" — a full board rests near 52%,
  // and a spike off that lands close to max), with a +40%-over-floor
  // spike held briefly on every hijack before easing back down. Swings
  // wildly between BREACH_LOAD_LOW_PCT and _HIGH_PCT instead of any of
  // that, at BREACH_TICK_SPEEDUP times the normal tick rate, for as long
  // as a netrunner intrusion is live — see _breachLoadValue(). Self-
  // rescheduling (setTimeout, not setInterval) so that speedup can kick in
  // and drop away immediately rather than waiting for a fixed interval to
  // be torn down and rebuilt. ----

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
    const tick = () => {
      if (!this._cpuSpiking) {
        this._setCpu(this.intruding ? this._breachLoadValue() : this._cpuFloor() + Math.random() * 6);
      }
      const delay = 450 + Math.random() * 250;
      this._cpuTimer = window.setTimeout(tick, this.intruding ? delay / BREACH_TICK_SPEEDUP : delay);
    };
    this._cpuTimer = window.setTimeout(tick, 450 + Math.random() * 250);
  }

  _stopCpuIdle() {
    if (this._cpuTimer) clearTimeout(this._cpuTimer);
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

  // ---- MEM meter: same shape as the CPU one right next to it, but its own
  // independent idle reading — memory pressure isn't driven by how many
  // links are active the way CPU load is, just a gentle low-level drift.
  // Swings wildly at BREACH_TICK_SPEEDUP times the normal rate during a
  // netrunner intrusion exactly like CPU does. ----

  _setMem(pct) {
    const clamped = Math.max(0, Math.min(pct, 100));
    this._memFillEl.style.height = `${clamped}%`;
    this._memValEl.textContent = `${Math.round(clamped)}%`;
    this._memEl?.classList.toggle('cpr-twins-ai-mem--critical', clamped >= CPU_CRITICAL_PCT);
  }

  _startMemIdle() {
    this._setMem(18);
    if (reduceMotion()) return;
    const tick = () => {
      this._setMem(this.intruding ? this._breachLoadValue() : 14 + Math.random() * 12);
      const delay = 500 + Math.random() * 300;
      this._memTimer = window.setTimeout(tick, this.intruding ? delay / BREACH_TICK_SPEEDUP : delay);
    };
    this._memTimer = window.setTimeout(tick, 500 + Math.random() * 300);
  }

  _stopMemIdle() {
    if (this._memTimer) clearTimeout(this._memTimer);
    this._memTimer = null;
  }

  // ---- BIO TEMP: idles near 37.0°C, occasionally climbs, and the moment
  // it crosses TEMP_WARN mid-climb the AI visibly throttles itself back
  // down to baseline before the cycle is free to fire again — not on a
  // fixed timer, so it won't feel metronomic across a session. ----

  _setTemp(v, { forceWarm = false } = {}) {
    this._temp = v;
    if (this._thermalValEl) this._thermalValEl.textContent = `${v.toFixed(1)}°C`;
    const pct = Math.max(0, Math.min(100, ((v - 36.4) / (TEMP_BAR_MAX - 36.4)) * 100));
    if (this._thermalBarEl) this._thermalBarEl.style.width = `${pct}%`;
    this._thermalEl?.classList.toggle('cpr-twins-ai-vital--warm', forceWarm || v >= TEMP_WARN);
  }

  _thermalTick() {
    // Pinned for as long as the intrusion is live — the state machine
    // below just doesn't run at all while this is true, so whatever state
    // it was mid-cycle in when the breach started is exactly where it
    // resumes once _endIntrusion() lets this fall through again.
    if (this.intruding) {
      this._setTemp(BREACH_TEMP, { forceWarm: true });
      this._thermalWarningEl?.classList.add('show');
      return;
    }
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
    // Self-rescheduling instead of a plain setInterval so the cadence can
    // change on the fly: a netrunner intrusion runs this at
    // BREACH_TICK_SPEEDUP times the rate (dividing the delay) for as long
    // as this.intruding stays true, no separate start/stop swap needed
    // when a breach begins or ends.
    const tick = () => {
      let v = min + Math.random() * (max - min) * 0.55;
      if (Math.random() < spikeChance) v = max * (0.75 + Math.random() * 0.25);
      samples.shift();
      samples.push(v);
      draw();
      valEl.textContent = `${v.toFixed(decimals)} ${unit}`;
      if (reduceMotion()) return;
      const delay = (260 + Math.random() * 120) / (this.intruding ? BREACH_TICK_SPEEDUP : 1);
      timer = window.setTimeout(tick, delay);
    };
    return {
      start: () => tick(),
      stop: () => { if (timer) clearTimeout(timer); timer = null; },
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
    // BREACH_FAST_SPEEDUP (faster than CPU/MEM/the CGM graphs' own
    // BREACH_TICK_SPEEDUP) applied to the gap between bursts — the shake
    // itself is also stronger during a breach, see cprTaHudJitterBreach in
    // twins-ai.css. Recomputed on every fire() so a breach starting or
    // ending mid-cycle takes effect on the very next burst, same
    // one-tick-of-lag tradeoff as everywhere else this pattern's used.
    const fire = () => {
      const baseDelay = 3200 + Math.random() * 4800;
      const delay = this.intruding ? baseDelay / BREACH_FAST_SPEEDUP : baseDelay;
      this._glitchTimer = window.setTimeout(() => {
        this._pulseGlitch();
        fire();
      }, delay);
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

  /**
   * `urgent` unshifts instead of pushing — used for netrunner-intrusion
   * alerts, so a red warning plays next rather than waiting behind
   * whatever ambient chatter (or a take-control script) is already queued.
   * It doesn't clear the rest of the queue, just cuts the line.
   */
  _terminalEnqueue(lines, { action = false, danger = false, urgent = false } = {}) {
    if (!this._terminalLinesEl) return;
    const entries = lines.map((text) => ({ text, action, danger }));
    if (urgent) this._terminalQueue.unshift(...entries);
    else this._terminalQueue.push(...entries);
    this._terminalPump();
  }

  _terminalPump() {
    if (this._terminalTimer || !this._terminalLinesEl) return;
    const line = this._terminalQueue.shift();
    if (!line) return;

    const row = document.createElement('div');
    row.className = `cpr-twins-ai-terminal-line${line.action ? ' cpr-twins-ai-terminal-line--action' : ''}${line.danger ? ' cpr-twins-ai-terminal-line--danger' : ''}`;
    row.textContent = `> ${line.text}`;
    this._terminalLinesEl.appendChild(row);
    while (this._terminalLinesEl.children.length > TERMINAL_MAX_LINES) {
      this._terminalLinesEl.removeChild(this._terminalLinesEl.firstChild);
    }

    // Prints (and the ambient chatter feeding it — see
    // _scheduleAmbientTerminal) at BREACH_FAST_SPEEDUP times the normal
    // pace for as long as an intrusion's live — the log itself should feel
    // like it's scrolling faster under the strain, faster even than
    // CPU/MEM/the graphs.
    const delay = this.intruding ? TERMINAL_LINE_MS / BREACH_FAST_SPEEDUP : TERMINAL_LINE_MS;
    this._terminalTimer = window.setTimeout(() => {
      this._terminalTimer = null;
      this._terminalPump();
    }, delay);
  }

  // ---- Intrusions: the "hostile presence" event family — netrunner was
  // the first entry, black ice the second, more meant to follow (see
  // INTRUSION_KINDS up top for what actually varies per kind). When and
  // whether one happens, and keeping every client in sync about it, is
  // each kind's own trigger file's job (netrunner-intrusion.js,
  // blackice-intrusion.js); this is just the terminal-side presentation,
  // plus validating a typed attempt locally — a wrong guess is only this
  // client's business, so it doesn't need to round-trip anywhere, only a
  // genuine solve does (see _submitTerminalInput). The input row itself
  // isn't intrusion-only — it's live the whole time the HUD is up (see
  // _submitTerminalInput), an intrusion just gives it something real to
  // check typed input against. ----

  /** True while this client has an unresolved intrusion showing. Guards against a second start() landing on top of an already-active one. */
  get intruding() {
    return !!this._intrusionHandle;
  }

  /** The active intrusion's handle (e.g. "GHOSTWIRE"), or null — what each kind's own terminal-command handler checks a typed target against. */
  get intrusionHandle() {
    return this._intrusionHandle;
  }

  /** The active intrusion's kind ("netrunner", "blackice", ...), or null. */
  get intrusionKind() {
    return this._intrusionKind;
  }

  /** Public print for terminal-command handlers registered elsewhere (see registerTerminalCommand above) — same urgent/styled line any built-in response uses. */
  printTerminalLine(text, opts = {}) {
    this.printTerminalLines([text], opts);
  }

  /**
   * Same as printTerminalLine, for a whole block that has to print as one
   * unit in order — e.g. unknown-intrusion.js's user listing or its
   * User/Type/Login reveal. Matters because `urgent` unshifts to the
   * front of the queue: calling printTerminalLine several times in a row
   * for what's meant to be one ordered block would print it backwards
   * (each call's single line jumps ahead of the previous call's), since
   * every call is its own separate unshift.
   */
  printTerminalLines(lines, { danger = false, action = false } = {}) {
    this._terminalEnqueue(lines, { danger, action, urgent: true });
    this._setTerminalResult(lines, { danger, action });
  }

  /**
   * Mirrors a command's response into a second, non-scrolling readout
   * pinned between the log and the input row — the scrolling log alone
   * wasn't enough to actually read a multi-line result like "find user
   * -all"'s roster or the unknown-intrusion reveal: ambient chatter (and,
   * during a breach, everything running at BREACH_FAST_SPEEDUP) pushes
   * TERMINAL_MAX_LINES-worth of history past in a couple of seconds. This
   * doesn't scroll or prune — it just holds whatever the last command
   * said until the next one overwrites it, so there's always somewhere to
   * actually read the answer regardless of how fast the log itself is
   * moving. Deliberately only reachable through printTerminalLine(s) —
   * ambient chatter and Epsilon's yelling go through _terminalEnqueue
   * directly and never touch this, so idle background noise can't bump a
   * real answer off it.
   */
  _setTerminalResult(lines, { danger = false, action = false } = {}) {
    if (!this._terminalResultEl) return;
    this._terminalResultEl.innerHTML = '';
    for (const text of lines) {
      const row = document.createElement('div');
      row.className = `cpr-twins-ai-terminal-line${action ? ' cpr-twins-ai-terminal-line--action' : ''}${danger ? ' cpr-twins-ai-terminal-line--danger' : ''}`;
      row.textContent = `> ${text}`;
      this._terminalResultEl.appendChild(row);
    }
    this._terminalResultEl.classList.add('show');
  }

  /** `kind` must be a key in INTRUSION_KINDS (defaults to "netrunner" for the original caller/tests that predate the second kind). */
  startIntrusion(handle, kind = 'netrunner') {
    if (!this.el || this._bootActive || this._intrusionHandle) return;
    const info = INTRUSION_KINDS[kind] ?? INTRUSION_KINDS.netrunner;
    this._intrusionHandle = handle;
    this._intrusionKind = kind;
    this._terminalStackEl?.classList.add('cpr-twins-ai-terminal--intrusion');
    // The whole-screen red flash + center SECURITY BREACH banner (see
    // twins-ai.css) — deliberately louder than the terminal's own red
    // line, since this needs to grab the whole table's attention, not
    // just whoever's already looking at the terminal box.
    this.el.classList.add('cpr-twins-ai-vision--breach');
    // CPU/MEM/BIO TEMP jump to their pegged breach readings immediately
    // instead of waiting on their own idle timers to happen to tick next —
    // this should read as instantaneous, the moment the breach starts, not
    // a gradual climb. Their timers keep running and re-peg the same way
    // on every subsequent tick for as long as this.intruding stays true.
    // (No need to also toggle --spiking here: a 96-100% reading is always
    // above CPU_CRITICAL_PCT, and --critical's red styling already wins
    // over --spiking's green one on every property they share.)
    this._setCpu(this._breachLoadValue());
    this._setMem(this._breachLoadValue());
    this._setTemp(BREACH_TEMP, { forceWarm: true });
    this._thermalWarningEl?.classList.add('show');
    // Also fire a glitch burst (shake/flash/scrambled readout) right now
    // instead of waiting on whatever's left of _scheduleGlitch()'s current
    // gap, which could still have several seconds left on it — the
    // connection struggling to hold together should read as instantaneous
    // the moment the breach starts, same as CPU/MEM/BIO TEMP above.
    // _scheduleGlitch() itself already checks this before ever calling
    // _pulseGlitch(), so this direct call needs its own guard too.
    if (!reduceMotion()) this._pulseGlitch();
    // The handle goes in the banner too, not just the terminal line —
    // whoever's watching the screen instead of the terminal box still
    // needs to know who to evict/eliminate.
    if (this._breachBannerEl) {
      this._breachBannerEl.textContent = `SECURITY BREACH: ${info.bannerLabel} ${handle.toUpperCase()}`;
    }
    this._terminalEnqueue([info.alertLine(handle.toUpperCase())], { danger: true, urgent: true });
    this._intrusionTimer = window.setTimeout(() => this._failIntrusion(), INTRUSION_TIMEOUT_MS);
    // overlay.js listens for this to start the token outlines' own erratic
    // flicker — the same "connection struggling" read, extended to the
    // one part of the screen this file doesn't own.
    Hooks.callAll(`${MODULE_ID}.intrusionStart`, handle, kind);
  }

  /**
   * Called once unknown-intrusion.js's table-wide reveal broadcast lands
   * (see its own tryHandleFind()) — swaps a running "unknown" intrusion
   * over to its real kind+handle in place, without interrupting the timer
   * or any breach visual already running (CPU/MEM, jitter, the chrome
   * blur — none of that is kind-specific, so none of it needs restarting).
   * From this point on eccm/sbim's own existing kind-gated resolution
   * logic just works unmodified, since this._intrusionKind now holds a
   * real kind instead of "unknown". Only updates the banner — the actual
   * User/Type/Login reveal is printed by unknown-intrusion.js itself
   * (it's the one that knows the alias and the record's wording), right
   * alongside this call.
   */
  revealIntrusion(realHandle, realKind) {
    if (this._intrusionKind !== 'unknown') return;
    const info = INTRUSION_KINDS[realKind] ?? INTRUSION_KINDS.netrunner;
    this._intrusionHandle = realHandle;
    this._intrusionKind = realKind;
    if (this._breachBannerEl) {
      this._breachBannerEl.textContent = `SECURITY BREACH: ${info.bannerLabel} ${realHandle.toUpperCase()}`;
    }
  }

  /** Called once the table-wide resolve broadcast lands — including on whichever client actually solved it, so there's exactly one code path that clears the alert. */
  resolveIntrusion() {
    if (!this._intrusionHandle) return;
    const handle = this._intrusionHandle;
    const info = INTRUSION_KINDS[this._intrusionKind] ?? INTRUSION_KINDS.netrunner;
    this._endIntrusion();
    this._terminalEnqueue([info.resolvedLine(handle.toUpperCase())], { action: true, urgent: true });
  }

  _failIntrusion() {
    if (!this._intrusionHandle) return;
    const handle = this._intrusionHandle;
    const info = INTRUSION_KINDS[this._intrusionKind] ?? INTRUSION_KINDS.netrunner;
    this._endIntrusion();
    this._terminalEnqueue([info.failedLine(handle.toUpperCase())], { danger: true, urgent: true });
  }

  _endIntrusion() {
    if (this._intrusionTimer) {
      clearTimeout(this._intrusionTimer);
      this._intrusionTimer = null;
    }
    this._intrusionHandle = null;
    this._intrusionKind = null;
    this._terminalStackEl?.classList.remove('cpr-twins-ai-terminal--intrusion');
    this.el?.classList.remove('cpr-twins-ai-vision--breach');
    if (this._breachBannerEl) this._breachBannerEl.textContent = '';
    // Same instant-reset treatment as startIntrusion()'s instant pin —
    // drops straight back to normal rather than waiting on the idle
    // timers' next tick or the thermal state machine's own cooldown pace.
    this._setCpu(this._cpuFloor());
    this._setMem(14 + Math.random() * 12);
    this._thermalState = 'idle';
    this._thermalWarningEl?.classList.remove('show');
    this._setTemp(TEMP_BASE);
    // Covers both resolveIntrusion() and _failIntrusion(), which both
    // route through here — the outlines' erratic flicker stops the same
    // instant everything else above does, regardless of which one ended it.
    Hooks.callAll(`${MODULE_ID}.intrusionEnd`);
  }

  /**
   * Enter in the input box — live for as long as the HUD is up, not just
   * during an intrusion. Whatever's typed always echoes into the terminal
   * log first, same as any other line (and ages out the same way once it
   * scrolls past TERMINAL_MAX_LINES) — a real terminal shows what you
   * typed whether or not it meant anything. The first word is then looked
   * up in the terminalCommands registry above: a recognized keyword's own
   * handler takes it from there (e.g. netrunner-intrusion.js's "eccm",
   * checked against whatever intrusion is currently active, if any), and
   * anything else — a typo, plain chatter, a command with no active use
   * right now — gets the same blunt response a real restricted terminal
   * would give.
   */
  _submitTerminalInput() {
    if (!this._terminalInputEl) return;
    const raw = this._terminalInputEl.value.trim();
    this._terminalInputEl.value = '';
    if (!raw) return;

    this._terminalEnqueue([raw], { urgent: true });

    const [keyword, ...args] = raw.split(/\s+/);
    const handler = terminalCommands.get(keyword.toLowerCase());
    if (!handler) {
      this.printTerminalLine('COMMAND NOT RECOGNIZED.', { danger: true });
      return;
    }
    handler(args, raw);
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
    // Same BREACH_FAST_SPEEDUP as the terminal's own print pace, applied
    // to the gap between lines — plus, while it's live, a minority of
    // lines are Epsilon yelling straight at Mirae (see BREACH_CHANCE
    // below) mixed in with the usual idle background chatter, which keeps
    // flowing the rest of the time rather than being replaced outright.
    const BREACH_CHANCE = 0.25;
    const fire = () => {
      const baseDelay = 2600 + Math.random() * 3800;
      const delay = this.intruding ? baseDelay / BREACH_FAST_SPEEDUP : baseDelay;
      this._ambientTimer = window.setTimeout(() => {
        if (this.intruding && Math.random() < BREACH_CHANCE) {
          const pool = BREACH_TERMINAL_LINES[this._intrusionKind] ?? BREACH_TERMINAL_LINES.netrunner;
          const entry = pool[Math.floor(Math.random() * pool.length)]
            .map((text) => text.replace('<HANDLE>', (this._intrusionHandle ?? '').toUpperCase()));
          this._terminalEnqueue(entry, { danger: true });
        } else {
          const entry = AMBIENT_TERMINAL_LINES[Math.floor(Math.random() * AMBIENT_TERMINAL_LINES.length)];
          this._terminalEnqueue(entry);
        }
        fire();
      }, delay);
    };
    fire();
  }

  _stopAmbientTerminal() {
    if (this._ambientTimer) clearTimeout(this._ambientTimer);
    this._ambientTimer = null;
  }

  // ---- Active Links: 5 chips, filled by how many tokens on this scene are
  // currently claimed — the last one shows locked instead while the cache
  // is corrupted (see cache-corruption.js), since effectiveMaxActiveLinks()
  // is what grantControl() is actually enforcing at that point, not the
  // raw ceiling this row is normally drawn against. ----

  refreshChips() {
    if (!this.el) return;
    const corrupted = isCacheCorrupted();
    const lockedIndex = corrupted ? this._chipEls.length - 1 : -1;
    const count = Math.min(claimedTokensOnScene().length, this._chipEls.length - (corrupted ? 1 : 0));
    this._chipEls.forEach((chip, i) => {
      chip.classList.toggle('cpr-twins-ai-chip--locked', i === lockedIndex);
      chip.classList.toggle('cpr-twins-ai-chip--filled', i !== lockedIndex && i < count);
    });
    this._targetsEl?.classList.toggle('cpr-twins-ai-targets--maxed', count >= MAX_CHIPS - (corrupted ? 1 : 0));
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
