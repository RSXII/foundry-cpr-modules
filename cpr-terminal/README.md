# CPR Terminal

Foundry v12 module. Adds a scene-control button ("FCOS Terminal") that any
connected client — GM or player — can click to open FCOS in a window inside
Foundry, instead of needing it running on a separate device.

FCOS (`../../skamterminal`) is a fake in-browser OS by S.K.AM Advanced
Magitechnologies — this module is just an iframe pointed at wherever it's
running:

```
[this module]  --iframe-->  [https://skamterminal.vercel.app  (or your configured URL)]
```

## Install

1. Copy this whole `cpr-terminal/` folder into your Foundry `Data/modules/`
   folder.
2. Launch your world, open **Manage Modules**, enable **CPR Terminal**, and
   reload if prompted.
3. Click the **FCOS Terminal** category icon (appended at the end of the
   left toolbar) to reveal its tools — **Open FCOS Terminal** opens/closes
   the window, same two clicks as any other scene-control category. Every
   connected client sees that one. GM clients also see a second tool, **Send
   Location** (see below).

## Config

**Configure Settings → Module Settings → Terminal URL** — defaults to the
public Vercel build (`https://skamterminal.vercel.app/`). Point it at a
LAN `npm run dev` address instead if you're testing unreleased changes to
FCOS — same pattern as `../fate-city-1999/foundry-module-phone`'s Wire URL
setting.

## How identity carries over

FCOS reads/writes the same Firebase project (`cpr-wire-device`) as the
`fate-city-1999` "Wire" phone app — see `skamterminal/lib/firebase.ts`. No
separate sync needed here; whatever's in that Firestore project already
shows up in the terminal.

## Send Location

GM-only tool that picks up right where the old GPS-image narration left
off, but remotely: pick a district (and optionally a location inside it)
and every connected player's terminal jumps there with a brief "en route"
flourish — no need for players to already have their terminal window open,
this pops it for them.

```
[GM clicks "Send Location", picks a destination]
        |
        v
   PUT https://cpr-wire-device-default-rtdb.firebaseio.com/nav/current.json
        |
        v
[every client's EventSource on that same path fires] --> [this module force-opens FcosTerminalApp]
                                                       --> [FCOS's own subscription opens/focuses the Map app and plays the travel animation]
```

- The destination picker fetches districts/locations straight from
  Firestore's REST API each time it opens — always matches whatever's
  actually on the map, including anything added later via FCOS's own map
  editor. No list to keep in sync here.
- The signal is a single mutable node (`nav/current`), not a queue —
  sending a new location just overwrites it. Re-sending the *same*
  destination still replays the travel animation on the FCOS side (it's
  keyed on a fresh timestamp, not the destination id).
- **It's a standing value, not a one-shot event** — every terminal that
  opens or reloads re-reads whatever's currently in `nav/current` and
  replays the travel animation, indefinitely, until something clears it.
  The dialog's **Clear Location** button (`DELETE`s the node) is that
  something — get in the habit of clearing it once the "en route" moment
  has passed, the same way `fate-city-1999`'s GM console explicitly
  deletes `incomingCall`/`timer/endsAt` once they're done being relevant,
  rather than leaving them to fire again for the next person who loads
  the page.
- The actual pan/zoom/animation lives entirely in FCOS's
  `components/apps/MapApp.tsx` — this module only knows how to force the
  terminal window open and how to write the signal; it has no idea what
  the animation looks like.
- **No auth on this channel** — same trust model the rest of this shared
  Firebase project already runs on (see Wire's own `firebase-db.js`:
  "plain unauthenticated REST"). This doesn't newly weaken anything, but
  it's worth confirming the actual Firebase console rules directly if that
  matters to you; neither this repo nor `fate-city-1999` has a rules file
  checked in.

## Known limitations (v1)

- **No two-way state sync for anything else.** Aside from the Send
  Location signal above, this just displays FCOS — it doesn't relay
  anything back into Foundry chat or actor data (unlike
  `../fate-city-1999/foundry-module`, which does that for Wire events).
- **A player mid-boot-animation won't see a sent location until it
  finishes** — FCOS's boot sequence auto-completes and skips its login
  screen on its own (see `skamterminal/components/FCOS.tsx`), so this is
  a few seconds' delay at most, not a stuck-forever case.
- **Fixed default window size** (1540×1008, resizable) — FCOS is a full
  desktop UI with its own draggable windows and taskbar, not a fixed-bezel
  phone screen like Wire, so this is a starting size rather than a hard
  frame.
