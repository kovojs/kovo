import { defineTheme } from '@kovojs/style';

// Stack Overflow's palette: an orange brand seed (the logo + the top hairline),
// with the accent colors the components apply directly via the `so` palette in
// components/chrome.tsx. The generated theme custom properties back the base
// surface/onSurface tokens that styles.css :root references.
export const soTheme = defineTheme({
  seed: '#f48024',
  colors: {
    accepted: '#48a868',
    reputation: '#0074cc',
  },
  shape: {
    cornerMedium: '6px',
    cornerSmall: '4px',
  },
});

export const soThemeCss = soTheme.css;
