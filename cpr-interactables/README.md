# CPR Interactables

Foundry v12/v13 module. Lets a GM drop trigger zones ("hotspots") anywhere
on a scene. Once a player's token gets close enough — and has a clear line
of sight to it — a small sparkle twinkles to say "you can interact with
this," the same cue as an interactable glint in a video game. Press the
interact key and it pops open that hotspot's view — first (and currently
only) view type is an image, so the obvious use is a poster pinned to a
wall: the poster art is already part of the scene background, this module
is just the "get close, notice it, read it" loop around it.

## Install

Copy this whole `cpr-interactables/` folder into your Foundry
`Data/modules/` folder, enable **CPR Interactables** under Manage Modules,
reload.

## Placing hotspots (GM only)

A new **Interactables** control group appears in the scene controls
(left-hand toolbar), GM-only — players never see it.

- **Select / Edit Hotspots** (default tool): existing hotspots show as
  translucent cyan circles while this control group is active. Click one
  to open its config (image, caption, trigger radius, delete). Drag one to
  reposition it. Right-click one for a quick delete.
- **Place New Hotspot**: click anywhere on the map to drop a new hotspot at
  that exact point (no grid snapping — wall art rarely lines up with the
  grid) and immediately open its config. Pick an image via the file picker,
  optionally add a caption, set the trigger radius (in grid squares,
  default 0.75), toggle whether players get a sparkle marker at all, and
  Save. Closing the config without ever picking an image discards the stub
  instead of leaving a dead hotspot behind.

Hotspots are stored on the scene itself (a flag), so they travel with the
scene and sync to every connected client the normal Foundry way — no extra
setup per client.

**Two different visuals, two different audiences.** The translucent cyan
circle showing the actual trigger radius is a GM-only editing aid — only
visible while the Interactables control group is active, gone the instant a
GM is back on the Token layer running the game. The small twinkling
sparkle at the hotspot's point is the player-facing one — see "Using it"
below.

## Using it (players)

No setup needed. Walk a token within a hotspot's trigger radius **and**
have a clear line of sight to it, and two things happen together: a small
sparkle (✨) twinkles at the hotspot, and a prompt appears at the bottom of
the screen — **`[E]` Inspect *caption*** (or just **Inspect** if the
hotspot has no caption). Press the key — default `E`, rebindable per-client
under **Configure Controls → CPR Interactables → Interact** — and the image
opens in Foundry's own image viewer (zoomable, closable; the GM's copy also
gets Foundry's built-in "share with players" button).

The sparkle is deliberately tied to the exact same range-and-sight check
that gates the interact key, not a separate "this exists somewhere nearby"
hint — if you can see it twinkle, the key will do something; if you can't
see it, it wouldn't fire anyway. A GM always sees every sparkle,
everywhere, regardless of range — an editing/testing aid, same as the
GM-only trigger circles.

- Proximity is checked against whichever token(s) you currently have
  selected, falling back to your assigned character's token if you have
  none selected — the common case of "my one PC token, unselected" still
  works.
- **Walls block it.** Being within the trigger radius isn't enough by
  itself — there also has to be an unobstructed sight line from the token
  to the hotspot. A poster on an interior wall won't sparkle or fire for a
  token standing just outside the building, even if it's geometrically
  within range; a doorway or a window (sight-permeable by default) still
  lets it through.
- The prompt and the interact key both no-op when nothing is in range.
- A GM can trigger hotspots the same way (select a token, walk it up,
  press the key) — handy for testing placement without a player logged in.

## Known gaps (v1)

- **Image only.** The view type is deliberately a single seam
  (`scripts/view.js`) rather than a plugin system nobody's asked for yet —
  a future hotspot type (a journal entry, a sound sting, a short text blurb)
  is one function away, not a rewrite.
- **Circular trigger zones only**, sized by a single radius — no rectangles
  or arbitrary polygons. Fine for "near this wall," not for "this whole
  room." Matters less than it sounds like it should, since the wall check
  above already stops a circle from leaking into the next room over —
  fancier shapes would mostly buy precision within the *same* room, not fix
  a correctness problem.
- **One sparkle style for everyone.** No per-hotspot color/icon choice
  beyond the on/off toggle — every visible hotspot gets the same ✨ at the
  same size. Fine for a first pass; a distinct glyph per hotspot "type"
  (once there's more than one view type, see above) is the natural next
  step.
- **No cooldown/one-shot option** — a hotspot can be inspected as many
  times as a player wants to press the key. Nothing wrong with re-reading a
  poster.
