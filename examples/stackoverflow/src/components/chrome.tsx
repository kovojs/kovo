/** @jsxImportSource @kovojs/server */
import { csrfField } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { soCsrf, voteUpMutation } from '../mutations.js';
import type { SoRequest } from '../model.js';

// Shared page chrome and small rendering helpers for the StackOverflow demo.

const chromeStyles = style.create(
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
  { namespace: 'stackoverflow-chrome', source: 'examples/stackoverflow/src/components/chrome.tsx' },
);

export const soChromeStyleCss = style.emitAtomicCss(
  Object.values(chromeStyles).flatMap((entry) => entry.__rules ?? []),
);

// The demo uses text ids for posted questions and answers.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Two-letter initials from an author display name (e.g. "Priya Nair" → "PN"),
// used as the AvatarFallback content. Falls back to the first character.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// A compact, dependency-free "relative time" label from an ISO timestamp. The
// demo data is timestamped near 2026-06-16, so this reads as "today / 2d ago".
const SO_NOW = Date.parse('2026-06-17T00:00:00Z');
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!iso || Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((SO_NOW - then) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** Parse the comma-separated `tags` column into a trimmed, non-empty list. */
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Render a row of tags as neutral @kovojs/ui Badges. */
export function renderTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return (
    <div style={chromeStyles.tagRow}>
      {tags.map((tag) => Badge.definition.render({ variant: 'neutral', children: tag }))}
    </div>
  );
}

/**
 * Render an author byline: a small avatar (initials fallback) + name and an
 * optional relative timestamp. Used on question and answer cards.
 */
export function renderAuthor(name: string, iso: string | undefined, verb: string): string {
  const avatar = Avatar.definition.render({
    label: name,
    children: AvatarFallback.definition.render({ children: initials(name) }),
    styles: { root: chromeStyles.authorAvatar },
  });
  const when = iso ? relativeTime(iso) : '';
  return (
    <div style={chromeStyles.byline}>
      {avatar}
      <span style={chromeStyles.bylineName}>{name}</span>
      <span style={chromeStyles.bylineMeta}>
        {verb}
        {when ? ` · ${when}` : ''}
      </span>
    </div>
  );
}

// Native upvote form. The score stays as a sole text child so the generated
// binding can update it directly.
export function voteButton(questionId: string, value: number, request?: SoRequest): string {
  return (
    <form enhance mutation={voteUpMutation} key={questionId} style={chromeStyles.voteForm}>
      {request ? csrfField(request, soCsrf) : ''}
      <input type="hidden" name="id" value={`vote-${questionId}`} />
      <input type="hidden" name="targetId" value={questionId} />
      <input type="hidden" name="userId" value="demo-viewer" />
      <button type="submit" aria-label="Upvote" style={chromeStyles.voteButton}>
        <span style={chromeStyles.voteCaret}>&#9650;</span>
        <span style={chromeStyles.voteScore}>{value}</span>
        <span style={chromeStyles.voteLabel}>votes</span>
      </button>
    </form>
  );
}

export function SoShell({ children }: { children?: unknown }): string {
  return (
    <div style={chromeStyles.appRoot}>
      <header style={chromeStyles.header}>
        <div style={chromeStyles.headerInner}>
          <a href="/" style={chromeStyles.brand}>
            <span style={chromeStyles.brandMark}>DO</span>
            <span style={chromeStyles.brandName}>DevOverflow</span>
          </a>
          <nav style={chromeStyles.nav}>
            <a href="/" style={[chromeStyles.navLink, chromeStyles.navLinkActive]}>
              Questions
            </a>
            <a href="/" style={chromeStyles.navLink}>
              Tags
            </a>
            <a href="/" style={chromeStyles.navLink}>
              Users
            </a>
          </nav>
        </div>
      </header>
      <main style={chromeStyles.main}>{children}</main>
    </div>
  );
}
