# CPR Vehicle Crew

Foundry v12 module. Adds seat assignment to `cyberpunk-red-vehicles`'
existing vehicle sheet, and — the actual point of the module — pins
occupant tokens to their seat so they move with the vehicle token instead
of staying planted on the map.

Built as a replacement for MMuton's VAS
(`mmutons-cyberpunk-red-vas`): VAS's "seats" only ever tracked which actor
was assigned where in a flag, never touched a token's position. This module
keeps the seat-assignment idea, drops VAS's extra sheet / auto permission
sync / MOVE-matching Active Effects, and adds the token-following that was
actually missing.

## Install

Copy this `cpr-vehicle-crew/` folder into your Foundry `Data/modules/`
folder, enable **CPR Vehicle Crew** under Manage Modules (requires
`cyberpunk-red-vehicles`), reload.

## Use

Open a vehicle actor's sheet — a **Crew** section appears near the bottom,
GM-only for editing (players see occupant names read-only).

- **Add Seat** to create a named seat. First time you open a vehicle with
  no seats defined yet, one seat per point of its `Seats` stat is created
  automatically.
- **Assign a seat**: select the occupant's token on the canvas, then click
  "Assign selected token" on the seat — or just drag the actor onto the
  seat row. Either way, their token snaps to the vehicle token's position
  (plus that seat's offset, if you've set one via the edit/pencil icon).
- **Move or rotate the vehicle token** — every seated occupant's token
  teleports to the vehicle's new position and heading shortly after it stops
  moving/turning. It polls the vehicle token's x/y/rotation until they hold
  steady rather than acting on a fixed delay: a single drag or rotate can
  fire more than one position write while the vehicle animates, and reacting
  to the first one would strand passengers at an intermediate waypoint.
  Requires a GM client connected (the sync runs on the GM's client so two
  clients never race to move the same passenger token).
- **Seat offsets are rotation-aware.** A seat's Offset X/Y (set via the
  edit/pencil icon) is defined relative to the vehicle's *center*, as if its
  rotation were 0 — turning the vehicle rotates that offset along with it,
  so "driver's side" stays on the driver's side instead of sliding off as
  the car turns.
- **"Rotate with vehicle"** per-seat checkbox (same edit dialog): on by
  default, spins the occupant's own token to match the vehicle's heading.
  Turn it off for non-directional art (a circular portrait token has no
  facing to speak of, so there's nothing for this to usefully do).
- **Capture from selected token**, in the edit-seat dialog: instead of
  guessing Offset X/Y by hand, drag any token to where you want this seat
  on the vehicle, select it, and click Capture — it fills in the offset
  that reproduces that exact spot relative to the vehicle's current
  position and heading.
- **Access dropdown** per occupant: No Access / Observer / Owner, applied
  to that occupant's owning player on the vehicle actor and its token(s).
  Manual — there's no automatic permission computation here.

## Known gaps (v1)

- **No lock against manual dragging.** A player can still drag their own
  seated token independently, which desyncs it from the vehicle — unseating
  is a manual "Remove from seat" action, not auto-detected.
- **One occupant per seat, one token per actor per scene assumed.** If an
  actor has more than one token on the vehicle's scene, the first match
  wins (undefined which one) — not an issue for standard linked-actor PCs
  and mooks.
- **No migration from VAS's `positions` flag data.** Reassign seats once
  after switching over; this module doesn't read VAS's flags at all.
- **Requires a GM client connected** to actually move passenger tokens,
  since the sync write is GM-gated (same constraint VAS's own hooks live
  with throughout).
