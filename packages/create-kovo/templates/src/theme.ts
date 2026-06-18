import { defineTheme } from '@kovojs/style';

export const starterTheme = defineTheme({
  seed: '#0f8b8d',
  colors: {
    success: '#047857',
  },
  shape: {
    cornerMedium: '6px',
  },
});

export const starterThemeCss = starterTheme.css;
