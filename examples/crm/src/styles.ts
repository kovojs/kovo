import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

export const crmStyles = style.create(
  {
    appRoot: {
      backgroundColor: tokens.sys.color.surface,
      color: tokens.sys.color.onSurface,
      minHeight: '100vh',
    },
    backLink: {
      alignItems: 'center',
      color: tokens.sys.color.onSurfaceVariant,
      display: 'inline-flex',
      fontSize: 14,
      gap: 4,
      textDecoration: 'none',
      ':hover': {
        color: tokens.sys.color.onSurface,
      },
    },
    brand: {
      alignItems: 'center',
      color: tokens.sys.color.onSurface,
      display: 'flex',
      fontSize: 14,
      fontWeight: 600,
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
      fontWeight: 700,
      height: 28,
      placeItems: 'center',
      width: 28,
    },
    card: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      padding: 24,
    },
    dividerTop: {
      borderColor: tokens.sys.color.outlineVariant,
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      paddingTop: 16,
    },
    formGridContacts: {
      display: 'grid',
      gap: 8,
      '@media (min-width: 640px)': {
        alignItems: 'start',
        gridTemplateColumns: '1fr 1fr auto',
      },
    },
    formGridDeals: {
      display: 'grid',
      gap: 8,
      '@media (min-width: 640px)': {
        alignItems: 'start',
        gridTemplateColumns: '1fr auto 1fr auto',
      },
    },
    formPanel: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      padding: 16,
    },
    header: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderBottomColor: tokens.sys.color.outlineVariant,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
    },
    headerInner: {
      alignItems: 'center',
      display: 'flex',
      justifyContent: 'space-between',
      marginInline: 'auto',
      maxWidth: 1024,
      paddingBlock: 16,
      paddingInline: 24,
    },
    heading: {
      color: tokens.sys.color.onSurface,
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: 0,
      lineHeight: 1.25,
      margin: 0,
    },
    input: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerSmall,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: tokens.sys.color.onSurface,
      fontSize: 14,
      paddingBlock: 8,
      paddingInline: 12,
      width: '100%',
    },
    main: {
      marginInline: 'auto',
      maxWidth: 1024,
      paddingBlock: 32,
      paddingInline: 24,
    },
    muted: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
    },
    nav: {
      alignItems: 'center',
      display: 'flex',
      fontSize: 14,
      gap: 4,
    },
    navLink: {
      borderRadius: tokens.sys.shape.cornerMedium,
      fontWeight: 500,
      paddingBlock: 6,
      paddingInline: 12,
      textDecoration: 'none',
    },
    navLinkActive: {
      backgroundColor: tokens.sys.color.primary,
      color: tokens.sys.color.onPrimary,
    },
    navLinkInactive: {
      color: tokens.sys.color.onSurfaceVariant,
      ':hover': {
        backgroundColor: tokens.sys.color.surfaceContainer,
        color: tokens.sys.color.onSurface,
      },
    },
    row: {
      alignItems: 'center',
      display: 'flex',
      gap: 12,
    },
    rowBetween: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
    },
    sectionLabel: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: '0.025em',
      marginBlockEnd: 12,
      textTransform: 'uppercase',
    },
    stack: {
      display: 'grid',
      gap: 24,
    },
    stackLg: {
      display: 'grid',
      gap: 32,
    },
    stackSm: {
      display: 'grid',
      gap: 4,
    },
    stageButton: {
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerSmall,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
      fontWeight: 500,
      paddingBlock: 6,
      paddingInline: 12,
      textTransform: 'capitalize',
      ':hover': {
        backgroundColor: tokens.sys.color.surfaceContainer,
      },
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.4,
      },
    },
    stageButtonActive: {
      backgroundColor: tokens.sys.color.primary,
      borderColor: tokens.sys.color.primary,
      color: tokens.sys.color.onPrimary,
      cursor: 'default',
    },
    stageText: {
      textTransform: 'capitalize',
    },
    tabular: {
      fontVariantNumeric: 'tabular-nums',
    },
    tabularStrong: {
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
    },
  },
  { namespace: 'crm', source: 'examples/crm/src/styles.ts' },
);

export const crmStyleCss = style.emitAtomicCss(
  Object.values(crmStyles).flatMap((entry) => entry.__rules ?? []),
);
