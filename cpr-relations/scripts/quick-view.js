import {
  MODULE_ID,
  DEFAULT_NEW_POINTS,
  pipsFor,
  isHostile,
  getRelationships,
  getRelationship,
  setRelationship,
  removeRelationship,
  getAvailableActors,
  getFactions,
  isMook
} from './data.js';

export class RelationsQuickView extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cpr-relations-quick-view',
      classes: ['cpr-relations-app'],
      template: `modules/${MODULE_ID}/templates/quick-view.html`,
      width: 1280,
      height: 'auto',
      resizable: true
    });
  }

  get title() {
    return `${this.actor.name} — Personal File`;
  }

  getData() {
    const relationships = getRelationships(this.actor);
    const rows = Object.entries(relationships)
      .map(([id, rel]) => {
        const other = game.actors.get(id);
        if (!other) return null;
        return {
          id,
          name: other.name,
          img: other.img,
          points: rel.points,
          fan: !!rel.fan,
          hostile: isHostile(rel.points),
          pips: pipsFor(rel.points)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.points - a.points);

    return {
      actor: this.actor,
      isGM: game.user.isGM,
      isMook: isMook(this.actor),
      factions: getFactions(this.actor),
      rows,
      available: game.user.isGM ? getAvailableActors(this.actor) : []
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="open-sheet"]').on('click', () => {
      this.actor.sheet.render(true);
    });

    if (!game.user.isGM) return;

    html.find('[data-action="inc"]').on('click', (ev) => this._onAdjust(ev, 1));
    html.find('[data-action="dec"]').on('click', (ev) => this._onAdjust(ev, -1));
    html.find('[data-action="add-relationship"]').on('click', () => this._onAdd(html));
    html.find('[data-action="toggle-fan"]').on('click', (ev) => this._onToggleFan(ev));
    html.find('[data-action="remove-relationship"]').on('click', (ev) => this._onRemove(ev));
  }

  async _onAdjust(ev, delta) {
    const row = ev.currentTarget.closest('[data-actor-id]');
    const otherId = row?.dataset.actorId;
    const other = game.actors.get(otherId);
    if (!other) return;

    const current = getRelationship(this.actor, otherId) ?? { points: 0, fan: false };
    await setRelationship(this.actor, other, { points: current.points + delta, fan: current.fan });
    this.render();
  }

  async _onAdd(html) {
    const otherId = html.find('[data-action="add-target"]').val();
    if (!otherId) return;
    const other = game.actors.get(otherId);
    if (!other) return;

    await setRelationship(this.actor, other, { points: DEFAULT_NEW_POINTS, fan: false });
    this.render();
  }

  async _onToggleFan(ev) {
    const row = ev.currentTarget.closest('[data-actor-id]');
    const otherId = row?.dataset.actorId;
    const other = game.actors.get(otherId);
    if (!other) return;

    const current = getRelationship(this.actor, otherId) ?? { points: DEFAULT_NEW_POINTS, fan: false };
    await setRelationship(this.actor, other, { points: current.points, fan: !current.fan });
    this.render();
  }

  async _onRemove(ev) {
    const row = ev.currentTarget.closest('[data-actor-id]');
    const otherId = row?.dataset.actorId;
    const other = game.actors.get(otherId);
    if (!other) return;

    const confirmed = await Dialog.confirm({
      title: 'Remove relationship',
      content: `<p>Remove ${this.actor.name}'s relationship with <strong>${other.name}</strong>? This clears it on both sides.</p>`,
      defaultYes: false
    });
    if (!confirmed) return;

    await removeRelationship(this.actor, other);
    this.render();
  }
}

Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
  buttons.unshift({
    label: 'Personal File',
    class: 'cpr-relations-open',
    icon: 'fas fa-id-badge',
    onclick: () => new RelationsQuickView(sheet.actor).render(true)
  });
});

Hooks.on('getActorDirectoryEntryContext', (html, entryOptions) => {
  entryOptions.push({
    name: 'Personal File',
    icon: '<i class="fas fa-id-badge"></i>',
    callback: (li) => {
      const actor = game.actors.get(li.data('documentId'));
      if (actor) new RelationsQuickView(actor).render(true);
    }
  });
});
