import { cn, type ClassValue } from './class-names.js';

export type VariantClass = string;
export type VariantValues = Readonly<Record<string, VariantClass>>;
export type VariantGroups = Readonly<Record<string, VariantValues>>;
export type VariantSelection<Variants extends VariantGroups> = {
  readonly [Name in keyof Variants]?: keyof Variants[Name] | null | undefined;
};
export type VariantCompound<Variants extends VariantGroups> = VariantSelection<Variants> & {
  readonly class: VariantClass;
};
export type VariantDefinition<Variants extends VariantGroups> = {
  readonly base?: VariantClass;
  readonly variants: Variants;
  readonly defaultVariants?: VariantSelection<Variants>;
  readonly compoundVariants?: readonly VariantCompound<Variants>[];
};
export type VariantOptions<Variants extends VariantGroups> = VariantSelection<Variants> & {
  readonly class?: ClassValue;
  readonly className?: ClassValue;
};
export type VariantFn<Variants extends VariantGroups> = {
  (options?: VariantOptions<Variants>): string;
  readonly classes: readonly VariantClass[];
};

function variantClasses<Variants extends VariantGroups>(
  definition: VariantDefinition<Variants>,
): readonly VariantClass[] {
  const classes: VariantClass[] = [];
  if (definition.base) classes.push(definition.base);

  for (const values of Object.values(definition.variants)) {
    classes.push(...Object.values(values));
  }

  for (const compound of definition.compoundVariants ?? []) {
    classes.push(compound.class);
  }

  return Object.freeze(classes.filter(Boolean));
}

function compoundMatches<Variants extends VariantGroups>(
  compound: VariantCompound<Variants>,
  selection: VariantSelection<Variants>,
): boolean {
  for (const key of Object.keys(compound)) {
    if (key === 'class') continue;
    const name = key as keyof Variants;
    if (compound[name] != null && selection[name] !== compound[name]) return false;
  }

  return true;
}

export function defineVariants<Variants extends VariantGroups>(
  definition: VariantDefinition<Variants>,
): VariantFn<Variants> {
  const classes = variantClasses(definition);

  // SPEC.md §13.1 requires Tailwind utility classes to stay statically discoverable:
  // this helper only selects explicit strings from the variant definition.
  const variantFn = ((options: VariantOptions<Variants> = {}) => {
    const selection = { ...definition.defaultVariants, ...options } as VariantSelection<Variants>;
    const selected: ClassValue[] = [definition.base];

    for (const [name, values] of Object.entries(definition.variants)) {
      const value = selection[name as keyof Variants] as string | null | undefined;
      if (value != null) selected.push(values[value]);
    }

    for (const compound of definition.compoundVariants ?? []) {
      if (compoundMatches(compound, selection)) selected.push(compound.class);
    }

    selected.push(options.class, options.className);
    return cn(...selected);
  }) as VariantFn<Variants>;

  Object.defineProperty(variantFn, 'classes', {
    enumerable: true,
    value: classes,
  });

  return variantFn;
}

export function variantClassNames<Variants extends VariantGroups>(
  definition: VariantDefinition<Variants>,
): readonly VariantClass[] {
  return variantClasses(definition);
}
