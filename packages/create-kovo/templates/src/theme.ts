import { defineTheme } from '@kovojs/style';

// Retheme the whole app from here. `seed` drives the Material color roles; custom
// `colors` add semantic roles (`success` powers @kovojs/ui's success variants).
export const appTheme = defineTheme({
  seed: '#0f8b8d',
  colors: {
    success: '#047857',
  },
  shape: {
    cornerMedium: '8px',
    cornerSmall: '6px',
  },
});

export const appThemeCss = appTheme.css;
