import { defineTheme } from '@kovojs/style';

export const commerceTheme = defineTheme({
  seed: '#0f766e',
  colors: {
    danger: '#b91c1c',
    success: '#047857',
  },
  shape: {
    cornerMedium: '6px',
    cornerSmall: '4px',
  },
});

export const commerceThemeCss = commerceTheme.css;
