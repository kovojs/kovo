import { defineTheme } from '@kovojs/style';

export const contactTheme = defineTheme({
  colors: {
    success: '#047857',
  },
  seed: '#2563eb',
  shape: {
    cornerMedium: '8px',
  },
});

export const contactThemeCss = contactTheme.css;
