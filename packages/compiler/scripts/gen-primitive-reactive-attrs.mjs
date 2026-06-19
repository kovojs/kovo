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
// site/scripts/emit-ui-css.mjs). Node strips the TS types natively.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const collapsible = await import('@kovojs/headless-ui/collapsible');
const dialog = await import('@kovojs/headless-ui/dialog');
const disclosure = await import('@kovojs/headless-ui/disclosure');
const switchPrimitive = await import('@kovojs/headless-ui/switch');
const toggle = await import('@kovojs/headless-ui/toggle');
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
// boolean state field the compiler binds reactively; `base` holds the minimal
// stable options (e.g. a fixed contentId) so idref/static attrs do NOT show up
// in the false-vs-true diff and only genuinely reactive attributes remain.
const probes = [
  {
    key: 'switch.root',
    controlField: 'checked',
    attrs: switchPrimitive.switchRootAttributes,
    base: {},
  },
  { key: 'toggle.root', controlField: 'pressed', attrs: toggle.toggleRootAttributes, base: {} },
  {
    key: 'disclosure.root',
    controlField: 'open',
    attrs: disclosure.disclosureRootAttributes,
    base: {},
  },
  {
    key: 'disclosure.trigger',
    controlField: 'open',
    attrs: disclosure.disclosureTriggerAttributes,
    base: { contentId: 'c' },
  },
  {
    key: 'disclosure.content',
    controlField: 'open',
    attrs: disclosure.disclosureContentAttributes,
    base: { contentId: 'c' },
  },
  {
    key: 'collapsible.root',
    controlField: 'open',
    attrs: collapsible.collapsibleRootAttributes,
    base: {},
  },
  {
    key: 'collapsible.trigger',
    controlField: 'open',
    attrs: collapsible.collapsibleTriggerAttributes,
    base: { contentId: 'c' },
  },
  {
    key: 'collapsible.content',
    controlField: 'open',
    attrs: collapsible.collapsibleContentAttributes,
    base: { contentId: 'c' },
  },
  { key: 'dialog.root', controlField: 'open', attrs: dialog.dialogRootAttributes, base: {} },
  {
    key: 'dialog.content',
    controlField: 'open',
    attrs: dialog.dialogContentAttributes,
    base: { contentId: 'c' },
  },
  {
    key: 'dialog.close',
    controlField: 'open',
    attrs: dialog.dialogCloseAttributes,
    base: { contentId: 'c' },
  },
  { key: 'tooltip.root', controlField: 'open', attrs: tooltip.tooltipRootAttributes, base: {} },
  {
    key: 'tooltip.trigger',
    controlField: 'open',
    attrs: tooltip.tooltipTriggerAttributes,
    base: { contentId: 'c' },
  },
  {
    key: 'tooltip.content',
    controlField: 'open',
    attrs: tooltip.tooltipContentAttributes,
    base: { contentId: 'c' },
  },
];

function serializeValue(value) {
  if (typeof value === 'boolean') return value;
  return String(value);
}

function diffAttributes(probe) {
  const whenFalse = probe.attrs({ ...probe.base, [probe.controlField]: false });
  const whenTrue = probe.attrs({ ...probe.base, [probe.controlField]: true });
  const names = new Set([...Object.keys(whenFalse), ...Object.keys(whenTrue)]);
  const attrs = {};

  for (const name of [...names].sort()) {
    const trueValue = whenTrue[name];
    const falseValue = whenFalse[name];
    const booleanPresence = BOOLEAN_PRESENCE_ATTRIBUTES.has(name);
    // Only attributes that actually change between the two states are reactive.
    if (trueValue === falseValue) continue;
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
    };
  }

  return attrs;
}

const manifest = {};
for (const probe of probes) {
  manifest[probe.key] = { attrs: diffAttributes(probe), controlField: probe.controlField };
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
// between its controlling boolean field = false vs true. The compiler reads this
// table (no headless-ui import in production src/**) to emit reactive
// data-bind:<attr> derives for primitive-owned attributes automatically.
`;

const body = `
/** One reactive attribute the compiler should bind from the controlling boolean. */
export interface PrimitiveReactiveAttr {
  /** True when the attribute's presence (not its value) is the reactive signal. */
  readonly booleanPresence: boolean;
  /** Serialized attribute value when the controlling field is false. */
  readonly whenFalse: boolean | string;
  /** Serialized attribute value when the controlling field is true. */
  readonly whenTrue: boolean | string;
}

/** All reactive attributes a primitive derives from one boolean control field. */
export interface PrimitiveReactiveAttrEntry {
  readonly attrs: Readonly<Record<string, PrimitiveReactiveAttr>>;
  /** Name of the boolean state field these attributes are derived from. */
  readonly controlField: string;
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
