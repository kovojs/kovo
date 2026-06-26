import { dataOrientation, type PrimitiveDataAttributes } from '../lib/index.js';

/**
 * Public type used by the Separator primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SeparatorOrientation } from '@kovojs/headless-ui/separator';
 *
 * const value: SeparatorOrientation = {} as SeparatorOrientation;
 * ```
 */
export type SeparatorOrientation = 'horizontal' | 'vertical';

/**
 * Options accepted by the Separator primitive separator attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SeparatorAttributeOptions } from '@kovojs/headless-ui/separator';
 *
 * const value: SeparatorAttributeOptions = {} as SeparatorAttributeOptions;
 * ```
 */
export interface SeparatorAttributeOptions {
  decorative?: boolean;
  orientation?: SeparatorOrientation;
}

/**
 * Serializable attribute record returned by Separator primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SeparatorPrimitiveAttributes } from '@kovojs/headless-ui/separator';
 *
 * const value: SeparatorPrimitiveAttributes = {} as SeparatorPrimitiveAttributes;
 * ```
 */
export type SeparatorPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, string>>;

/**
 * Builds the separator root attributes record for the Separator primitive.
 *
 * Emits `aria-orientation`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { separatorRootAttributes } from '@kovojs/headless-ui/separator';
 *
 * const input = {} as Parameters<typeof separatorRootAttributes>[0];
 * const result = separatorRootAttributes(input);
 * ```
 */
export function separatorRootAttributes(
  options: SeparatorAttributeOptions = {},
): SeparatorPrimitiveAttributes {
  const orientation = options.orientation ?? 'horizontal';

  if (options.decorative ?? true) {
    return Object.freeze({
      ...dataOrientation(orientation),
      role: 'none',
    });
  }

  return Object.freeze({
    ...dataOrientation(orientation),
    'aria-orientation': orientation,
    role: 'separator',
  });
}
