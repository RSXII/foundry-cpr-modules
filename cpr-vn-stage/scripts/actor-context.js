// Actor-drawer right-click menu: "Add to Scene (VN)" / "Remove from Scene" /
// "Configure Expressions…" — the entry point the whole module hangs off,
// same hook ../cpr-relations uses for its "Personal File" item.

import { isInScene, addToScene, removeFromScene, ensureSeeded } from './data.js';
import { openSetupAppFor } from './setup-app.js';
import { refreshOverlay } from './stage-overlay.js';

function actorFromLi(li) {
  return game.actors.get(li.data('documentId'));
}

export function registerActorContextMenu() {
  Hooks.on('getActorDirectoryEntryContext', (html, entryOptions) => {
    entryOptions.push(
      {
        name: 'Add to Scene (VN)',
        icon: '<i class="fas fa-plus"></i>',
        condition: (li) => game.user.isGM && !isInScene(li.data('documentId')),
        callback: async (li) => {
          const actor = actorFromLi(li);
          if (!actor) return;
          await ensureSeeded(actor);
          await addToScene(actor.id);
          refreshOverlay();
        },
      },
      {
        name: 'Remove from Scene',
        icon: '<i class="fas fa-trash"></i>',
        condition: (li) => game.user.isGM && isInScene(li.data('documentId')),
        callback: async (li) => {
          const actor = actorFromLi(li);
          if (!actor) return;
          await removeFromScene(actor.id);
          refreshOverlay();
        },
      },
      {
        name: 'Configure Expressions…',
        icon: '<i class="fas fa-masks-theater"></i>',
        condition: () => game.user.isGM,
        callback: async (li) => {
          const actor = actorFromLi(li);
          if (!actor) return;
          await ensureSeeded(actor);
          openSetupAppFor(actor);
        },
      },
    );
  });
}
