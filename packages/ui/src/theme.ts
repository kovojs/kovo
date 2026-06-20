import { tokens } from '@kovojs/style';

const color = tokens.sys.color;
const shape = tokens.sys.shape;

// `success`/`warning` reference the app-defined Material custom-color roles (from
// `defineTheme({ colors })`) so the styled UI renders true semantic green/amber, with a
// CSS fallback to the guaranteed M3 system role when the app has not defined them. These
// MUST be static string literals (not a helper call) so the compiler's package-css
// extraction can statically resolve every consumer's identity. SPEC.md §13.1, §6.1.1.
export const uiTheme = Object.freeze({
  color: {
    accent: color.primary,
    accentBorder: color.primary,
    accentHover: color.primaryContainer,
    accentForeground: color.onPrimary,
    background: color.surface,
    backgroundInverse: color.inverseSurface,
    backgroundRaised: color.surfaceContainerLow,
    backgroundSubtle: color.surfaceContainer,
    backgroundSubtleHigh: color.surfaceContainerHigh,
    backgroundMuted: color.surfaceContainerHighest,
    border: color.outlineVariant,
    borderStrong: color.outline,
    foregroundInverse: color.inverseOnSurface,
    foreground: color.onSurface,
    foregroundMuted: color.onSurfaceVariant,
    danger: {
      background: color.errorContainer,
      border: color.error,
      foreground: color.onErrorContainer,
    },
    info: {
      background: color.primaryContainer,
      border: color.primary,
      foreground: color.onPrimaryContainer,
    },
    success: {
      background:
        'var(--kovo-theme-custom-success-color-container, var(--kovo-theme-sys-color-secondary-container))',
      border: 'var(--kovo-theme-custom-success-color, var(--kovo-theme-sys-color-secondary))',
      foreground:
        'var(--kovo-theme-custom-success-on-color-container, var(--kovo-theme-sys-color-on-secondary-container))',
    },
    warning: {
      background:
        'var(--kovo-theme-custom-warning-color-container, var(--kovo-theme-sys-color-tertiary-container))',
      border: 'var(--kovo-theme-custom-warning-color, var(--kovo-theme-sys-color-tertiary))',
      foreground:
        'var(--kovo-theme-custom-warning-on-color-container, var(--kovo-theme-sys-color-on-tertiary-container))',
    },
  },
  radius: {
    sm: shape.cornerSmall,
    md: shape.cornerMedium,
    lg: shape.cornerLarge,
    full: shape.cornerFull,
  },
  shadow: {
    focusRing: '0 0 0 2px var(--kovo-theme-sys-color-outline)',
    focusRingInset: 'inset 0 0 0 2px var(--kovo-theme-sys-color-outline)',
  },
} as const);
