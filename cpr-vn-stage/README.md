# CPR VN Stage

Foundry v12 module. Visual-novel style character stands, built from an
interactive HTML mockup iterated on first (see "Design notes" below) before
any of this code existed.

- Right-click an actor in the sidebar -> **Add to Scene (VN)** puts them on
  a small floating **dock** (GM only).
- Clicking their dock avatar **previews** their default stand — visible
  only to the GM, with a dashed yellow ring and an on-stage "Preview —
  players can't see this" flag.
- A separate **broadcast** icon on the dock is the deliberate second step
  that actually pushes the stand **live** for players. Taking it offline
  again drops back to GM-only preview rather than removing it outright.
- While on stage, a floating expression button above each stand (GM only)
  opens a picker to swap expressions — live changes mid-broadcast too.
- A name tag under the art is independently toggleable, per actor, from
  either **Configure Expressions…** or by clicking the tag itself on stage.
  Hidden means hidden: players never receive the name at all, not just a
  CSS-hidden element.

## Install

Copy this `cpr-vn-stage/` folder into your Foundry `Data/modules/` folder,
enable **CPR VN Stage** under Manage Modules, reload.

## Use

1. **Configure Expressions…** (also reachable from the right-click menu, or
   the "Manage emotions →" link in the on-stage expression picker) opens the
   per-actor editor: a name-tag visibility toggle, the default stand, and
   the list of emotions.
2. Drop several PNGs onto the dropzone (or click it to browse) to add art
   in bulk. Rather than uploading and assigning one at a time, you get a
   single match screen: each image gets a guessed label from its filename,
   pre-matched to an existing emotion of the same name if one exists so you
   just confirm instead of hunting through a dropdown, and nothing is saved
   until you hit Import.
3. Right-click the actor -> **Add to Scene (VN)**, then click their dock
   avatar to preview, and the broadcast icon to go live.

## Config

No module settings panel — there's nothing here a GM would tune table-wide;
everything is per-actor, reached through Configure Expressions… and the
dock itself.

## Why three separate stores, not one

See `scripts/data.js`'s header comment for the full reasoning; in short:

- **Per-actor setup** (emotions, default stand, name-tag preference) is an
  **actor flag** — the GM's own client always has full actor access
  regardless of what a player's permission on that actor is, so this is
  never a permission problem even for NPCs the party doesn't own.
- **The GM's dock state** (who's on stage, off/previewing/live) is a
  `scope: "client"` **setting** — stored only in that browser's own
  localStorage, never sent to the server or any other client. That's what
  actually guarantees a preview can't leak to a player: the data simply
  doesn't exist anywhere outside the GM's own browser, not even in a form a
  curious player could find by poking at `game.settings` in their own
  console.
- **What's actually live** is a `scope: "world"` **setting** — a real
  `Setting` document under the hood (Foundry v10+), so it rides the same
  document-sync pipeline as a ChatMessage or Actor update. `../cpr-
  incoming-call` and `../cpr-twins-ai` both found that pipeline reliable in
  real testing, in contrast to a bare `game.socket.emit/.on()` custom
  event — this module reuses that lesson rather than re-learning it. It
  also means a player who reloads mid-scene sees the current stands
  immediately (`game.settings.get()` already has the latest value), with no
  replay-of-past-events logic needed.

## Design notes

- **Built from a mockup first.** Every piece of this — the slide-in stand,
  the frameless transparent-PNG art treatment, the dock's three states, the
  bulk-upload match screen — was designed and iterated on as a standalone
  interactive HTML/CSS/JS artifact before any Foundry code was written, per
  the project owner's request to "mock the UI first." The data model this
  module ended up with (actor flag / client setting / world setting) is new
  for the real implementation; the mockup simulated all three with one
  in-memory JS object and a fake GM/Player role switch, which was enough to
  validate and tweak the interaction design without needing Foundry at all.
- **Stand art has no frame.** `.cpr-vn-stand-art` renders the actor's
  uploaded PNG directly, no card/border/background — just a drop-shadow and
  a hue-tinted glow for grounding, so a transparent-background portrait
  reads as a cutout standing on the scene rather than a bordered photo.
- **Name tag is a toggle, not a one-way setting.** Clicking it on stage
  flips the same `showName` flag Configure Expressions… edits — either
  surface is a legitimate way to change it, and both read/write the same
  place.
- **Positioning** clears Foundry's actual `#sidebar`, `#hotbar`, and
  `#players` elements (falling back to flat guesses if any aren't found),
  the same technique `../cpr-incoming-call`'s `positionCard()` uses, rather
  than assuming fixed pixel margins.

## Known gaps (v1)

- **Not scene-scoped.** Who's on the dock and what's live is global to the
  world, not tied to Foundry's own current Scene — switching scenes
  doesn't hide or show anything. This was a deliberate simplification (not
  requested, and the mockup had no multi-scene concept either), but would
  be the first thing to add if a GM wants VN stands to clear automatically
  between locations.
- **Single-GM assumption.** The dock's `scope: "client"` setting is local
  to one browser profile — a second GM client (or the same GM on a second
  device) won't see the first GM's dock/preview state. The world-visible
  "live" stands are unaffected; this only means dock bookkeeping doesn't
  share between GM clients.
- **Not visually verified inside a running Foundry instance.** This was
  built and syntax-checked outside of Foundry (no live server available in
  that environment) — the interaction design itself was fully click-tested
  in the browser-based mockup first, but the real module's on-screen
  positioning, FilePicker upload flow, and Handlebars rendering haven't
  been confirmed against an actual Foundry v12 session yet. Load it in a
  real world and check: the dock/stand clearance above the hotbar, that
  bulk-uploaded images actually land under `Data/worlds/<world>/cpr-vn-
  stage/<actorId>/`, and that the expression popover positions correctly
  above the emote button.
