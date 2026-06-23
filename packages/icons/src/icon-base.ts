import * as style from '@kovojs/style';

/**
 * Props accepted by every `@kovojs/icons` icon. Size and color are controlled
 * through the StyleX `style` channel — set `width`/`height` to size and `color`
 * to tint (the stroke uses `currentColor`); there is no `size` prop. Icons render
 * decorative (`aria-hidden="true"`) unless given an `aria-label`/`title`, which
 * promotes them to `role="img"`. See SPEC.md §3 (ARIA author-wins) and §4.6
 * (attribute merge).
 */
export interface IconProps {
  /** StyleX style applied to the root `<svg>`: `width`/`height` size it, `color` tints it. */
  style?: style.StyleInput;
  /** Extra class name, concatenated after the StyleX-generated class (SPEC.md §4.6). */
  class?: string;
  /** `id` forwarded to the root `<svg>` for targeting (there is no React `ref`; SPEC.md §4.5). */
  id?: string;
  /** Accessible name; when set (or `title`) the icon is exposed as `role="img"` instead of decorative. */
  'aria-label'?: string;
  /** Tooltip / accessible title; also promotes the icon from decorative to `role="img"`. */
  title?: string;
  /** Explicit ARIA role override (author-wins, SPEC.md §3). */
  role?: string;
  /** Forwarded ARIA state / relationship attributes. */
  [ariaAttr: `aria-${string}`]: unknown;
  /** Forwarded `data-*` attributes. */
  [dataAttr: `data-${string}`]: unknown;
}

/** Opaque non-string value returned by generated icon components (SPEC §4.1). */
export type IconRenderResult = object;

/**
 * Lucide's default root `<svg>` attributes. Emitted verbatim (kebab-case, not
 * React camelCase) because the Kovo scanner/runtime read attribute names as
 * authored (SPEC.md §4.2; packages/compiler/src/scan/parse.ts).
 */
const DEFAULT_ATTRS: Record<string, unknown> = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Merge an icon's default `<svg>` attributes with consumer props. Order follows
 * SPEC.md §4.6 (scalars are author-wins; `class` concatenates): defaults → a11y
 * default → StyleX attrs → forwarded `aria-*`/`data-*`/`id`/`role`/`title` →
 * concatenated `class`. An icon is treated as meaningful (gets `role="img"`,
 * drops `aria-hidden`) when it carries an `aria-label`, `title`, or explicit
 * `role`; otherwise it is decorative.
 */
export function iconRootAttrs(props: IconProps): Record<string, unknown> {
  const meaningful =
    isNonEmptyString(props['aria-label']) ||
    isNonEmptyString(props.title) ||
    isNonEmptyString(props.role);

  const a11y: Record<string, unknown> = meaningful
    ? props.role === undefined
      ? { role: 'img' }
      : {}
    : { 'aria-hidden': 'true', focusable: 'false' };

  const styled = props.style ? style.attrs(props.style) : {};

  const forwarded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (
      name.startsWith('aria-') ||
      name.startsWith('data-') ||
      name === 'id' ||
      name === 'role' ||
      name === 'title'
    ) {
      forwarded[name] = value;
    }
  }

  const merged: Record<string, unknown> = {
    ...DEFAULT_ATTRS,
    ...a11y,
    ...styled,
    ...forwarded,
  };

  const classes = [(styled as { class?: string }).class, props.class].filter(Boolean);
  if (classes.length > 0) merged.class = classes.join(' ');
  return merged;
}
