# Live Translation Effect

A Cyberpunk 2077-style "live translation" subtitle for Foundry VTT. Feed it a
line of in-fiction source text and its English translation, and it shows the
original line first, then decrypts it left-to-right: settled English on the
left, a flickering glitch band sweeping across, and the still-untranslated
source text shrinking away on the right — like a translator chip catching up
in real time.

It is a visual effect, not a real translator. You supply both sides of the
line yourself.

## Usage

On `ready`, the GM automatically gets a **Live Translation** macro (added to
the world macro directory, and to the first free hotbar slot). Click it to
open the dialog:

- **Source Text** — the original line(s), as spoken in-fiction.
- **English Translation** — the matching English line(s).
- **Show To** — broadcast to all connected players, or preview for yourself only.

Multiple lines are paired by line number (line 1 of Source with line 1 of
English, etc.) and played back one after another, like a run of subtitles.
Click the overlay at any time to skip the current line straight to its
settled English text.

## Settings

Under this module's settings (world scope, GM only):

- **Overlay Position** — top or bottom of screen.
- **Text Size** — font size, in pixels, of the subtitle text.
- **Decrypt Speed** — ms per character while a line is translating in.
- **Source Text Hold** — ms the original, untranslated source text is shown
  before the decrypt effect begins.
- **Hold Duration** — ms the settled English line stays up before clearing or
  advancing to the next cue.
- **Restrict Triggering to GM** — when enabled (default), only the GM can open
  the dialog.

## API

For use in your own macros or module code:

```js
game.modules.get("cpr-live-translation").api.trigger({
  cues: [
    { source: "Konnichiwa, chummer.", english: "Hello, choom." },
    { source: "Nova omedeto.", english: "Congratulations, nova." },
  ],
  position: "bottom",       // optional, defaults to the world setting
  fontSize: 28,             // optional, subtitle font size in pixels
  charSpeed: 55,            // optional, ms per character while decrypting
  sourceHoldTime: 1800,     // optional, ms to show the plain source text first
  holdTime: 4000,           // optional, ms to hold each settled line
}, { broadcast: true }); // false to preview locally only
```
