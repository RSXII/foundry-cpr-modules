import { MODULE_ID } from "./constants.js";
import { initSocket, trigger } from "./socket.js";
import { openTranslationDialog } from "./translation-dialog.js";
import { TranslationEffect } from "./translation-effect.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "position", {
    name: "CPR_TRANSLATION.SettingPosition",
    hint: "CPR_TRANSLATION.SettingPositionHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      top: "CPR_TRANSLATION.PositionTop",
      bottom: "CPR_TRANSLATION.PositionBottom",
    },
    default: "bottom",
  });

  game.settings.register(MODULE_ID, "charSpeed", {
    name: "CPR_TRANSLATION.SettingCharSpeed",
    hint: "CPR_TRANSLATION.SettingCharSpeedHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 10, max: 150, step: 5 },
    default: 55,
  });

  game.settings.register(MODULE_ID, "sourceHoldTime", {
    name: "CPR_TRANSLATION.SettingSourceHoldTime",
    hint: "CPR_TRANSLATION.SettingSourceHoldTimeHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 8000, step: 250 },
    default: 1800,
  });

  game.settings.register(MODULE_ID, "holdTime", {
    name: "CPR_TRANSLATION.SettingHoldTime",
    hint: "CPR_TRANSLATION.SettingHoldTimeHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1000, max: 15000, step: 500 },
    default: 4000,
  });

  game.settings.register(MODULE_ID, "gmOnly", {
    name: "CPR_TRANSLATION.SettingGmOnly",
    hint: "CPR_TRANSLATION.SettingGmOnlyHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once("ready", async () => {
  initSocket();

  game.modules.get(MODULE_ID).api = {
    openDialog: openTranslationDialog,
    trigger,
    TranslationEffect,
  };

  if (game.user.isGM) await ensureMacro();
});

async function ensureMacro() {
  const existing = game.macros.find((m) => m.getFlag(MODULE_ID, "isTriggerMacro"));
  if (existing) return;

  const macro = await Macro.create({
    name: game.i18n.localize("CPR_TRANSLATION.MacroName"),
    type: "script",
    img: `modules/${MODULE_ID}/assets/translate-icon.svg`,
    command: `game.modules.get("${MODULE_ID}").api.openDialog();`,
    flags: { [MODULE_ID]: { isTriggerMacro: true } },
  });

  const emptySlot = Array.from({ length: 50 }, (_, i) => i + 1)
    .find((slot) => !game.user.getHotbarMacros().find((m) => m.slot === slot)?.macro);
  if (emptySlot) {
    try {
      await game.user.assignHotbarMacro(macro, emptySlot);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not assign macro to hotbar`, err);
    }
  }
}
