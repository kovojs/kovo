import { describe, expect, it } from 'vitest';

import { defineVariants, variantClassNames } from './variants.js';

const buttonVariants = {
  base: 'inline-flex items-center justify-center rounded-md font-medium',
  variants: {
    tone: {
      neutral: 'bg-background text-foreground border border-input',
      primary: 'bg-primary text-primary-foreground',
    },
    size: {
      sm: 'h-8 px-3 text-sm',
      md: 'h-10 px-4 text-sm',
    },
  },
  defaultVariants: {
    tone: 'neutral',
    size: 'md',
  },
  compoundVariants: [
    {
      tone: 'primary',
      size: 'sm',
      class: 'shadow-sm',
    },
  ],
} as const;

describe('defineVariants', () => {
  it('selects default and requested variant classes from explicit strings', () => {
    const button = defineVariants(buttonVariants);

    expect(button()).toBe(
      'inline-flex items-center justify-center rounded-md font-medium bg-background text-foreground border border-input h-10 px-4 text-sm',
    );
    expect(button({ tone: 'primary', size: 'sm' })).toBe(
      'inline-flex items-center justify-center rounded-md font-medium bg-primary text-primary-foreground h-8 px-3 text-sm shadow-sm',
    );
  });

  it('appends author classes after selected variant classes', () => {
    const button = defineVariants(buttonVariants);

    expect(button({ tone: 'primary', className: 'w-full text-sm' })).toBe(
      'inline-flex items-center justify-center rounded-md font-medium bg-primary text-primary-foreground h-10 px-4 text-sm w-full',
    );
  });

  it('exposes all possible class strings for safelist and evidence checks', () => {
    const button = defineVariants(buttonVariants);

    expect(button.classes).toEqual([
      'inline-flex items-center justify-center rounded-md font-medium',
      'bg-background text-foreground border border-input',
      'bg-primary text-primary-foreground',
      'h-8 px-3 text-sm',
      'h-10 px-4 text-sm',
      'shadow-sm',
    ]);
    expect(variantClassNames(buttonVariants)).toEqual(button.classes);
  });
});
