const blockedProps = new Set([
  'activeValue',
  'actionValue',
  'autoFocus',
  'children',
  'checked',
  'collapsible',
  'contentId',
  'controlId',
  'current',
  'describedBy',
  'descriptionId',
  'disabled',
  'dismissible',
  'form',
  'forceMount',
  'highlighted',
  'highlightedValue',
  'href',
  'id',
  'invalid',
  'items',
  'itemDisabled',
  'itemValue',
  'label',
  'labelledBy',
  'level',
  'max',
  'min',
  'name',
  'open',
  'orientation',
  'placement',
  'politeness',
  'pressed',
  'required',
  'scrollbars',
  'scrollX',
  'scrollY',
  'side',
  'size',
  'state',
  'style',
  'styles',
  'titleId',
  'triggerId',
  'type',
  'value',
  'valueText',
  'variant',
]);

// Island-ownership markers. SPEC.md §4.6: exactly one element per island may
// carry these (a duplicate is KV231). They belong on the component's single
// root element; forwarding them to a nested element (e.g. a wrapped <input>)
// would split the reactive scope so only that element's bindings re-render.
const islandOwnershipProps = new Set(['kovo-c', 'kovo-state', 'kovo-deps']);

export interface PassThroughOptions {
  events?: boolean;
  style?: boolean;
  // When false, drop island-ownership markers (kovo-c/kovo-state/kovo-deps) so
  // the element does NOT become a second island host. Use on inner elements
  // (the root element keeps them). data-bind:* reactive stamps are retained.
  island?: boolean;
  // When false, drop reactive binding stamps (`data-bind:*` / `data-bind-prop:*`).
  // SPEC.md §4.6/§4.8: the compiler emits primitive-owned reactive attributes
  // (aria-checked / checked / data-state) and live-property stamps
  // (data-bind-prop:checked / :indeterminate) on the component CALL SITE. Those
  // belong on the underlying control (e.g. the native <input>), NOT on a wrapper
  // <label>: a `data-bind:aria-checked` applied to a roleless <label> sets a real
  // `aria-checked` the browser/axe rejects (aria-allowed-attr). Use this on the
  // wrapper element and route the control's stamps via the inner element's
  // passThroughProps (and the box's bindingProps for data-state) instead.
  bindings?: boolean;
}

export function passThroughProps(
  props: object,
  options: PassThroughOptions = {},
): Record<string, unknown> {
  const includeEvents = options.events ?? true;
  const includeStyle = options.style ?? false;
  const includeIsland = options.island ?? true;
  const includeBindings = options.bindings ?? true;

  return Object.fromEntries(
    Object.entries(props).filter(([name, value]) => {
      const isEvent = name.startsWith('on:');
      const isBindingStamp = name.startsWith('data-bind:') || name.startsWith('data-bind-prop:');
      const isAllowedDomProp =
        isEvent ||
        name.startsWith('aria-') ||
        (name.startsWith('data-') && name !== 'data-style-src') ||
        name.startsWith('kovo-') ||
        name === 'hidden' ||
        name === 'tabIndex' ||
        name === 'style';

      return (
        value !== undefined &&
        value !== null &&
        isAllowedDomProp &&
        (includeEvents || !isEvent) &&
        (includeStyle || name !== 'style') &&
        (includeIsland || !islandOwnershipProps.has(name)) &&
        (includeBindings || !isBindingStamp) &&
        !blockedProps.has(name)
      );
    }),
  );
}

// Forward only the compiler-emitted reactive binding stamps (`data-bind:*` and
// the live-property `data-bind-prop:*`, SPEC §4.8) so a decorative child (a switch
// thumb/track, checkbox box, radio dot) re-renders its state-derived attributes
// client-side. The compiler emits these on the component call site (e.g.
// data-bind:data-state); a static SSR value on the child stays the initial paint
// and the stamp keeps it live. Pass `attrs` to limit which base attributes (e.g.
// ['data-state', 'checked']) are forwarded — both binding-attribute and
// live-property stamps for those bases are forwarded.
export function bindingProps(props: object, attrs?: readonly string[]): Record<string, unknown> {
  const allow = attrs
    ? new Set(attrs.flatMap((name) => [`data-bind:${name}`, `data-bind-prop:${name}`]))
    : null;
  return Object.fromEntries(
    Object.entries(props).filter(
      ([name, value]) =>
        value !== undefined &&
        value !== null &&
        (name.startsWith('data-bind:') || name.startsWith('data-bind-prop:')) &&
        (allow === null || allow.has(name)),
    ),
  );
}
