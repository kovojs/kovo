import { tokens } from '@kovojs/style';

const color = tokens.sys.color;
const shape = tokens.sys.shape;

// Reference an app-defined Material custom-color role (from `defineTheme({ colors })`),
// falling back to a guaranteed M3 system role when the app has not defined it. Lets the
// styled UI render true semantic green/amber status while staying backward compatible.
// SPEC.md §13.1.
const customColor = (name: string, role: string, fallback: string): string =>
  `var(--kovo-theme-custom-${name}-${role}, ${fallback})`;

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
      background: customColor('success', 'color-container', color.secondaryContainer),
      border: customColor('success', 'color', color.secondary),
      foreground: customColor('success', 'on-color-container', color.onSecondaryContainer),
    },
    warning: {
      background: customColor('warning', 'color-container', color.tertiaryContainer),
      border: customColor('warning', 'color', color.tertiary),
      foreground: customColor('warning', 'on-color-container', color.onTertiaryContainer),
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
