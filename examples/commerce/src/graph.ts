import { commerceStyleCss } from './styles.js';
import { commerceThemeCss } from './theme.js';

export interface CommerceGraphCartSummary {
  count: number;
}

export const commerceStylesheetHrefs = ['/assets/styles.css'] as const;
export const commerceStylesheets = [
  {
    criticalCss: `${commerceThemeCss}\n${commerceStyleCss}`,
    href: '/assets/styles.css',
  },
] as const;

export function commerceCartPageMeta(cart: CommerceGraphCartSummary) {
  return {
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Kovo Commerce (${cart.count})`,
  };
}
