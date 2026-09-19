import { CLASSES } from './data.js';

/**
 * system data for the hdsfnz.character Actor sub-type. Deliberately thin —
 * see hdsfnz-foundry-handoff.md's "low-crunch" design intent: four stat
 * pools everyone tracks regardless of class (even a Blade shows an AMMO
 * readout — the mockup's "more numbers than strictly necessary" is a
 * feature, not an oversight) plus one field, speshal, with no defined
 * meaning at all. Don't add one — see the handoff doc's Genre Laws note on
 * deliberate, unexplained opacity.
 */
export class HdsfnzCharacterData extends foundry.abstract.TypeDataModel {
  // cyberpunk-red-core's SystemUtils.getDocTypesFromMixin() (cpr-systemUtils.js)
  // walks every registered Actor/Item data model in CONFIG — including ones
  // from unrelated modules — and unconditionally reads dataModel.mixins on
  // each one to build its own container/equipment schemas. That runs at
  // world load regardless of whether any hdsfnz document exists, so
  // omitting this static (confirmed live: it took the whole world down with
  // "Cannot read properties of undefined (reading 'includes')" out of
  // ContainerSchema.defineSchema()) isn't optional under this system, even
  // though this class has nothing to do with CPR's own mixin system.
  static mixins = [];

  static defineSchema() {
    const fields = foundry.data.fields;
    const pool = (initial) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial, min: 1 }),
    });
    return {
      class: new fields.StringField({ required: true, choices: Object.keys(CLASSES), initial: 'gunner' }),
      unitNumber: new fields.StringField({ required: true, blank: true, initial: '01' }),
      hp: pool(100),
      ep: pool(100),
      stam: pool(100),
      ammo: pool(30),
      speshal: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 100 }),
    };
  }
}

/** system data for the hdsfnz.gear Item sub-type — a signature-weapon-style
 * catalog entry, not a mechanical item (no damage/range/etc. fields: combat
 * is "a simple single-roll or light dice pool per action," not stat-gated
 * gear). code is the two-letter-prefix/two-digit designation shown in the
 * HUD's equipment panel (e.g. "AR-9") — the Item's own name field carries
 * the full display name.
 */
export class HdsfnzGearData extends foundry.abstract.TypeDataModel {
  // See HdsfnzCharacterData's static mixins above — same reason, required
  // by cyberpunk-red-core's own schema code, not by anything of ours.
  static mixins = [];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      slot: new fields.StringField({ required: true, choices: ['main', 'sub', 'other'], initial: 'main' }),
      code: new fields.StringField({ required: false, blank: true, initial: '' }),
    };
  }
}
