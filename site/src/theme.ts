import { defineTheme } from '@kovojs/style';

export const siteTheme = defineTheme({
  seed: '#0f766e',
  darkSelector: 'html.dark',
  colors: {
    danger: '#b91c1c',
    success: '#15803d',
  },
  shape: {
    cornerMedium: '6px',
    cornerSmall: '4px',
  },
});

export const siteThemeCss = siteTheme.css;
