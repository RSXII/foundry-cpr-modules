# CPR Incoming Call

Foundry v12 module. Cyberpunk 2077-style call handling, driven by the
**Fate City 1999** ops console's Foundry bridge:

- A **ringing toast** (top of screen) with the caller's name and **Answer**
  / **Reject** buttons — this is the actual physical control for a call
  from inside Foundry.
- Answering swaps it to an **in-call toast** with a single **Hang Up**
  button, and opens a full **connection card** (bottom-right) — a chamfered
  data-card frame around the caller's portrait, a glitch-in burst, and a
  fake `// CONNECTION 541.44.10`-style ID readout.
- Both stay up for as long as the call is ringing or connected — neither
  auto-fades on its own. They come down on Hang Up/Reject, or if the GM
  ends the call from the ops console.

This module has no transport of its own. It depends on that project's
`fc99-bridge` module (`fate-city-1999/foundry-module`), which holds the
actual WebSocket connection to the LAN bridge service and turns incoming
events into a `ChatMessage` flagged with the event envelope:

```
[fate-city-1999 ops console]  -->  [fc99-bridge's local bridge service]  -->
[fc99-bridge, GM client]  --ChatMessage flag "fc99-bridge"-->  [this module, every client]
                                                                        |
                                          Answer/Reject/Hang Up clicked  v
                                    [this module's own ChatMessage flag "cpr-incoming-call"]
                                                                        |
                                                    every client's hook v
                                          (including the one that clicked)
```

Both the inbound leg (`call.incoming`/`call.ended`, from the ops console)
and the player-driven leg (`answered`/`declined`/`hungup`, from the ringing
toast's buttons) ride Foundry's `ChatMessage` sync rather than a raw
`game.socket` broadcast — see "Why ChatMessage, not a socket event" below.
Because of that, per-player scoping is inherited for free on both legs, no
extra plumbing needed. This module isn't part of the `fate-city-1999` repo,
so it can be developed, versioned, and installed alongside the rest of this
project's Cyberpunk RED modules instead.

## Install

1. Install and enable `fc99-bridge` first (from the separate
   `fate-city-1999` project) — this module does nothing without it, and
   Foundry will flag the dependency as missing if it isn't active.
2. Copy this `cpr-incoming-call/` folder into your Foundry `Data/modules/`
   folder, enable **CPR Incoming Call** under Manage Modules, reload.

## Use

Trigger a call from the Fate City ops console the same way you do today.
The target player (and the GM) sees the ringing toast at the top of their
screen:

- **Answer** — opens the connection card and switches the toast to a
  single Hang Up button. Anyone who could see the ringing toast (the target
  player, the GM) also sees this state change land, since the answer itself
  is a whispered chat message.
- **Reject** — dismisses the toast, no connection card ever opens.
- **Hang Up** (once answered) — dismisses both the toast and the card.
- The ops console's **End Call** button still works independently and
  dismisses whatever state the call is in (ringing or answered) on the
  Foundry side — the two controls don't need to agree on who's "supposed"
  to end it.

If the event carries a `targetCodename`, `fc99-bridge`'s existing
whisper/audience handling means only that player's client (plus the GM)
ever receives the `call.incoming`/`call.ended` chat messages — so the whole
flow is scoped for free, no extra work in this module.

## Config

**Configure Settings → Module Settings → Auto Hang Up After (ms)** —
optional safety net: automatically hangs up a *connected* call after this
long, in case a hang-up signal never arrives. Default `0` (disabled) — a
call is meant to stay connected until a real Hang Up, Reject, or the ops
console's End Call.

## Why ChatMessage, not a socket event

The player-driven leg (`sendAction()` in `main.js`) creates a whispered
`ChatMessage` flagged with the action, exactly the way `fc99-bridge` already
relays ops-console events, rather than a raw `game.socket.emit()`
broadcast. `fc99-bridge`'s own README documents why: a self-hosted Foundry
server tested during that project's development wasn't reliably relaying
custom module-namespaced socket events between clients at all, even though
Foundry's own core document-sync traffic worked fine. Riding the same chat
pipeline sidesteps that — this module just reuses the lesson rather than
re-learning it. The message whispers to `[game.user.id]` (the clicking
player, i.e. themselves) rather than a public message, but Foundry always
shows whispers to GMs regardless of the whisper list, so the GM's client
still reacts to it.

One consequence: the button click handlers never touch the DOM directly —
they only ever create that ChatMessage. The `createChatMessage` hook is the
single place that actually shows/hides anything, for every client
including the one that clicked, so a local click and a remote one drive
identical code.

## Design notes

- **Color**: the ringing toast and card both reuse the red `fc99-bridge`'s
  own (now-removed, see below) call toast established, rather than
  introducing a new hue for the same event type. The in-call toast's
  eyebrow switches to a soft green once answered, as the one deliberate
  departure — "call connected" reading as a distinct, calmer state from
  "still ringing."
- **Connection ID**: the `541.44.10`-style readout is generated
  deterministically from `callerName` (a hash, not random-per-call), so the
  same caller always shows the same ID rather than re-rolling every time.
- **Card size is fixed** (260×360), not viewport-tracking — this is a
  discrete widget, so a plain CSS `clip-path` plus a matching inline SVG
  border is enough; no runtime geometry recompute needed. Its *position*
  does track the window: `positionCard()` in `call-card.js` measures
  Foundry's actual `#sidebar` and `#hotbar` elements (falling back to flat
  guesses if either isn't found) so the card clears them regardless of
  sidebar width or window size, and re-measures on resize while showing.
- **Three files, one state machine**: `call-card.js` and `ringing-toast.js`
  are pure show/hide presentation with no hooks or state of their own;
  `main.js` owns the actual `idle -> ringing -> in-call -> idle` state
  machine and is the only place that decides when either one renders.

## Changes made in `fate-city-1999`

Three small, targeted edits, made with the project owner's go-ahead:

- `src/routes/ops-7e4f/+page.svelte` — `endActiveCall()` now also calls
  `notifyBridge('call.ended', { targetCodename })`, alongside its existing
  `dbDelete('incomingCall')` (which only ever cleared the call off the
  *player's phone*, not the table).
- `foundry-module/scripts/bridge.js` — added a `call.ended` entry to
  `AUDIENCE` (same `targetCodename` whisper-scoping as `call.incoming`) and
  a `FORMATTERS` entry so it logs a sensible chat line instead of falling
  through to the generic JSON-dump format.
- `foundry-module/scripts/bridge.js` — **removed** the `call.incoming`
  entry from `VISUAL_HANDLERS` (its small top-of-screen toast). This
  module's own ringing toast now owns that presentation, and it's
  genuinely interactive (Answer/Reject) where the old one was purely
  decorative — leaving both would have stacked a second, dead toast on top
  of the real one for the same event.

## Known gaps (v1)

- **The ops console doesn't learn about Answer/Reject/Hang Up.** The bridge
  is one-directional (ops console -> bridge service -> Foundry GM client);
  there's no channel back out. The ops console's own "active call" state
  only ever reflects what it triggered/ended itself, not whether a player
  actually answered on the Foundry side. Building that reverse channel
  would mean the bridge service holding a connection back to the ops
  console too (it currently only accepts one-way HTTP POSTs) — a real
  transport change in `fate-city-1999`, not attempted here.
- **No ringtone.** `sounds/ringtone.mp3` is referenced by the mobile app's
  own layout but doesn't actually exist in that repo yet, so there was
  nothing to reuse for an audio cue here.
- **No ring timeout / "missed call."** A ringing call stays ringing
  indefinitely if nobody clicks Answer or Reject and the GM doesn't end it
  from the console — there's no auto-decline after N seconds the way a real
  phone would. Not requested; would be a small addition to `main.js`'s
  `goRinging()` if wanted later.
- **Portrait glitch is a fixed one-shot burst**, not reactive to signal
  quality/connection state — there's no such state in the payload today
  (`call.incoming` only carries `callerName`/`callerSubtitle`/
  `callerAvatarUrl`/`callerColor`/`targetCodename`).
- **State doesn't survive a client reload mid-call.** Like `fc99-bridge`'s
  own toast/timer, this only reacts to *new* `createChatMessage` events —
  a client that reloads while a call is ringing or connected won't
  reconstruct that state from chat history, it'll just show nothing until
  the next event.
