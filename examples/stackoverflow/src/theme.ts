import { defineTheme } from '@kovojs/style';

export const soTheme = defineTheme({
  seed: '#f97316',
  colors: {
    accepted: '#047857',
    reputation: '#2563eb',
  },
  shape: {
    cornerMedium: '8px',
    cornerSmall: '6px',
  },
});

export const soThemeCss = soTheme.css;
