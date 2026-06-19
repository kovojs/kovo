// SPEC.md §4.6 (KV232): @kovojs/ui components forward a reactive boolean control
// prop (e.g. `checked`, `open`, `pressed`) to a headless primitive that derives
// the matching state attributes (aria-checked / aria-pressed / aria-expanded /
// data-state / hidden / checked ...). The compiler makes those attributes
// reactive automatically so gallery demos never hand-write them.
//
// This registry maps each @kovojs/ui component export name to the primitive
// attribute key it delegates to (see src/generated/primitive-reactive-attrs.ts)
// plus the boolean control prop the author passes. The prop name equals the
// primitive's control field (confirmed by the gallery demos). Non-boolean
// controls (e.g. Accordion's `value`) are out of scope and intentionally absent.

/** @internal How one @kovojs/ui component maps to a reactive primitive entry. */
export interface PrimitiveReactiveComponent {
  /** Boolean prop the author passes (e.g. `checked`, `open`, `pressed`). */
  readonly controlProp: string;
  /** Key into the generated reactive-attr manifest (e.g. `switch.root`). */
  readonly primitiveKey: string;
}

/**
 * @internal @kovojs/ui component export name → reactive primitive mapping.
 * Only components whose control prop is a single boolean are listed; the
 * generated manifest's `controlField` must match `controlProp`.
 */
export const primitiveReactiveComponents: Readonly<Record<string, PrimitiveReactiveComponent>> = {
  Collapsible: { controlProp: 'open', primitiveKey: 'collapsible.root' },
  CollapsibleContent: { controlProp: 'open', primitiveKey: 'collapsible.content' },
  CollapsibleTrigger: { controlProp: 'open', primitiveKey: 'collapsible.trigger' },
  Dialog: { controlProp: 'open', primitiveKey: 'dialog.root' },
  DialogClose: { controlProp: 'open', primitiveKey: 'dialog.close' },
  DialogContent: { controlProp: 'open', primitiveKey: 'dialog.content' },
  Disclosure: { controlProp: 'open', primitiveKey: 'disclosure.root' },
  DisclosureContent: { controlProp: 'open', primitiveKey: 'disclosure.content' },
  DisclosureTrigger: { controlProp: 'open', primitiveKey: 'disclosure.trigger' },
  Switch: { controlProp: 'checked', primitiveKey: 'switch.root' },
  Toggle: { controlProp: 'pressed', primitiveKey: 'toggle.root' },
  Tooltip: { controlProp: 'open', primitiveKey: 'tooltip.root' },
  TooltipContent: { controlProp: 'open', primitiveKey: 'tooltip.content' },
  TooltipTrigger: { controlProp: 'open', primitiveKey: 'tooltip.trigger' },
};

/**
 * @internal True when a module specifier resolves to the public @kovojs/ui
 * surface (`@kovojs/ui` or `@kovojs/ui/<entry>`), the only modules whose exports
 * own primitive-derived reactive attributes.
 */
export function isKovoUiModuleSpecifier(specifier: string): boolean {
  return specifier === '@kovojs/ui' || specifier.startsWith('@kovojs/ui/');
}
