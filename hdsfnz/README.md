# HDSFNZ Scene HUD

Foundry v12 module. Skins a scene for playing an episode of **Hyper Demon
Strike Force Negative Zero: Rise of the Last Apocalypse Vanguards** — the
in-fiction, over-the-top 90s-anime side-game FC99 players occasionally drop
into via brain-dance tech. Adds a minimal `hdsfnz.character` actor type
(class, HP/EP/STAM/AMMO, equipment) and a full-screen retro console-RPG HUD
overlay, built from `hdsfnz-hud-mockup.html` and `hdsfnz-foundry-handoff.md`.

This is deliberately not a full game system — see the handoff doc's
"low-crunch" design intent. No dice mechanics, no character-creation
wizard, no Affinity/relationship layer. Just enough state for the HUD to
read something real.

## Install

Copy this `hdsfnz/` folder into your Foundry `Data/modules/` folder, enable
**HDSFNZ Scene HUD** under Manage Modules, reload.

## Use

**Create a unit:** create a new Actor, choose type **character** (this
module's, not the system's), set its class, HP/EP/STAM/AMMO, portrait, and
add gear (Main/Sub slots) from its sheet. The **SPESHAL** slider is
intentionally unexplained — see Genre Laws in the handoff doc; don't give it
a meaning.

**Show the HUD:** GM-only scene-control toggle (a TV icon group) — "Show the
HDSFNZ HUD on this scene." It's a scene flag, so it applies to everyone
viewing that scene and persists with it; toggle it off when the episode
ends. The HUD overlays the actual canvas viewport (between the scene-
control rail and the sidebar) — chat, dice rolling, and token
selection/panning underneath all keep working normally, since nothing in
the HUD is clickable yet.

**Who the HUD shows:** each player sees their own `hdsfnz.character` actor
(first one they own). The GM sees whichever token they have controlled or
targeted, if it's an HDSFNZ unit, else the first one that exists in the
world — useful for previewing before assigning tokens.

**Dialogue box:** shows the most recent chat message in the world (speaker
+ text, HTML stripped, capped ~200 characters). Not scoped to the current
scene or to in-character messages specifically — it's just "the last thing
said," reusing Foundry's existing chat log instead of a custom narration
flag.

## What's decorative / not wired up yet

Per the handoff doc, these were deliberately left static for this build:

- **Left-rail nav** (MAP/ITEM/EQUIP/STATUS/DATA/SYSTEM) — visual only, no
  click handlers.
- **Minimap** — static grid/compass, doesn't reflect real token positions.
- **Date/time/mission block** — not in the mockup's final cut for this
  build; the right rail's lower block instead shows the viewed unit's class
  + motto.

Natural next steps if this side-game gets more play: a MAP nav item that
opens Foundry's scene navigation, a real minimap, character-creation
flow ("build a look, pick a class"), and the home-base Affinity/relationship
layer (Genre Laws 2 & 3) — none of that is started here.
