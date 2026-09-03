# CPR Relations

Foundry v12 module. Tracks per-PC relationship values and faction tags on
NPC and PC actors, and adds a **Personal File** window — a compact,
JRPG-roster-style card, not a rebuild of the full CPR sheet. Named
deliberately generic rather than "Relationship Tracker" — relationships are
the first thing it tracks, not necessarily the last.

Pairs with `../foundry-vtt-cpr-theme` for the actual visual skin (this
module reads that module's `--cprt-*` CSS variables, with literal
fallbacks so it still looks reasonable if the theme isn't installed) — it
isn't a hard dependency, just how it's meant to look.

## Install

Copy this whole `cpr-relations/` folder into your Foundry `Data/modules/`
folder, enable **CPR Relations** under Manage Modules, reload.

## Use

Two ways to open an actor's Personal File:

- A **Personal File** button in that actor's sheet header, next to the
  usual close/etc. icons.
- Right-click the actor in the Actors directory sidebar — **Personal
  File** appears in the context menu, no need to open the sheet first.

The card itself:

- Portrait (`actor.img` — CPR calls this "Character Artwork", distinct
  from the token image), name, and a Mook/Major pill read straight off
  CPR's own `actor.type`.
- Faction tag(s), if set.
- Tracked relationships, sorted strongest first. Each is a rank 0–10, not
  a percentage:
  - **0 is "Hostile"** — its own state, not just the bottom of the scale.
    Renders as an empty pip row with a red spray-paint "HOSTILE" tag
    overlaid on it.
  - **1** is where every new relationship starts ("Neutral").
  - **1–8** render as bullet-cartridge pips, filled up to the current
    rank.
  - **9–10** render as hearts instead of bullets — a table convention for
    romantic relationships, not something this module enforces or checks
    eligibility for. Nothing stops a GM from pushing any relationship to
    10.
  - A **Fan** pill, independent of rank — a Hostile-tier fan is a valid
    state, not a contradiction the UI resolves for you.
- GM sees `+`/`-` steppers (by 1) and a clickable Fan pill on every row,
  plus an **Add relationship** picker at the bottom for actors that don't
  have one yet. Non-GM users get the same card entirely read-only.
- **Open sheet** in the card header jumps to the real CPR actor sheet for
  full stats/gear/skills — this card deliberately never duplicates that.

Foundry's own actor permissions gate who can even reach a given actor's
sheet or directory entry (and therefore its Personal File) — a player
without at least Limited permission on an NPC never sees the option for it
at all.

## Data model

Everything lives under the `cpr-relations` flag scope — see
`scripts/data.js`, the single place that reads/writes it. Two actors that
have a relationship each carry a mirrored copy, keyed by the other's actor
`_id`:

```jsonc
// Dan.flags["cpr-relations"]
{
  "faction": ["Night Market Fixers"],
  "relationships": {
    "<Val Hallow's actor id>": { "points": 5, "fan": true }
  }
}
```

```jsonc
// Val Hallow.flags["cpr-relations"]
{
  "faction": ["Briarwood Rock House"],
  "relationships": {
    "<Dan's actor id>": { "points": 5, "fan": true }
  }
}
```

- **Mirrored, not looked-up.** A PC's "who knows me" list is just that PC's
  own `relationships` flag — no scanning every NPC actor in the world, and
  it's how a player gets to read data whose canonical copy lives on a
  GM-owned actor without needing any special permission grant. The mirror
  is only ever written through `setRelationship()`, which writes both
  sides in one call — nothing else should call `setFlag` for this scope
  directly, or the two copies can drift.
- **No entry means no relationship yet**, not an implied zero — an NPC who
  hasn't met a PC doesn't show up in that PC's list at all.
- **`points` is 0–10** (`MAX_POINTS`), clamped and GM-gated inside
  `setRelationship()` itself, not just hidden in the UI. `pipsFor(points)`
  and `isHostile(points)` derive the pip row and the Hostile state at
  render time from that one number — nothing about rank is stored
  separately, so there's nothing that can fall out of sync with it.
- **Sheet type isn't a flag.** It reads CPR's own `actor.type`
  (`"character"` vs `"mook"`) directly — confirmed live against a real
  world console rather than assumed.

## Known gaps (MVP)

- **No "create NPC" flow yet.** This module only adds a Personal File to
  actors that already exist.
- **No GM roster/directory browser** beyond the per-actor context menu
  entry — there's no bulk "browse all NPCs and their relationships"
  screen yet.
- **No Theatre Inserts integration.** Theatre manages its own per-actor
  stand images independently; nothing here reads or writes that yet.
- **Faction is free-text, GM-only**, set via `setFactions()` — there's no
  settings UI for defining/reusing a fixed faction list yet, so typos
  create a new "faction" rather than matching an existing one.
