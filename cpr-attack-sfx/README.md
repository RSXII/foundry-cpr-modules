# CPR Attack SFX

Foundry v12/v13 module for `cyberpunk-red-core`. Assign a sound file to a
weapon; it plays for everyone at the table whenever that weapon's **attack**
roll (to-hit) lands in chat — not its damage roll.

## Install

Copy this `cpr-attack-sfx/` folder into your Foundry `Data/modules/` folder,
enable **CPR Attack SFX** under Manage Modules, reload.

## Use

Open a weapon item's sheet, Settings tab — an **Attack Sound** row appears
at the bottom. Click the folder icon to pick an audio file (upload one via
Foundry's file picker first if it isn't already in your Data folder), the
play icon to preview it locally, or the trash icon to clear it.

Next time that weapon's attack roll (regular, aimed, autofire, or
suppressive fire) posts to chat, the assigned sound plays for every
connected client.

## How it works

CPR's chat cards don't carry an explicit roll-type flag. This module
instead recognizes attack cards by their "roll damage" follow-up button
(`data-action="rollDamage"`), which only appears on attack-style cards —
damage cards use `data-action="applyDamage"` instead — and reads the
weapon's item id off that same button to look up the assigned sound.

## Known gaps (v1)

- **Weapon items only.** Unarmed/martial-arts attacks and cyberdeck/Zap
  "attacks" aren't covered — those don't resolve to a plain weapon Item the
  same way.
- **No per-scene or per-actor override**, just one sound per weapon Item.
  Duplicating a weapon item (e.g. one copy per NPC) means assigning the
  sound on each copy.
- **No volume UI yet** — defaults to 0.8; change it by hand via the item's
  `cpr-attack-sfx.volume` flag if needed.
