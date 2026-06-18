import { tokens } from '@kovojs/style';

const color = tokens.sys.color;
const shape = tokens.sys.shape;

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
      background: color.secondaryContainer,
      border: color.secondary,
      foreground: color.onSecondaryContainer,
    },
    warning: {
      background: color.tertiaryContainer,
      border: color.tertiary,
      foreground: color.onTertiaryContainer,
    },
  },
  radius: {
    sm: shape.cornerSmall,
    md: shape.cornerMedium,
    lg: shape.cornerLarge,
    full: shape.cornerFull,
  },
} as const);
