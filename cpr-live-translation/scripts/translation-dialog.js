import { MODULE_ID } from "./constants.js";
import { trigger } from "./socket.js";

/**
 * Splits two multi-line text blocks into paired {source, english} cues by
 * line number. Blank pairs (both sides empty) are dropped. This is not a
 * word-for-word mapping - each line is treated as one subtitle "cue" that
 * morphs from source to english as a whole.
 */
function buildCues(sourceText, englishText) {
  const sourceLines = sourceText.split("\n").map((l) => l.trim());
  const englishLines = englishText.split("\n").map((l) => l.trim());
  const lineCount = Math.max(sourceLines.length, englishLines.length);

  const cues = [];
  for (let i = 0; i < lineCount; i++) {
    const source = sourceLines[i] ?? "";
    const english = englishLines[i] ?? "";
    if (!source && !english) continue;
    cues.push({ source, english: english || source });
  }
  return cues;
}

export function openTranslationDialog() {
  if (game.settings.get(MODULE_ID, "gmOnly") && !game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CPR_TRANSLATION.WarnGmOnly"));
    return;
  }

  const content = `
    <form class="cpr-translation-dialog">
      <div class="form-group stacked">
        <label>${game.i18n.localize("CPR_TRANSLATION.SourceLabel")}</label>
        <p class="hint">${game.i18n.localize("CPR_TRANSLATION.SourceHint")}</p>
        <textarea name="source" rows="4" placeholder="Konnichiwa, chummer."></textarea>
      </div>
      <div class="form-group stacked">
        <label>${game.i18n.localize("CPR_TRANSLATION.EnglishLabel")}</label>
        <p class="hint">${game.i18n.localize("CPR_TRANSLATION.EnglishHint")}</p>
        <textarea name="english" rows="4" placeholder="Hello, choom."></textarea>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("CPR_TRANSLATION.TargetLabel")}</label>
        <select name="target">
          <option value="all">${game.i18n.localize("CPR_TRANSLATION.TargetAll")}</option>
          <option value="self">${game.i18n.localize("CPR_TRANSLATION.TargetSelf")}</option>
        </select>
      </div>
    </form>
  `;

  new Dialog({
    title: game.i18n.localize("CPR_TRANSLATION.DialogTitle"),
    content,
    buttons: {
      play: {
        icon: '<i class="fas fa-satellite-dish"></i>',
        label: game.i18n.localize("CPR_TRANSLATION.PlayButton"),
        callback: (html) => {
          const form = html[0].querySelector("form");
          const sourceText = form.source.value;
          const englishText = form.english.value;
          const target = form.target.value;

          const cues = buildCues(sourceText, englishText);
          if (!cues.length) {
            ui.notifications.warn(game.i18n.localize("CPR_TRANSLATION.WarnEmpty"));
            return;
          }

          trigger(
            {
              cues,
              position: game.settings.get(MODULE_ID, "position"),
              charSpeed: game.settings.get(MODULE_ID, "charSpeed"),
              sourceHoldTime: game.settings.get(MODULE_ID, "sourceHoldTime"),
              holdTime: game.settings.get(MODULE_ID, "holdTime"),
            },
            { broadcast: target === "all" }
          );
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("CPR_TRANSLATION.CancelButton"),
      },
    },
    default: "play",
  }, { width: 480 }).render(true);
}
