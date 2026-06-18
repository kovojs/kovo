import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

export const soStyles = style.create(
  {
    appRoot: {
      backgroundColor: tokens.sys.color.surface,
      color: tokens.sys.color.onSurface,
      minHeight: '100vh',
    },
    authorAvatar: {
      fontSize: 12,
      height: 28,
      width: 28,
    },
    byline: {
      alignItems: 'center',
      color: tokens.sys.color.onSurfaceVariant,
      display: 'flex',
      fontSize: 12,
      gap: 8,
    },
    bylineMeta: {
      color: tokens.sys.color.outline,
    },
    bylineName: {
      color: tokens.sys.color.onSurfaceVariant,
      fontWeight: 500,
    },
    brand: {
      alignItems: 'center',
      color: tokens.sys.color.onSurface,
      display: 'inline-flex',
      fontWeight: 700,
      gap: 8,
      letterSpacing: 0,
      textDecoration: 'none',
    },
    brandMark: {
      backgroundColor: tokens.sys.color.primary,
      borderRadius: tokens.sys.shape.cornerMedium,
      color: tokens.sys.color.onPrimary,
      display: 'grid',
      fontSize: 12,
      fontWeight: 800,
      height: 30,
      placeItems: 'center',
      width: 30,
    },
    brandName: {
      fontSize: 16,
    },
    header: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderBottomColor: tokens.sys.color.outlineVariant,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      position: 'sticky',
      top: 0,
      zIndex: 10,
    },
    headerInner: {
      alignItems: 'center',
      display: 'flex',
      justifyContent: 'space-between',
      marginInline: 'auto',
      maxWidth: 832,
      paddingBlock: 14,
      paddingInline: 24,
    },
    main: {
      marginInline: 'auto',
      maxWidth: 832,
      paddingBlock: 32,
      paddingInline: 24,
    },
    nav: {
      alignItems: 'center',
      display: 'flex',
      gap: 4,
    },
    navLink: {
      borderRadius: tokens.sys.shape.cornerMedium,
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
      fontWeight: 500,
      paddingBlock: 6,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': {
        backgroundColor: tokens.sys.color.surfaceContainer,
        color: tokens.sys.color.onSurface,
      },
    },
    navLinkActive: {
      backgroundColor: tokens.sys.color.primaryContainer,
      color: tokens.sys.color.onPrimaryContainer,
    },
    tagRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
    },
    voteButton: {
      alignItems: 'center',
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onSurfaceVariant,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 52,
      paddingBlock: 8,
      paddingInline: 6,
      ':hover': {
        borderColor: tokens.sys.color.primary,
        color: tokens.sys.color.primary,
      },
    },
    voteCaret: {
      color: tokens.sys.color.primary,
      fontSize: 14,
      lineHeight: 1,
    },
    voteForm: {
      flexShrink: 0,
    },
    voteLabel: {
      fontSize: 11,
    },
    voteScore: {
      color: tokens.sys.color.onSurface,
      fontSize: 18,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
      lineHeight: 1.1,
    },
  },
  { namespace: 'stackoverflow', source: 'examples/stackoverflow/src/styles.ts' },
);

export const soStyleCss = style.emitAtomicCss(
  Object.values(soStyles).flatMap((entry) => entry.__rules ?? []),
);
