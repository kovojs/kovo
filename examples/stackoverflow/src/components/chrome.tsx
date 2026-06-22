/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { CURRENT_USER, displayName, reputationOf } from '../directory.js';
import { voteUpMutation } from '../mutations.js';

// Shared page chrome (the KovOverflow top bar + left sidebar) and the small
// rendering helpers — tag pills, user cards, the vote control — used across the
// question list, question detail, tags, and users pages. KovOverflow is a
// Stack Overflow-style Q&A site; the palette mirrors the real site so it reads
// as a polished, familiar product.

export type NavSection = 'questions' | 'tags' | 'users';

// Stack Overflow's actual palette. Components apply these hex values directly so
// the look matches the real site rather than the generated theme ramp.
export const so = {
  orange: '#f48024',
  orangeDark: '#da680b',
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
  acceptedText: '#3d8b5f',
  navActiveBg: '#f1f2f3',
  navHoverBg: '#e3e6e8',
  gold: '#f1b600',
  silver: '#9fa6ad',
  bronze: '#d1a684',
} as const;

const chromeStyles = style.create(
  {
    appRoot: {
      backgroundColor: so.bodyBg,
      color: so.text,
      display: 'flex',
      flexDirection: 'column',
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
    // ---- Mobile hamburger (a no-JS <details> drawer) -------------------------
    mobileMenu: {
      display: 'none',
      position: 'relative',
      '@media (max-width: 820px)': { display: 'block' },
    },
    hamburger: {
      alignItems: 'center',
      borderRadius: 4,
      color: so.textMuted,
      cursor: 'pointer',
      display: 'inline-flex',
      height: 38,
      justifyContent: 'center',
      listStyle: 'none',
      width: 38,
      ':hover': { backgroundColor: so.navActiveBg, color: so.textSecondary },
    },
    hamburgerIcon: { display: 'block', height: 18, width: 18 },
    mobileDrawer: {
      backgroundColor: so.white,
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
      display: 'flex',
      flexDirection: 'column',
      insetInlineStart: 4,
      minWidth: 220,
      paddingBlock: 8,
      position: 'absolute',
      top: 46,
      zIndex: 40,
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
    brandIcon: { display: 'block', height: 30, width: 26 },
    brandWordmark: {
      color: so.text,
      fontSize: 21,
      letterSpacing: '-0.1px',
      marginInlineStart: 2,
      whiteSpace: 'nowrap',
    },
    brandLight: { fontWeight: 400 },
    brandBold: { fontWeight: 600 },
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
    // ---- Signed-in user widget ----------------------------------------------
    headerActions: {
      alignItems: 'center',
      display: 'flex',
      gap: 2,
      marginInlineStart: 4,
    },
    repBadge: {
      alignItems: 'center',
      borderRadius: 4,
      color: so.textSecondary,
      display: 'inline-flex',
      fontSize: 13,
      fontWeight: 600,
      gap: 5,
      paddingBlock: 6,
      paddingInline: 7,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.navActiveBg },
      '@media (max-width: 600px)': { display: 'none' },
    },
    repValue: { color: so.textSecondary, fontWeight: 700 },
    badgeDot: {
      alignItems: 'center',
      display: 'inline-flex',
      fontSize: 12,
      fontWeight: 600,
      gap: 2,
    },
    badgeDotGold: { color: '#b08800' },
    badgeDotSilver: { color: '#7c858c' },
    iconButton: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderRadius: 4,
      borderStyle: 'none',
      color: so.textLight,
      display: 'inline-flex',
      height: 36,
      justifyContent: 'center',
      width: 36,
      ':hover': { backgroundColor: so.navActiveBg, color: so.textSecondary },
      '@media (max-width: 600px)': { display: 'none' },
    },
    actionIcon: { display: 'block', height: 19, width: 19 },
    avatarLink: {
      alignItems: 'center',
      borderRadius: 4,
      display: 'inline-flex',
      height: 40,
      justifyContent: 'center',
      marginInlineStart: 2,
      paddingInline: 4,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.navActiveBg },
    },
    headerAvatar: {
      backgroundColor: so.orange,
      backgroundImage: 'linear-gradient(135deg, #f9a14a 0%, #f48024 60%, #da680b 100%)',
      borderRadius: 4,
      color: '#ffffff',
      display: 'grid',
      fontSize: 13,
      fontWeight: 700,
      height: 30,
      placeItems: 'center',
      width: 30,
    },
    // ---- Body layout ---------------------------------------------------------
    shell: {
      display: 'flex',
      flex: '1 1 auto',
      marginInline: 'auto',
      maxWidth: 1264,
      width: '100%',
    },
    sidebar: {
      flexShrink: 0,
      paddingBlockStart: 24,
      paddingInlineEnd: 8,
      width: 164,
      '@media (max-width: 820px)': { display: 'none' },
    },
    sidebarNav: {
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 74,
    },
    sidebarLink: {
      alignItems: 'center',
      borderInlineStartColor: 'transparent',
      borderInlineStartStyle: 'solid',
      borderInlineStartWidth: 3,
      color: so.textMuted,
      display: 'flex',
      fontSize: 13,
      gap: 8,
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
    navIcon: { flexShrink: 0, height: 18, opacity: 0.85, width: 18 },
    // ---- Drawer links (mobile) ----------------------------------------------
    drawerLink: {
      alignItems: 'center',
      color: so.textSecondary,
      display: 'flex',
      fontSize: 14,
      gap: 10,
      paddingBlock: 9,
      paddingInline: 16,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.navActiveBg },
    },
    drawerLinkActive: {
      color: so.text,
      fontWeight: 600,
      boxShadow: 'inset 3px 0 0 #f48024',
    },
    drawerHeading: {
      color: so.textLight,
      fontSize: 11,
      letterSpacing: '0.7px',
      paddingBlock: 6,
      paddingInline: 16,
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
      '@media (max-width: 820px)': {
        borderInlineStartWidth: 0,
        paddingInline: 16,
      },
    },
    // ---- Tag pills -----------------------------------------------------------
    tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
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
    userRep: { color: so.textSecondary, fontWeight: 600 },
    userWhen: { color: so.textLight },
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
// demo data is timestamped relative to mid-June 2026, so this reads as
// "asked 2 days ago". Questions/answers posted at runtime carry no timestamp and
// read as "just now".
const SO_NOW = Date.parse('2026-06-17T00:00:00Z');
export function relativeTime(iso: string | undefined): string {
  if (!iso) return 'just now';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'just now';
  const minutes = Math.max(0, Math.round((SO_NOW - then) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} mins ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
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

/** The href for a tag's filtered question list. */
export function tagHref(tag: string): string {
  return `/questions/tagged/${encodeURIComponent(tag)}`;
}

/** A row of tags rendered as Stack Overflow's light-blue pills, each linking to
 *  its filtered question list. */
export function renderTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return (
    <div style={chromeStyles.tagRow}>
      {tags.map((tag) => (
        <a style={chromeStyles.tag} href={tagHref(tag)}>
          {tag}
        </a>
      ))}
    </div>
  );
}

/**
 * The bottom-right "user card": a small rounded-square avatar (initials), the
 * author name (linking to their profile), their reputation, and a relative
 * timestamp — e.g. "asked 5 hours ago  PN Priya Nair 1,204".
 */
export function renderUserCard(
  authorId: string | undefined,
  name: string | undefined,
  iso: string | undefined,
  verb: string,
): string {
  const resolvedName = displayName(authorId, name);
  const rep = reputationOf(authorId, name);
  const when = relativeTime(iso);
  const profileHref = authorId ? `/users/${encodeURIComponent(authorId)}` : '/users';
  return (
    <div style={chromeStyles.userCard}>
      <a href={profileHref} aria-label={resolvedName}>
        <span style={chromeStyles.userAvatar}>{initials(resolvedName)}</span>
      </a>
      <div style={chromeStyles.userMeta}>
        <span style={chromeStyles.userWhen}>{`${verb} ${when}`}</span>
        <a style={chromeStyles.userName} href={profileHref}>
          {resolvedName}
        </a>
        <span style={chromeStyles.userRep}>{compactCount(rep)}</span>
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

// ---- Navigation model --------------------------------------------------------

interface NavItem {
  label: string;
  href: string;
  section?: NavSection;
  icon: 'home' | 'globe' | 'tag' | 'users';
}

const PRIMARY_NAV: NavItem[] = [{ label: 'Home', href: '/', icon: 'home' }];
const PUBLIC_NAV: NavItem[] = [
  { label: 'Questions', href: '/', section: 'questions', icon: 'globe' },
  { label: 'Tags', href: '/tags', section: 'tags', icon: 'tag' },
  { label: 'Users', href: '/users', section: 'users', icon: 'users' },
];

function navIcon(kind: NavItem['icon']): string {
  const paths: Record<NavItem['icon'], string> = {
    home: 'M8 1 1 7v8h5v-5h4v5h5V7L8 1Z',
    globe:
      'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 4.5h-2a8.4 8.4 0 0 0-1-2.4 5.5 5.5 0 0 1 3 2.4ZM8 2.6c.5.7.9 1.6 1.2 2.9H6.8C7.1 4.2 7.5 3.3 8 2.6ZM2.6 8c0-.5.1-1 .2-1.5h2.3a13 13 0 0 0 0 3H2.8A5.5 5.5 0 0 1 2.6 8Zm.5 2.5h2a8.4 8.4 0 0 0 1 2.4 5.5 5.5 0 0 1-3-2.4ZM5.1 5.5h-2a5.5 5.5 0 0 1 3-2.4 8.4 8.4 0 0 0-1 2.4ZM8 13.4c-.5-.7-.9-1.6-1.2-2.9h2.4c-.3 1.3-.7 2.2-1.2 2.9Zm1.4-4.4H6.6a11 11 0 0 1 0-3h2.8a11 11 0 0 1 0 3Zm.5 4a8.4 8.4 0 0 0 1-2.4h2a5.5 5.5 0 0 1-3 2.4Zm1.3-3.9a13 13 0 0 0 0-3h2.3a5.5 5.5 0 0 1 0 3h-2.3Z',
    tag: 'M2 2h5.6L14 8.4 8.4 14 2 7.6V2Zm2.8 1.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z',
    users:
      'M5.5 8a2.2 2.2 0 1 0 0-4.5 2.2 2.2 0 0 0 0 4.5Zm5 0a2.2 2.2 0 1 0 0-4.5 2.2 2.2 0 0 0 0 4.5ZM1 13.2C1 11 3 9.5 5.5 9.5S10 11 10 13.2V14H1v-.8Zm10 .8v-.8c0-1-.3-1.9-.9-2.6 2 .2 3.9 1.4 3.9 3.4v.8h-3v-.8Z',
  };
  return (
    <svg style={chromeStyles.navIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d={paths[kind]} fill="currentColor" />
    </svg>
  );
}

// The KovOverflow logo mark — the orange "overflow" stack over a gray inbox.
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

function brandWordmark(): string {
  return (
    <span style={chromeStyles.brandWordmark}>
      <span style={chromeStyles.brandLight}>Kov</span>
      <span style={chromeStyles.brandBold}>Overflow</span>
    </span>
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

function actionIcon(kind: 'inbox' | 'trophy' | 'help'): string {
  const paths: Record<typeof kind, string> = {
    inbox:
      'M3 2h13a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a1 1 0 0 1 1-1Zm.3 2 5.2 4.4a1 1 0 0 0 1.3 0L15.7 4H3.3Z',
    trophy:
      'M5 2h8v2h3v2a3 3 0 0 1-3 3h-.4A4 4 0 0 1 10 11.9V14h3v2H5v-2h3v-2.1A4 4 0 0 1 5.4 9H5a3 3 0 0 1-3-3V4h3V2Zm8 5a1 1 0 0 0 1-1V6h-1v1Zm-9-1a1 1 0 0 0 1 1V6H4Z',
    help: 'M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1Zm.9 11.4H8.1v-1.8h1.8v1.8Zm1.4-5.1c-.3.4-.7.7-1.1 1-.3.2-.5.4-.6.6-.1.2-.2.5-.2.9H8.1c0-.6.1-1 .3-1.4.2-.3.5-.6 1-.9.3-.2.5-.4.6-.6.1-.2.2-.4.2-.7 0-.3-.1-.6-.4-.8-.2-.2-.5-.3-.9-.3-.4 0-.7.1-.9.3-.3.2-.4.5-.5.9l-1.6-.2c.1-.7.5-1.3 1-1.7.5-.4 1.2-.6 2-.6.9 0 1.6.2 2.1.7.5.4.8 1 .8 1.7 0 .6-.2 1.1-.6 1.5Z',
  };
  return (
    <svg style={chromeStyles.actionIcon} viewBox="0 0 18 18" aria-hidden="true">
      <path d={paths[kind]} fill="currentColor" />
    </svg>
  );
}

function isActive(item: NavItem, active: NavSection): boolean {
  return item.section !== undefined && item.section === active;
}

function mobileDrawer(active: NavSection): string {
  return (
    <details style={chromeStyles.mobileMenu}>
      <summary style={chromeStyles.hamburger} aria-label="Open menu">
        <svg style={chromeStyles.hamburgerIcon} viewBox="0 0 18 18" aria-hidden="true">
          <path d="M1 3h16v2H1V3Zm0 5h16v2H1V8Zm0 5h16v2H1v-2Z" fill="currentColor" />
        </svg>
      </summary>
      <nav style={chromeStyles.mobileDrawer}>
        {PRIMARY_NAV.map((item) => (
          <a href={item.href} style={chromeStyles.drawerLink}>
            {navIcon(item.icon)}
            {item.label}
          </a>
        ))}
        <span style={chromeStyles.drawerHeading}>Public</span>
        {PUBLIC_NAV.map((item) => (
          <a
            href={item.href}
            style={
              isActive(item, active)
                ? [chromeStyles.drawerLink, chromeStyles.drawerLinkActive]
                : chromeStyles.drawerLink
            }
          >
            {navIcon(item.icon)}
            {item.label}
          </a>
        ))}
      </nav>
    </details>
  );
}

function userWidget(): string {
  const rep = compactCount(CURRENT_USER.reputation);
  return (
    <div style={chromeStyles.headerActions}>
      <a
        href={`/users/${CURRENT_USER.id}`}
        style={chromeStyles.repBadge}
        aria-label="Your reputation"
      >
        <span style={chromeStyles.repValue}>{rep}</span>
        <span style={[chromeStyles.badgeDot, chromeStyles.badgeDotGold]}>
          ●{CURRENT_USER.badges.gold}
        </span>
        <span style={[chromeStyles.badgeDot, chromeStyles.badgeDotSilver]}>
          ●{CURRENT_USER.badges.silver}
        </span>
      </a>
      <button type="button" style={chromeStyles.iconButton} aria-label="Inbox">
        {actionIcon('inbox')}
      </button>
      <button type="button" style={chromeStyles.iconButton} aria-label="Achievements">
        {actionIcon('trophy')}
      </button>
      <button type="button" style={chromeStyles.iconButton} aria-label="Help">
        {actionIcon('help')}
      </button>
      <a
        href={`/users/${CURRENT_USER.id}`}
        style={chromeStyles.avatarLink}
        aria-label={`${CURRENT_USER.name} (you)`}
      >
        <span style={chromeStyles.headerAvatar}>{initials(CURRENT_USER.name)}</span>
      </a>
    </div>
  );
}

export function SoShell({
  active = 'questions',
  children,
}: {
  active?: NavSection;
  children?: unknown;
}): string {
  return (
    <div style={chromeStyles.appRoot}>
      <header style={chromeStyles.header}>
        <div style={chromeStyles.headerInner}>
          {mobileDrawer(active)}
          <a href="/" style={chromeStyles.brand} aria-label="KovOverflow">
            {brandIcon()}
            {brandWordmark()}
          </a>
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
          {userWidget()}
        </div>
      </header>
      <div style={chromeStyles.shell}>
        <aside style={chromeStyles.sidebar}>
          <nav style={chromeStyles.sidebarNav}>
            {PRIMARY_NAV.map((item) => (
              <a href={item.href} style={chromeStyles.sidebarLink}>
                {navIcon(item.icon)}
                {item.label}
              </a>
            ))}
            <span style={chromeStyles.sidebarHeading}>Public</span>
            {PUBLIC_NAV.map((item) => (
              <a
                href={item.href}
                style={
                  isActive(item, active)
                    ? [chromeStyles.sidebarLink, chromeStyles.sidebarLinkActive]
                    : chromeStyles.sidebarLink
                }
              >
                {navIcon(item.icon)}
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <main style={chromeStyles.main}>{children}</main>
      </div>
    </div>
  );
}
