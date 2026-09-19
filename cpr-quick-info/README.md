# CPR Quick Info

Foundry v12 module. While turned on, hovering any non-friendly token gets
you a compact, tooltip-style card: portrait, name, active role, a bio
blurb, and their currently carried weapons and installed cyberware —
everything a player would otherwise have to ask the GM for or peek at a
sheet to get. It's meant to answer two different questions at once: "how
hard do they hit" (gear) and "how do I even want to handle this" (bio) — a
GM line like "Twitchy, quick to draw, folds if you flash cred" changes the
approach as much as knowing they're carrying a shotgun does. First of a
couple of planned "at a glance" pieces; the gear list here is deliberately
the same information a future quickhack system would need to target
someone (what are they carrying, what's installed) even though this
module doesn't do anything with that itself yet.

Pairs with `../foundry-vtt-cpr-theme` the same way `cpr-relations` does —
reads that module's `--cprt-*` CSS variables with literal fallbacks, not a
hard dependency.

## Install

Copy this whole `cpr-quick-info/` folder into your Foundry `Data/modules/`
folder, enable **CPR Quick Info** under Manage Modules, reload.

## Turning it on

**Off by default, and this module has no toggle of its own** — no scene
control, no setting. Hovering a token does nothing until something else
switches it on for that client, via:

```js
game.modules.get('cpr-quick-info').api.enable();   // turn on
game.modules.get('cpr-quick-info').api.disable();  // turn off
game.modules.get('cpr-quick-info').api.isEnabled(); // current state
```

`../cpr-twins-ai` already does this for you: flipping its Rogue AI Vision
mode on enables this module for every connected client for as long as
vision mode stays on, and turning vision off disables it again (including
mid-hover — any card on screen the instant it's switched off disappears
immediately, not on next mouseout). That's an optional pairing, not a hard
dependency in either direction — `cpr-twins-ai` just no-ops the call if
this module isn't installed, and this module works the same way for any
other caller (a macro, another module) that wants to drive it instead.

## Use

Once enabled, hover a token. No click needed — the card appears anchored
to the token's right edge (flips to the left if that would run
off-screen) and disappears the moment the mouse leaves the token.

- **What counts as "non-friendly":** token disposition, not actor
  ownership. Anything not set to Friendly shows the card — Hostile and
  Neutral both count, since a GM often leaves an NPC Neutral until a scene
  decides which way they're going to break. Party members and friendly
  NPCs never show one; you already have their sheet.
- **Bio** is read from `system.information.notes` — CPR's own "Player
  Notes" field (that's its literal label on the character sheet's lifepath
  tab). It's the one bio field the system itself already treats as
  player-facing: a mook's "Limited" permission sheet (what a player without
  ownership sees) surfaces *only* this field out of the four under
  `information`. The other three — `alias`, `description`, `history` — are
  left out on purpose, for the same reason CPR's own limited sheet leaves
  them out: they're the GM's fuller write-up, not the public-facing line.
  Rendered as plain text (HTML tags stripped) and capped around 260
  characters — long enough for a couple of sentences, not a full dossier.
  Empty notes just omit the section rather than showing a placeholder.
- **Weapons** shown are anything in state `carried` or `equipped` (CPR's
  own two "on their person" states) — stuff sitting in `owned` (inventory,
  not on them) is left out on purpose. The currently wielded one, if any,
  sorts first and gets a **Readied** tag.
- **Cyberware** shown is anything `system.isInstalledInActor` reports true
  for — installed all the way up to the actor, not just installed in some
  disconnected item sitting in a box.
- **Respects hidden nameplates.** If a GM has a token's Display Name mode
  set to Owner or None (the standard way to run an "unidentified ganger"
  beat), this card shows "Unidentified" instead of spoiling the name —
  it's only supposed to show what hovering the token already would.

## Known gaps (v1)

- **The on/off switch is per-client and all-or-nothing** — once enabled,
  every non-friendly token shows a card to that client, there's no
  per-target "you have to Interface/scan first" step yet. That's the
  obvious next layer once an actual quickhack system exists to gate
  individual targets behind, on top of the table-wide on/off this already
  has.
- **No vitals** (HP, wounds, armor/SP) and no netrunner-specific fields
  (NET architecture, RAM, etc.) — deliberately left off this pass; the
  card is about identity and gear, not combat math.
- **Faction isn't read from `cpr-relations`.** The two modules don't know
  about each other, same as `cpr-twins-ai`/`cpr-eventoverlay` — if that
  integration is wanted later it'd be an explicit, optional read of
  `cpr-relations`' flag data, not a hard dependency.
- **No touch/mobile support.** Hover has no real equivalent on a touchscreen
  table; this is a mouse-and-keyboard feature for now.
- **Card position doesn't track a token being dragged by its own mover in
  realtime beyond `updateToken`'s own update cadence** — fine for the
  common case (GM repositions, releases), not built for smooth live-drag
  tracking.
