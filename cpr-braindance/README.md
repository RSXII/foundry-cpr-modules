# CPR Braindance

Foundry v12/v13 module. A full-screen "entering a Braindance" transition,
played from the viewer's own perspective: clamp arms swing in from the
screen edges toward you, a neural-link flash hits, and a flickering
"loading" HUD holds the screen — covering whatever the GM does next
(typically activating a different scene) — until the GM dismisses it and
it fades away.

This module only provides the overlay and the trigger plumbing to show it
on every connected client at once. It deliberately doesn't try to own the
actual scene swap — that's a GM call, paced however a given transition
needs (see "Use" below).

## Install

Copy this `cpr-braindance/` folder into your Foundry `Data/modules/`
folder, enable **CPR Braindance** under Manage Modules, reload. No other
module is required.

## Use

A new **CPR Braindance** scene-control group (GM only) has two buttons:

- **Start Braindance Transition** — broadcasts to every connected client:
  the clamp arms swing in, flash, and the screen settles into a looping
  "loading" state (strobe flashes, glitch bursts, a cycling status label)
  that holds indefinitely.
- **Dismiss Braindance Transition** — broadcasts the reverse: a flash, the
  arms retreat, the screen fades out.

Typical flow: click Start, give it a beat to play the clamp/flash, then
activate whatever scene the party's "entering" via Foundry's normal Scene
Directory controls (or a macro), then click Dismiss once it's loaded.

### Macro API

For a scripted transition, `game.modules.get('cpr-braindance').api`
exposes:

```js
const bd = game.modules.get('cpr-braindance').api;

// Manual pacing — same two actions as the scene-control buttons:
await bd.enter();
// ...your own scene-swap logic here...
await bd.exit();

// Convenience wrapper: plays the entry, runs your swap function (awaited
// alongside a minimum hold so a fast scene load doesn't cut the clamp/
// flash short), then plays the exit.
await bd.playTransition(async () => {
  await game.scenes.get('sceneIdHere').activate();
}, { minHoldMs: 1500 });
```

`playTransition`'s `minHoldMs` (default `1200`) is a floor, not a fixed
length — if the swap function takes longer, the exit waits for it instead
of cutting it off.

## Design notes

- **POV, not third-person.** The reference art (a Braindance wreath's
  hinged arms closing in around the wearer's temples/eyes) is reproduced
  from the viewer's own perspective — the arms swing in from the two
  screen edges toward the center, as if they're closing in on you, rather
  than showing a character wearing the device.
- **Broadcast rides a world Setting, not a raw socket event.**
  `../cpr-twins-ai/scripts/socket.js` documents why: a real self-hosted
  Foundry server tested during that project's development wasn't reliably
  relaying custom module-namespaced `game.socket` events between clients
  at all, even though Foundry's own core document/setting sync worked
  fine over the same connection. This module's trigger is a world-scoped
  Setting (`cpr-braindance.trigger`, `{nonce, phase}`) that every client
  reacts to via `updateSetting` — the same sync path `cpr-twins-ai`'s own
  `modeEnabled`/`cacheCorrupted` settings already lean on, just used as a
  one-shot signal (a bumped `nonce`) instead of a persisted mode.
- **Two state classes drive the whole animation** (`overlay.js`,
  `braindance.css`): `.cpr-bd-visible` (the root fade, black in/out) and
  `.cpr-bd-armed` (arms swung in + clamped, HUD/vignette/scanlines
  showing). Removing `.cpr-bd-armed` for the exit runs every one of those
  CSS transitions in reverse — there's no separate hand-authored
  "retreat" state to keep in sync with the entry.
- **The hold phase has no fixed length.** The strobe/glitch timers are
  self-rescheduling (`setTimeout`, not a fixed-duration CSS animation) and
  keep looping for however long it takes the GM to actually swap the
  scene — they only stop when `exit` is broadcast. This is deliberate: a
  scene's load time isn't predictable enough to hard-code a single
  animation length and hope it lines up.
- **Covers the whole window, not just the canvas safe area.** Unlike
  `cpr-twins-ai`'s persistent HUD (which insets itself away from Foundry's
  own sidebar/hotbar/nav so it can coexist with using the rest of the UI),
  this is a momentary full takeover — closer to a loading screen than a
  HUD — so it sits at `position: fixed; inset: 0` over everything,
  including Foundry's own chrome.
- **`prefers-reduced-motion`**: the arm swing/retreat collapses to a 1ms
  snap, the continuous scanline sweep and ring spin stop, and the JS side
  never schedules the strobe/glitch bursts at all under this preference —
  same fallback pattern `cpr-twins-ai`'s boot sequence and
  `cpr-incoming-call`'s glitch-in burst both use.

## Known gaps (v1)

- **No sound.** Purely visual; pairing a stinger/whoosh with Start and a
  release cue with Dismiss would be a natural follow-up, nothing wired up
  here yet.
- **No per-player targeting.** `enter`/`exit` always broadcast to every
  connected client — there's no way to show it only to the player whose
  character is actually jacking in while leaving everyone else's screen
  alone. Given a Foundry scene change is itself shared across every
  connected client, this matches the actual use case (the whole table's
  view is about to change together), but it does mean there's no "solo"
  mode if that's ever wanted.
- **A client that reloads mid-transition won't rejoin it.** Same
  known limitation as `cpr-incoming-call`'s call state: the `updateSetting`
  hook only reacts to a *new* trigger, not whatever the current phase
  happens to be — a client that connects or reloads while the overlay is
  up on everyone else just doesn't see it until the next `enter`/`exit`.
