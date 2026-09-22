# CPR Quick Info

Foundry v12 module. While turned on, hovering any non-friendly token gets
you a compact, tooltip-style card: portrait, name, role(s), wound state,
Humanity, armor SP, a bio blurb, and their currently carried weapons,
installed cyberware, and active Critical Injuries — everything a player
would otherwise have to ask the GM for or peek at a sheet to get. It's
meant to answer three different questions at once: "how hard do they hit"
(gear), "how do I even want to handle this" (bio), and "how much of a
problem are they right now" (vitals) — a GM line like "Twitchy, quick to
draw, folds if you flash cred" changes the approach as much as knowing
they're Seriously Wounded and carrying a shotgun does. First of a couple of
planned "at a glance" pieces; the gear list here is deliberately the same
information a future quickhack system would need to target someone (what
are they carrying, what's installed) even though this module doesn't do
anything with that itself yet.

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

### Per-token reveal (independent of the switch above)

A GM can also reveal Quick Info for **one specific token**, regardless of
whether the table-wide switch above is on — a small eye icon
(`fa-solid fa-eye`) on that token's **Token HUD** (only shown on
non-Friendly tokens, same as the card itself). Click it to toggle; every
connected client — not just the GM — can then hover that token and see the
card.

This is meant for "a player calls a Perception check (or whatever skill the
table uses) against a specific target, and the GM judges it a hit" — but
**this module doesn't try to read that roll itself.** CPR's own skill-check
chat cards don't compute success/fail against a difficulty value at all
(the GM just eyeballs the roll against a DV they picked), so there's no
clean signal to automate here without the GM's own judgment call anyway.
The reveal toggle is that judgment call, made manually.

The two gates are **OR'd together**, not AND'd: a token shows a card if the
table-wide switch is on, *or* it's individually revealed, *or* both — so a
GM can reveal one target without needing to turn on `cpr-twins-ai`'s whole
vision-mode effect first, and turning vision mode off doesn't hide a token
that was individually revealed. The flag lives on the token document, not
the actor (`flags.cpr-quick-info.revealed`) — same reasoning as
`cpr-twins-ai`'s claim flag: mooks are normally unlinked, so five tokens
sharing one actor need five independent reveal states, not one shared by
all of them.

**The same flag also gates the *name*, separately from whether a card
shows at all.** The table-wide switch alone gets you gear/cyberware/bio for
anything non-friendly — but the name stays "Unidentified" until that
specific token is individually revealed, even with the table-wide switch
on. So "the AI is scanning the room" (vision mode) tells you what someone's
carrying without necessarily telling you who they are; a GM's reveal click
is what actually IDs them. See "Respects reveal state, not nameplates"
under Use.

## Use

Once enabled, hover a token. No click needed — the card appears anchored
to the token's right edge (flips to the left if that would run
off-screen) and disappears the moment the mouse leaves the token.

- **What counts as "non-friendly":** token disposition, not actor
  ownership. Anything not set to Friendly shows the card — Hostile and
  Neutral both count, since a GM often leaves an NPC Neutral until a scene
  decides which way they're going to break. Party members and friendly
  NPCs never show one; you already have their sheet.
- **Role(s)** lists every Role item the actor holds, not just the single
  "active" one (`system.roleInfo.activeRole`) — a multiclassed CPR
  character can genuinely have two, and showing only the active one was
  silently dropping the second. The active role reads in the card's cyan
  accent; any other role is listed too, just dimmer. Each shows its rank
  (`Solo · Rank 4`) when it has one.
- **Wound state** is a discrete tag (Not/Lightly/Seriously/Mortally
  Wounded, Dead — `system.derivedStats.currentWoundState`), not exact HP —
  reads "at a glance" the same way the rest of the card does rather than
  exposing HP math. Color scales through the card's existing yellow → hot
  accents as it gets worse, reusing the same two colors the "Readied" tag
  and the card's own glow already use rather than inventing a new
  red/orange/green severity scale.
- **Humanity** (`system.derivedStats.humanity`) shown as current/max next
  to the wound tag.
- **Armor SP** (`system.externalData.currentArmor{Body,Head,Shield}`) shown
  per location as current/max — a location with 0 max (no armor worn there)
  is left out rather than showing a dead "Head 0/0" chip.
- **Critical Injuries** lists any Critical Injury items the actor
  currently has (CPR has no healed/treated flag on these — a table deletes
  the item once it's treated, so anything present is presumed active),
  tagged with its location (Body/Head) in the card's hot/danger accent
  rather than the gear list's yellow "Readied" accent.
- **Vitals aren't gated by the per-token reveal flag** the way the name is
  — they show as soon as the card itself does (table-wide switch or
  reveal), same as gear. "How hurt are they" reads as something you can
  observe just by looking, not privileged information that needs a GM's ID
  confirmation the way a name does. If that's not the right call for your
  table, `isVisibleFor()`/`canViewName()` in `hud.js`/`data.js` are the two
  places to change.
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
- **Respects reveal state, not nameplates.** The name shows only once that
  specific token has been individually revealed (see "Per-token reveal"
  above) — not tied to the token's own Nameplate display-mode setting.
  That's a deliberate change from this module's first pass, which mirrored
  Foundry's nameplate rules instead: since Foundry defaults every token's
  Nameplate mode to "Never" and almost nobody changes it per-token, that
  logic meant the name was "Unidentified" essentially always, everywhere,
  regardless of GM intent — not a real gate. Gear/cyberware/bio aren't
  gated by reveal state, only identity is: the table-wide switch is enough
  to see what someone's carrying, but knowing *who* they are needs the
  GM's own reveal click.

## Known gaps (v1)

- **The table-wide switch is per-client and all-or-nothing** — once
  enabled (by `cpr-twins-ai` or any other caller), every non-friendly token
  shows a card to that client. The per-token reveal toggle above is the
  targeted alternative to that, but it's a manual GM click, not tied into
  an actual quickhack/scan mechanic yet — that'd be the next layer once
  such a system exists to drive the same `revealed` flag automatically.
- **No auto-resolution of the triggering roll.** As covered above, this is
  deliberate — CPR's skill-check chat cards carry no structured
  success/fail signal to read even if this module tried (same wall
  `cpr-attack-sfx` hit for detecting attack rolls, worked around there by
  scraping rendered HTML for a marker that doesn't exist for skill checks
  at all). A future pass could still scrape the rendered card for the
  skill name + roll total and compare against a GM-set DV setting, but
  that's meaningfully more fragile than the manual toggle this module
  ships with, and wasn't the design chosen here.
- **The reveal toggle doesn't expire.** Once revealed, a token stays
  revealed until a GM clicks it off again — no auto-clear on combat end,
  scene change, or a timer. Since it now also gates the name, that means a
  name learned mid-fight stays known for the rest of the game unless a GM
  explicitly un-reveals it.
- **Exact HP and ammo count are still left off**, by choice — wound state
  covers "how hurt are they" without exposing raw HP math, and current
  ammo felt like combat-log bookkeeping rather than an at-a-glance read.
  Both are sitting right there in the data
  (`system.derivedStats.hp`, `system.externalData.currentWeapon`) if that
  choice turns out wrong for a given table.
- **No netrunner-specific fields** (NET architecture, RAM, etc.) —
  deliberately left off this pass; the card is about identity, gear, and
  vitals, not netrunning math.
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
