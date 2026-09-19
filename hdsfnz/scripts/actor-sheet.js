import { MODULE_ID, CHARACTER_TYPE, GEAR_TYPE, CLASSES, GEAR_SLOTS } from './data.js';

/** Minimal editor for an hdsfnz.character actor: class, the four stat pools, the unexplained SPESHAL slider, and a flat equipment list. No derived math, no rolls — this sheet only edits state, it doesn't resolve anything (see the handoff doc's "simple single-roll or light dice pool" combat, which stays a GM/chat-macro concern, not a sheet button). */
export class HdsfnzActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['hdsfnz', 'sheet', 'actor'],
      template: `modules/${MODULE_ID}/templates/actor-sheet.hbs`,
      width: 460,
      height: 640,
    });
  }

  /** @override */
  getData(options) {
    const context = super.getData(options);
    const system = this.actor.system;
    context.system = system;
    context.classLabels = Object.fromEntries(Object.entries(CLASSES).map(([id, c]) => [id, c.label]));
    context.classInfo = CLASSES[system.class] ?? null;
    context.gearSlotLabels = GEAR_SLOTS;
    context.gear = this.actor.items.filter((i) => i.type === GEAR_TYPE);
    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find('[data-action="add-gear"]').on('click', () => {
      this.actor.createEmbeddedDocuments('Item', [{ name: 'New Gear', type: GEAR_TYPE }]);
    });

    html.find('[data-action="delete-gear"]').on('click', (ev) => {
      const itemId = ev.currentTarget.closest('[data-item-id]')?.dataset.itemId;
      if (itemId) this.actor.deleteEmbeddedDocuments('Item', [itemId]);
    });

    // Item rows aren't part of the actor's own form submission, so their
    // fields are wired individually rather than through _updateObject.
    html.find('[data-item-id] [data-field]').on('change', (ev) => {
      const el = ev.currentTarget;
      const itemId = el.closest('[data-item-id]').dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) item.update({ [el.dataset.field]: el.value });
    });
  }
}

export function registerActorSheet() {
  Actors.registerSheet(MODULE_ID, HdsfnzActorSheet, {
    types: [CHARACTER_TYPE],
    makeDefault: true,
    label: 'HDSFNZ Character Sheet',
  });
}
