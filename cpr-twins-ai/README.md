# CPR Twins AI

Foundry v12 module. In-fiction, this is The Twins — the pair of rogue AIs
lending the party their eyes and hands. Lets a GM designate specific mook
or vehicle actors as player-takeable, then flip a mode on/off that turns
the whole table's screen into **Rogue AI Vision** — a color-graded,
HUD-lined "the AI is scanning the room for you" read — and shows a
bracketed **Take Control** target-lock above eligible tokens. Any player
can click it to claim that one token for themselves — until the GM clicks
**Release Control**.

## Install

Copy this `cpr-twins-ai/` folder into your Foundry `Data/modules/`
folder, enable **CPR Twins AI** under Manage Modules, reload.

## Use

- **Mark an actor takeable**: open a `mook` or vehicle actor's sheet
  (GM-only) and check **Player-Takeable**. This is a template property —
  every token backed by that actor becomes eligible, but claiming one still
  only ever affects that single token (see below).
- **Toggle the mode**: the token controls sidebar has a **CPR Twins AI**
  group with one toggle tool (GM-only). Off by default. Flipping
  it on mounts Rogue AI Vision for *every* connected client, GM included —
  this is meant as a rare, cinematic beat for a big moment, not a mode a
  table leaves running.
- **Claim a token**: while the mode is on, players see a bracketed
  **Take Control** target-lock — plus a rim-lit outline traced on the
  token's own art — above eligible, unclaimed tokens. Clicking the tag
  relays the request to a connected GM client, which grants that player
  ownership of that token, plays a downlink-beam-and-burst flourish on
  every connected screen, and auto-selects the token on the claimant's
  canvas. First click wins if two players go for the same token at once.
- **Release a token**: the GM sees a **Release Control** lock on any
  currently-claimed token — this is independent of the mode toggle, so
  turning the mode off doesn't strand the GM without a way to clean up
  existing claims. Clicking it resets that player's ownership and frees the
  token back up.

## Rogue AI Vision

The full-screen effect that comes with the mode: the real canvas desaturates
and recolors through an acid-green duotone, a vignette and scanline static
settle in, a VHS tracking line drifts down the frame on a loop, and a HUD
overlay adds corner brackets, an uplink readout with a running T+ clock, a
CPU meter that idles low and spikes on every claim, and an "Active Links"
tracker (five chip slots, filled by how many tokens on the current scene
are claimed). It's deliberately a different register from this repo's
`cpr-eventoverlay` module's "In The Net" wireframe overlay — that one is a
shared "we're inside cyberspace" break; this one is the AI's own targeting
sense laid over the real room, and the two modules don't know about each
other or interact.

## Pairs with cpr-quick-info

If `../cpr-quick-info` is installed and active, turning Rogue AI Vision on
also enables its hover-card HUD for every connected client — hover a
non-friendly token while the AI's watching and get its at-a-glance card
(portrait, bio, gear); turning vision off disables it again, immediately,
even mid-hover. This is the AI handing over target info while it's already
lending its eyes, the same beat as the vision effect itself. Optional in
both directions: this module just reaches for
`game.modules.get('cpr-quick-info')?.api` and no-ops if it isn't there, and
`cpr-quick-info` works fine standalone if something else (a macro, say)
drives its on/off switch instead — see that module's own README.

## Scope of a claim

Deliberately **per token, not per actor**. Mooks are normally unlinked, so
five "Ganger" tokens on a scene are five independent claims — taking one
doesn't touch the others, even though they share the same base actor and
the same Player-Takeable flag. Vehicles are normally linked (one actor, one
token), so a claim there grants on the actor — which in practice still
means "just this vehicle," since that's what a linked token already is.

## Known gaps (v1)

- **Requires a GM client connected** to actually grant a claim, since the
  ownership write is GM-gated — a player's click is a no-op until a GM
  client processes it. Same constraint `cpr-vehicle-crew`'s token-follow
  sync lives with.
- **The request travels as a GM-only whispered chat message**, not a raw
  socket event — a self-hosted Foundry server tested during development
  (v12 build 343, direct IP:port) wasn't relaying custom module-namespaced
  socket events between clients at all, in either direction, even though
  its own built-in traffic synced fine. Riding chat's document-sync
  pipeline instead sidesteps that. You'll see it flash briefly in the GM's
  chat log — this module deletes it immediately after processing.
- **No auto-release on combat end, scene change, or player disconnect.**
  Release is a manual GM action only.
- **No queueing.** If two players click the same token in the same
  instant, the loser's click is silently dropped — the button just doesn't
  disappear for them, with no explicit "someone beat you to it" message.
- **No literal see-through-walls.** The vision effect sells enhanced
  perception through the color grade and per-token outline, not by
  suppressing Foundry's own vision/fog-of-war — that's a separate, riskier
  feature this module doesn't attempt.
- **The rim-light outline needs `PIXI.filters.OutlineFilter`**, which ships
  bundled with Foundry but isn't core PIXI. If some future Foundry build
  drops it, the outline quietly stops appearing — the bracket and tag
  still work fine on their own.
- **Everyone sees the same screen effect**, GM included — there's no
  per-client exemption, by design for this pass.
