/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { voteUpMutation } from '../mutations.js';

// Shared page chrome (the Stack Overflow top bar + left sidebar) and the small
// rendering helpers — tag pills, user cards, the vote control, and the question
// stat rail — used across the question list and detail pages.

// Stack Overflow's actual palette. Components apply these hex values directly so
// the look matches the real site rather than the generated theme ramp.
export const so = {
  orange: '#f48024',
  bodyBg: '#f1f2f3',
  white: '#ffffff',
  surface: '#fdfdfd',
  border: '#e3e6e8',
  borderMed: '#d6d9dc',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  textLight: '#6a737c',
  link: '#0074cc',
  linkHover: '#0a95ff',
  blue: '#0a95ff',
  blueHover: '#0074cc',
  blueText: '#ffffff',
  tagBg: '#e1ecf4',
  tagText: '#39739d',
  tagBgHover: '#cee0ed',
  tagTextHover: '#2c5877',
  answeredBorder: '#2f6f44',
  answeredText: '#2f6f44',
  acceptedBg: '#5eba7d',
  acceptedBorder: '#48a868',
  acceptedText: '#3d8b5f',
  navActiveBg: '#f1f2f3',
  navHoverBg: '#e3e6e8',
} as const;

const chromeStyles = style.create(
  {
    appRoot: {
      backgroundColor: so.bodyBg,
      color: so.text,
      minHeight: '100vh',
    },
    // ---- Top bar -------------------------------------------------------------
    header: {
      backgroundColor: so.white,
      borderBottomColor: so.border,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      borderTopColor: so.orange,
      borderTopStyle: 'solid',
      borderTopWidth: 3,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 30,
    },
    headerInner: {
      alignItems: 'center',
      display: 'flex',
      gap: 0,
      height: 50,
      marginInline: 'auto',
      maxWidth: 1264,
      paddingInline: 12,
    },
    brand: {
      alignItems: 'center',
      borderRadius: 4,
      display: 'inline-flex',
      gap: 1,
      height: 47,
      paddingInline: 8,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.navActiveBg },
    },
    brandIcon: {
      display: 'block',
      height: 30,
      width: 26,
    },
    brandWordmark: {
      color: so.text,
      fontSize: 21,
      letterSpacing: '-0.1px',
      marginInlineStart: 2,
    },
    brandLight: { fontWeight: 400 },
    brandBold: { fontWeight: 600 },
    headerNav: {
      alignItems: 'center',
      display: 'flex',
      gap: 2,
      marginInlineStart: 6,
    },
    headerNavLink: {
      borderRadius: 1000,
      color: so.textMuted,
      fontSize: 13,
      paddingBlock: 8,
      paddingInline: 9,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.navActiveBg, color: so.textSecondary },
    },
    search: {
      flex: '1 1 0%',
      marginInline: 8,
      position: 'relative',
    },
    searchIcon: {
      color: so.textLight,
      height: 18,
      insetInlineStart: 9,
      pointerEvents: 'none',
      position: 'absolute',
      top: 9,
      width: 18,
    },
    searchInput: {
      backgroundColor: so.white,
      borderColor: so.borderMed,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.text,
      fontSize: 13,
      paddingBlock: 8,
      paddingInlineEnd: 12,
      paddingInlineStart: 34,
      width: '100%',
      ':focus': {
        borderColor: so.linkHover,
        boxShadow: '0 0 0 4px rgba(10,149,255,0.15)',
        outline: 'none',
      },
    },
    headerActions: {
      alignItems: 'center',
      display: 'flex',
      gap: 8,
      marginInlineStart: 6,
    },
    loginButton: {
      backgroundColor: '#e1ecf4',
      borderColor: '#7aa7c7',
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#39739d',
      fontSize: 13,
      paddingBlock: 8,
      paddingInline: 10,
      textDecoration: 'none',
      ':hover': { backgroundColor: '#b3d3ea' },
    },
    signupButton: {
      backgroundColor: so.blue,
      borderColor: so.blue,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.blueText,
      fontSize: 13,
      paddingBlock: 8,
      paddingInline: 10,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.blueHover },
    },
    // ---- Body layout ---------------------------------------------------------
    shell: {
      display: 'flex',
      marginInline: 'auto',
      maxWidth: 1264,
      width: '100%',
    },
    sidebar: {
      flexShrink: 0,
      paddingBlockStart: 24,
      paddingInlineEnd: 8,
      width: 164,
    },
    sidebarNav: {
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 56,
    },
    sidebarLink: {
      borderInlineStartColor: 'transparent',
      borderInlineStartStyle: 'solid',
      borderInlineStartWidth: 3,
      color: so.textMuted,
      fontSize: 13,
      paddingBlock: 8,
      paddingInlineEnd: 8,
      paddingInlineStart: 13,
      textDecoration: 'none',
      ':hover': { color: so.text },
    },
    sidebarLinkActive: {
      backgroundColor: so.white,
      borderInlineStartColor: so.orange,
      color: so.text,
      fontWeight: 600,
    },
    sidebarHeading: {
      color: so.textLight,
      fontSize: 11,
      fontWeight: 400,
      letterSpacing: '0.7px',
      paddingBlock: 8,
      paddingInlineStart: 8,
      textTransform: 'uppercase',
    },
    main: {
      backgroundColor: so.white,
      borderInlineStartColor: so.border,
      borderInlineStartStyle: 'solid',
      borderInlineStartWidth: 1,
      flex: '1 1 0%',
      minWidth: 0,
      paddingBlock: 24,
      paddingInline: 24,
    },
    // ---- Tag pills -----------------------------------------------------------
    tagRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
    },
    tag: {
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      display: 'inline-block',
      fontSize: 12,
      lineHeight: 1.5,
      paddingBlock: 4,
      paddingInline: 7,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.tagBgHover, color: so.tagTextHover },
    },
    // ---- User card -----------------------------------------------------------
    userCard: {
      alignItems: 'flex-start',
      color: so.textLight,
      display: 'flex',
      fontSize: 12,
      gap: 6,
      lineHeight: 1.4,
    },
    userAvatar: {
      backgroundColor: '#d6e0ea',
      borderRadius: 3,
      color: '#395b7a',
      display: 'grid',
      flexShrink: 0,
      fontSize: 11,
      fontWeight: 600,
      height: 22,
      placeItems: 'center',
      width: 22,
    },
    userMeta: {
      alignItems: 'baseline',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 4,
    },
    userName: {
      color: so.link,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    userRep: {
      color: so.textSecondary,
      fontWeight: 600,
    },
    userWhen: {
      color: so.textLight,
    },
    // ---- Vote control (the interactive upvote form) --------------------------
    voteForm: { display: 'contents' },
    voteStat: {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    },
    voteButton: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderColor: so.borderMed,
      borderRadius: 1000,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.textLight,
      display: 'grid',
      height: 24,
      placeItems: 'center',
      width: 24,
      ':hover': { backgroundColor: '#fff1e5', borderColor: so.orange, color: so.orange },
    },
    voteCaret: { fontSize: 11, lineHeight: 1 },
    voteScore: {
      color: so.textSecondary,
      fontSize: 15,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
      lineHeight: 1.2,
    },
  },
  { namespace: 'chrome', source: 'components/chrome.tsx' },
);

// The demo uses text ids for posted questions and answers.
export function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Two-letter initials from an author display name (e.g. "Priya Nair" → "PN").
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// A compact, dependency-free "relative time" label from an ISO timestamp. The
// demo data is timestamped near 2026-06-16, so this reads as "today / 2 days ago".
const SO_NOW = Date.parse('2026-06-17T00:00:00Z');
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!iso || Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((SO_NOW - then) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} mins ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} months ago`;
}

/** Parse the comma-separated `tags` column into a trimmed, non-empty list. */
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * A stable, plausible "views" count for the stat rail. Derived from the id so it
 * stays constant across renders without a schema column — Stack Overflow always
 * shows views, and the magnitude tracks loosely with engagement.
 */
export function viewsFor(id: string, score: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) & 0xffff;
  }
  return (score + 3) * 41 + (hash % 900) + 60;
}

/** Format a count Stack-Overflow style: 1240 → "1.2k". */
export function compactCount(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return String(value);
}

// A deterministic, plausible reputation for a demo author name.
export function reputationFor(name: string): number {
  let hash = 7;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 37 + name.charCodeAt(index)) & 0x7fff;
  }
  return 200 + (hash % 9800);
}

/** A row of tags rendered as Stack Overflow's light-blue pills. */
export function renderTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return (
    <div style={chromeStyles.tagRow}>
      {tags.map((tag) => (
        <a style={chromeStyles.tag} href="/">
          {tag}
        </a>
      ))}
    </div>
  );
}

/**
 * The bottom-right "user card": a small rounded-square avatar (initials), the
 * author name, their reputation, and a relative timestamp — e.g.
 * "asked 5 hours ago  PN Priya Nair 1,204".
 */
export function renderUserCard(name: string, iso: string | undefined, verb: string): string {
  const when = iso ? relativeTime(iso) : '';
  return (
    <div style={chromeStyles.userCard}>
      <span style={chromeStyles.userAvatar}>{initials(name)}</span>
      <div style={chromeStyles.userMeta}>
        {when ? <span style={chromeStyles.userWhen}>{`${verb} ${when}`}</span> : ''}
        <a style={chromeStyles.userName} href="/">
          {name}
        </a>
        <span style={chromeStyles.userRep}>{reputationFor(name).toLocaleString('en-US')}</span>
      </div>
    </div>
  );
}

/**
 * The interactive upvote control: a native `enhance` form whose submission morphs
 * the re-rendered region. The score stays as the sole text child of its span so
 * the generated binding can update it directly. Rendered as Stack Overflow's
 * up-caret button stacked over the score. The CSRF token + form key are injected
 * automatically by the @kovojs/server JSX runtime for `enhance` mutation forms.
 */
export function voteButton(questionId: string, value: number): string {
  return (
    <form enhance mutation={voteUpMutation} key={questionId} style={chromeStyles.voteForm}>
      <input type="hidden" name="id" value={`vote-${questionId}`} />
      <input type="hidden" name="targetId" value={questionId} />
      <input type="hidden" name="userId" value="demo-viewer" />
      <div style={chromeStyles.voteStat}>
        <button type="submit" aria-label="Up vote" style={chromeStyles.voteButton}>
          <span style={chromeStyles.voteCaret}>&#9650;</span>
        </button>
        <span style={chromeStyles.voteScore}>{value}</span>
      </div>
    </form>
  );
}

const SIDEBAR_ITEMS = [
  { label: 'Home', href: '/', active: false },
  { label: 'Questions', href: '/', active: true },
  { label: 'Tags', href: '/', active: false },
  { label: 'Users', href: '/', active: false },
  { label: 'Companies', href: '/', active: false },
] as const;

// The Stack Overflow logo mark (the orange "overflow" stack over a gray inbox).
function brandIcon(): string {
  return (
    <svg style={chromeStyles.brandIcon} viewBox="0 0 32 37" aria-hidden="true">
      <path d="M26 33v-9h4v13H0V24h4v9z" fill="#BCBBBB" />
      <path
        d="m21.5 20.7 2.4-3.2L8 5.3 5.6 8.5zM7 23h17v4H7zm.7-5.3.9-3.9 16.6 3.5-.9 3.9zm1.8-8.7 1.8-3.5 15 7.8-1.8 3.5z"
        fill={so.orange}
      />
    </svg>
  );
}

function searchIcon(): string {
  return (
    <svg style={chromeStyles.searchIcon} viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="m18 16.5-5.14-5.18h-.35a7 7 0 1 0-1.19 1.19v.35L16.5 18l1.5-1.5ZM12 7A5 5 0 1 1 2 7a5 5 0 0 1 10 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SoShell({ children }: { children?: unknown }): string {
  return (
    <div style={chromeStyles.appRoot}>
      <header style={chromeStyles.header}>
        <div style={chromeStyles.headerInner}>
          <a href="/" style={chromeStyles.brand} aria-label="Stack Overflow">
            {brandIcon()}
            <span style={chromeStyles.brandWordmark}>
              <span style={chromeStyles.brandLight}>stack</span>
              <span style={chromeStyles.brandBold}>overflow</span>
            </span>
          </a>
          <nav style={chromeStyles.headerNav}>
            <a href="/" style={chromeStyles.headerNavLink}>
              Products
            </a>
            <a href="/" style={chromeStyles.headerNavLink}>
              OverflowAI
            </a>
          </nav>
          <form style={chromeStyles.search} action="/" method="get" role="search">
            {searchIcon()}
            <input
              style={chromeStyles.searchInput}
              type="search"
              name="q"
              placeholder="Search…"
              aria-label="Search"
            />
          </form>
          <div style={chromeStyles.headerActions}>
            <a href="/" style={chromeStyles.loginButton}>
              Log in
            </a>
            <a href="/" style={chromeStyles.signupButton}>
              Sign up
            </a>
          </div>
        </div>
      </header>
      <div style={chromeStyles.shell}>
        <aside style={chromeStyles.sidebar}>
          <nav style={chromeStyles.sidebarNav}>
            {SIDEBAR_ITEMS.map((item) => (
              <a
                href={item.href}
                style={
                  item.active
                    ? [chromeStyles.sidebarLink, chromeStyles.sidebarLinkActive]
                    : chromeStyles.sidebarLink
                }
              >
                {item.label}
              </a>
            ))}
            <span style={chromeStyles.sidebarHeading}>Collectives</span>
            <a href="/" style={chromeStyles.sidebarLink}>
              Explore Collectives
            </a>
          </nav>
        </aside>
        <main style={chromeStyles.main}>{children}</main>
      </div>
    </div>
  );
}
