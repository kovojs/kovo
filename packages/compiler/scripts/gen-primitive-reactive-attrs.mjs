// Dev-time generator for the primitive reactive-attribute manifest.
//
// SPEC.md §4.6 (KV232): @kovojs/ui primitives own their state attributes
// (aria-checked / aria-pressed / aria-expanded / data-state / hidden / checked
// ...). The compiler must make these attributes reactive automatically so app
// authors never hand-write them. This script SNAPSHOTS each headless-ui
// primitive attribute function by calling it with its controlling boolean field
// set to false vs true, diffs the two outputs, and writes a pure DATA module the
// production compiler reads.
//
// @kovojs/headless-ui is only a devDependency of @kovojs/compiler; production
// `src/**` must not import it (scripts/import-boundary.mjs). This generator runs
// at dev time, imports the primitives here, and commits the resulting data table
// so the compiler never needs the headless-ui import.
//
// Run with: corepack pnpm --filter @kovojs/compiler run gen:reactive-attrs
// (or: node packages/compiler/scripts/gen-primitive-reactive-attrs.mjs)
// Then normalize whitespace with `vp check --fix` (matching
// packages/ui/scripts/build-registry.mjs): this writes raw JSON whose
// whitespace differs from the repo formatter, so the committed file is the
// fixed version. Regeneration is data-stable; only attribute/value drift shows.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve workspace `.ts` sources behind `.js` specifiers so this script can
// import headless-ui primitive source directly in the monorepo (matching
// site/scripts/export-static.mjs). Node strips the TS types natively.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const accordion = await import('@kovojs/headless-ui/accordion');
const checkbox = await import('@kovojs/headless-ui/checkbox');
const collapsible = await import('@kovojs/headless-ui/collapsible');
const dialog = await import('@kovojs/headless-ui/dialog');
const disclosure = await import('@kovojs/headless-ui/disclosure');
const meter = await import('@kovojs/headless-ui/meter');
const progress = await import('@kovojs/headless-ui/progress');
const radioGroup = await import('@kovojs/headless-ui/radio-group');
const switchPrimitive = await import('@kovojs/headless-ui/switch');
const tabs = await import('@kovojs/headless-ui/tabs');
const toggle = await import('@kovojs/headless-ui/toggle');
const toggleGroup = await import('@kovojs/headless-ui/toggle-group');
const tooltip = await import('@kovojs/headless-ui/tooltip');

// Attributes whose presence (not string value) is the reactive signal. These
// mirror the compiler's booleanPresenceAttributes set: emit `(cond ? "" : null)`
// form instead of a stringified value.
const BOOLEAN_PRESENCE_ATTRIBUTES = new Set([
  'checked',
  'disabled',
  'hidden',
  'multiple',
  'open',
  'readonly',
  'required',
  'selected',
]);

// Each probe snapshots one primitive attribute function. `controlField` is the
// state field the compiler binds reactively; `base` holds the minimal stable
// options (e.g. a fixed contentId) so idref/static attrs do NOT show up in the
// false-vs-true diff and only genuinely reactive attributes remain.
const probes = [
  {
    key: 'accordion.item',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: accordion.accordionItemAttributes,
    base: { itemValue: 'item-a', type: 'single' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'accordion.header',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: accordion.accordionHeaderAttributes,
    base: { itemValue: 'item-a', level: 3, type: 'single' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'accordion.trigger',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: accordion.accordionTriggerAttributes,
    base: { contentId: 'c', itemValue: 'item-a', type: 'single' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'accordion.content',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: accordion.accordionContentAttributes,
    base: { contentId: 'c', itemValue: 'item-a', type: 'single' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'checkbox.root',
    controlField: 'checked',
    controlKind: 'tri-state',
    attrs: checkbox.checkboxRootAttributes,
    base: {},
    whenFalse: { checked: false },
    whenTrue: { checked: true },
    enumStates: {
      indeterminate: { checked: 'indeterminate' },
    },
  },
  {
    key: 'switch.root',
    controlField: 'checked',
    controlKind: 'boolean',
    attrs: switchPrimitive.switchRootAttributes,
    base: {},
    whenFalse: { checked: false },
    whenTrue: { checked: true },
  },
  {
    key: 'toggle.root',
    controlField: 'pressed',
    controlKind: 'boolean',
    attrs: toggle.toggleRootAttributes,
    base: {},
    whenFalse: { pressed: false },
    whenTrue: { pressed: true },
  },
  {
    key: 'progress.root',
    controlField: 'value',
    controlKind: 'progress-ratio',
    attrs: progress.progressRootAttributes,
    base: { max: 100 },
    computedAttrs: ['data-max', 'data-state', 'data-value', 'style'],
    enumStates: {
      complete: { value: 100 },
    },
    whenFalse: { value: null },
    whenTrue: { value: 42 },
  },
  {
    key: 'meter.root',
    controlField: 'value',
    controlKind: 'meter-range',
    attrs: meter.meterRootAttributes,
    base: { high: 85, low: 40, max: 100, min: 0, optimum: 70 },
    computedAttrs: [
      'data-high',
      'data-low',
      'data-max',
      'data-min',
      'data-optimum',
      'data-state',
      'data-value',
      'style',
    ],
    enumStates: {
      evenLessGood: { value: 96 },
      suboptimum: { value: 30 },
    },
    whenFalse: { value: 30 },
    whenTrue: { value: 72 },
  },
  {
    key: 'disclosure.root',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: disclosure.disclosureRootAttributes,
    base: {},
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'disclosure.trigger',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: disclosure.disclosureTriggerAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'disclosure.content',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: disclosure.disclosureContentAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'collapsible.root',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: collapsible.collapsibleRootAttributes,
    base: {},
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'collapsible.trigger',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: collapsible.collapsibleTriggerAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'collapsible.content',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: collapsible.collapsibleContentAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'dialog.root',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: dialog.dialogRootAttributes,
    base: {},
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'dialog.content',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: dialog.dialogContentAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'dialog.close',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: dialog.dialogCloseAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'radio-group.item',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: radioGroup.radioGroupItemAttributes,
    base: { itemValue: 'item-a' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'radio-group.radio',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: radioGroup.radioGroupRadioAttributes,
    base: { itemValue: 'item-a' },
    ignoreAttrs: ['tabIndex'],
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'radio-group.label',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: radioGroup.radioGroupLabelAttributes,
    base: { itemValue: 'item-a' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'tabs.root',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: tabs.tabsRootAttributes,
    base: {},
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'tabs.list',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: tabs.tabsListAttributes,
    base: {},
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'tabs.trigger',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: tabs.tabsTriggerAttributes,
    base: { itemValue: 'item-a' },
    ignoreAttrs: ['tabIndex', 'type', 'value'],
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'tabs.panel',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: tabs.tabsPanelAttributes,
    base: { itemValue: 'item-a' },
    ignoreAttrs: ['tabIndex'],
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'toggle-group.root',
    controlField: 'value',
    controlKind: 'equality',
    discriminatorField: 'itemValue',
    attrs: toggleGroup.toggleGroupRootAttributes,
    base: {},
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'toggle-group.item',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: toggleGroup.toggleGroupItemAttributes,
    base: { itemValue: 'item-a', type: 'single' },
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'toggle-group.button',
    controlField: 'value',
    controlKind: 'set-membership',
    discriminatorField: 'itemValue',
    modeField: 'type',
    attrs: toggleGroup.toggleGroupButtonAttributes,
    base: { itemValue: 'item-a', type: 'single' },
    ignoreAttrs: ['tabIndex', 'type', 'value'],
    whenFalse: { value: 'item-b' },
    whenTrue: { value: 'item-a' },
  },
  {
    key: 'tooltip.root',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: tooltip.tooltipRootAttributes,
    base: {},
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'tooltip.trigger',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: tooltip.tooltipTriggerAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
  {
    key: 'tooltip.content',
    controlField: 'open',
    controlKind: 'boolean',
    attrs: tooltip.tooltipContentAttributes,
    base: { contentId: 'c' },
    whenFalse: { open: false },
    whenTrue: { open: true },
  },
];

function serializeValue(value) {
  if (typeof value === 'boolean') return value;
  return String(value);
}

function diffAttributes(probe) {
  const whenFalse = probe.attrs({ ...probe.base, ...probe.whenFalse });
  const whenTrue = probe.attrs({ ...probe.base, ...probe.whenTrue });
  const enumOutputs = Object.fromEntries(
    Object.entries(probe.enumStates ?? {}).map(([name, state]) => [
      name,
      probe.attrs({ ...probe.base, ...state }),
    ]),
  );
  const names = new Set([
    ...Object.keys(whenFalse),
    ...Object.keys(whenTrue),
    ...Object.values(enumOutputs).flatMap((output) => Object.keys(output)),
  ]);
  const attrs = {};

  for (const name of [...names].sort()) {
    if (probe.ignoreAttrs?.includes(name)) continue;
    const falseValue = whenFalse[name];
    const trueValue = whenTrue[name];
    const booleanPresence = BOOLEAN_PRESENCE_ATTRIBUTES.has(name);
    const enumValues = Object.fromEntries(
      Object.entries(enumOutputs).map(([state, output]) => [state, output[name]]),
    );
    // Only attributes that actually change between the two states are reactive.
    if (
      trueValue === falseValue &&
      Object.values(enumValues).every((value) => value === falseValue)
    ) {
      continue;
    }
    // String-valued attributes that appear/disappear (one side undefined/null)
    // are conditional idrefs (e.g. tooltip's aria-describedby depends on
    // contentId, not just `open`). The existing primitive-composition / idref
    // machinery owns those; this reactive-boolean pass only emits attributes
    // that have a concrete value on both states, or boolean-presence attrs whose
    // absence is itself the signal (hidden/checked/open).
    const trueAbsent = trueValue === undefined || trueValue === null;
    const falseAbsent = falseValue === undefined || falseValue === null;
    if (!booleanPresence && (trueAbsent || falseAbsent)) continue;
    attrs[name] = {
      booleanPresence,
      whenFalse: serializeValue(falseValue),
      whenTrue: serializeValue(trueValue),
      ...Object.fromEntries(
        Object.entries(enumValues).map(([state, value]) => [
          `when${state[0].toUpperCase()}${state.slice(1)}`,
          serializeValue(value),
        ]),
      ),
    };
  }

  return attrs;
}

const manifest = {};
for (const probe of probes) {
  manifest[probe.key] = {
    attrs: diffAttributes(probe),
    controlField: probe.controlField,
    controlKind: probe.controlKind,
    ...(probe.discriminatorField === undefined
      ? {}
      : { discriminatorField: probe.discriminatorField }),
    ...(probe.modeField === undefined ? {} : { modeField: probe.modeField }),
    ...(probe.computedAttrs === undefined ? {} : { computedAttrs: probe.computedAttrs }),
  };
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(scriptDir, '../src/generated');
const outPath = resolve(outDir, 'primitive-reactive-attrs.ts');
mkdirSync(outDir, { recursive: true });

const banner = `// GENERATED by packages/compiler/scripts/gen-primitive-reactive-attrs.mjs - do not edit.
// Run \`corepack pnpm --filter @kovojs/compiler run gen:reactive-attrs\` to refresh.
//
// SPEC.md §4.6 (KV232): @kovojs/ui primitives own their reactive state attributes.
// This data table snapshots each headless-ui primitive attribute function diffed
// between inactive vs active control states. The compiler reads this
// table (no headless-ui import in production src/**) to emit reactive
// data-bind:<attr> derives for primitive-owned attributes automatically.
`;

const body = `
/** Supported reactive-control expression families. */
export type PrimitiveReactiveControlKind =
  | 'boolean'
  | 'equality'
  | 'meter-range'
  | 'progress-ratio'
  | 'set-membership'
  | 'tri-state';

/** One reactive attribute the compiler should bind from the controlling state. */
export interface PrimitiveReactiveAttr {
  /** True when the attribute's presence (not its value) is the reactive signal. */
  readonly booleanPresence: boolean;
  /** Serialized attribute value when the controlling condition is inactive. */
  readonly whenFalse: boolean | string;
  /** Serialized attribute value when the controlling condition is active. */
  readonly whenTrue: boolean | string;
  /** Serialized attribute value when a tri-state checkbox is indeterminate. */
  readonly whenIndeterminate?: boolean | string;
  /** Serialized attribute values for additional sampled primitive enum states. */
  readonly [sampledState: \`when\${string}\`]: boolean | string | undefined;
}

/** All reactive attributes a primitive derives from one control field. */
export interface PrimitiveReactiveAttrEntry {
  readonly attrs: Readonly<Record<string, PrimitiveReactiveAttr>>;
  /** Name of the state field these attributes are derived from. */
  readonly controlField: string;
  /** How the compiler should derive the active/inactive condition. */
  readonly controlKind: PrimitiveReactiveControlKind;
  /** Compiler-owned computed attrs for numeric/range primitives. */
  readonly computedAttrs?: readonly string[];
  /** Per-element static prop compared with the control field when applicable. */
  readonly discriminatorField?: string;
  /** Optional per-element mode prop, used by accordion single vs multiple. */
  readonly modeField?: string;
}

/** Per primitive-fn key (e.g. \`switch.root\`) → its reactive attribute manifest. */
export const primitiveReactiveAttrs: Readonly<Record<string, PrimitiveReactiveAttrEntry>> =
  ${JSON.stringify(manifest, null, 2)} as const;
`;

writeFileSync(outPath, `${banner}${body}`);
console.log(`gen-primitive-reactive-attrs: wrote ${outPath}`);
for (const [key, entry] of Object.entries(manifest)) {
  console.log(
    `  ${key} (${entry.controlField}): ${Object.keys(entry.attrs).join(', ') || '(none)'}`,
  );
}
