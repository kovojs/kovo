// SPEC.md §4.6 (KV232): @kovojs/ui components forward a reactive control prop
// (e.g. `checked`, `open`, `pressed`, `value`) to a headless primitive that
// derives the matching state attributes (aria-checked / aria-pressed /
// aria-expanded / data-state / hidden / checked ...). The compiler makes those
// attributes reactive automatically so gallery demos never hand-write them.
//
// This registry maps each @kovojs/ui component export name to the primitive
// attribute key it delegates to (see src/generated/primitive-reactive-attrs.ts)
// plus the control prop the author passes. The prop name equals the primitive's
// control field (confirmed by the gallery demos).

/** @internal How one @kovojs/ui component maps to a reactive primitive entry. */
export interface PrimitiveReactiveComponent {
  /** Control prop the author passes (e.g. `checked`, `open`, `pressed`, `value`). */
  readonly controlProp: string;
  /** Key into the generated reactive-attr manifest (e.g. `switch.root`). */
  readonly primitiveKey: string;
}

/**
 * @internal @kovojs/ui component export name → reactive primitive mapping.
 * The generated manifest's `controlField` must match `controlProp`.
 */
export const primitiveReactiveComponents: Readonly<Record<string, PrimitiveReactiveComponent>> = {
  AccordionContent: { controlProp: 'value', primitiveKey: 'accordion.content' },
  AccordionHeader: { controlProp: 'value', primitiveKey: 'accordion.header' },
  AccordionItem: { controlProp: 'value', primitiveKey: 'accordion.item' },
  AccordionTrigger: { controlProp: 'value', primitiveKey: 'accordion.trigger' },
  Checkbox: { controlProp: 'checked', primitiveKey: 'checkbox.root' },
  Collapsible: { controlProp: 'open', primitiveKey: 'collapsible.root' },
  CollapsibleContent: { controlProp: 'open', primitiveKey: 'collapsible.content' },
  CollapsibleTrigger: { controlProp: 'open', primitiveKey: 'collapsible.trigger' },
  Dialog: { controlProp: 'open', primitiveKey: 'dialog.root' },
  DialogClose: { controlProp: 'open', primitiveKey: 'dialog.close' },
  DialogContent: { controlProp: 'open', primitiveKey: 'dialog.content' },
  Disclosure: { controlProp: 'open', primitiveKey: 'disclosure.root' },
  DisclosureContent: { controlProp: 'open', primitiveKey: 'disclosure.content' },
  DisclosureTrigger: { controlProp: 'open', primitiveKey: 'disclosure.trigger' },
  RadioGroupItem: { controlProp: 'value', primitiveKey: 'radio-group.item' },
  RadioGroupLabel: { controlProp: 'value', primitiveKey: 'radio-group.label' },
  RadioGroupRadio: { controlProp: 'value', primitiveKey: 'radio-group.radio' },
  Switch: { controlProp: 'checked', primitiveKey: 'switch.root' },
  Tabs: { controlProp: 'value', primitiveKey: 'tabs.root' },
  TabsList: { controlProp: 'value', primitiveKey: 'tabs.list' },
  TabsPanel: { controlProp: 'value', primitiveKey: 'tabs.panel' },
  TabsTrigger: { controlProp: 'value', primitiveKey: 'tabs.trigger' },
  Toggle: { controlProp: 'pressed', primitiveKey: 'toggle.root' },
  ToggleGroup: { controlProp: 'value', primitiveKey: 'toggle-group.root' },
  ToggleGroupButton: { controlProp: 'value', primitiveKey: 'toggle-group.button' },
  ToggleGroupItem: { controlProp: 'value', primitiveKey: 'toggle-group.item' },
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
