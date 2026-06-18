import { defineTheme } from '@kovojs/style';

export const crmTheme = defineTheme({
  seed: '#2563eb',
  colors: {
    deal: '#7c3aed',
    success: '#047857',
  },
  shape: {
    cornerMedium: '8px',
    cornerSmall: '6px',
  },
});

export const crmThemeCss = crmTheme.css;
