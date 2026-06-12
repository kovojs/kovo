import { dataOrientation, type PrimitiveDataAttributes } from '../lib/index.js';

export type SeparatorOrientation = 'horizontal' | 'vertical';

export interface SeparatorAttributeOptions {
  decorative?: boolean;
  orientation?: SeparatorOrientation;
}

export type SeparatorPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, string>>;

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
