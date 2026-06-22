/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { tagHref } from './chrome.js';

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  white: '#ffffff',
  border: '#e3e6e8',
  textSecondary: '#232629',
  textMuted: '#525960',
  link: '#0074cc',
  linkHover: '#0a95ff',
  tagBg: '#e1ecf4',
  tagText: '#39739d',
  tagBgHover: '#cee0ed',
  tagTextHover: '#2c5877',
} as const;

// The Stack Overflow right rail: the Overflow Blog, Featured on Meta, Hot
// Network Questions, and a watched-tags widget. Rendered as a sibling of the
// morphable question region (at the route-page level) so a vote/answer never
// re-renders this static chrome.

const railStyles = style.create(
  {
    columns: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 24,
    },
    mainCol: { flex: '1 1 0%', minWidth: 0 },
    rail: {
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 16,
      paddingBlockStart: 4,
      position: 'sticky',
      top: 74,
      width: 300,
      '@media (max-width: 1000px)': { display: 'none' },
    },
    card: {
      backgroundColor: '#fdf7e3',
      borderColor: '#e8d9a8',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      overflow: 'hidden',
    },
    cardHead: {
      backgroundColor: '#f8f3df',
      borderBottomColor: '#e8d9a8',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: '#3b4045',
      fontSize: 13,
      fontWeight: 600,
      paddingBlock: 8,
      paddingInline: 12,
    },
    cardBody: { display: 'flex', flexDirection: 'column', paddingBlock: 4 },
    item: {
      alignItems: 'flex-start',
      color: so.link,
      display: 'flex',
      fontSize: 13,
      gap: 8,
      lineHeight: 1.4,
      paddingBlock: 7,
      paddingInline: 12,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    bullet: { color: '#6a737c', flexShrink: 0, lineHeight: 1.4 },
    hotCard: {
      backgroundColor: so.white,
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      overflow: 'hidden',
    },
    hotHead: {
      backgroundColor: '#f8f9f9',
      color: so.textSecondary,
      fontSize: 13,
      fontWeight: 600,
      paddingBlock: 8,
      paddingInline: 12,
    },
    hotItem: {
      alignItems: 'baseline',
      borderTopColor: so.border,
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: so.link,
      display: 'flex',
      fontSize: 13,
      gap: 8,
      lineHeight: 1.35,
      paddingBlock: 8,
      paddingInline: 12,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    hotScore: {
      backgroundColor: '#eff0f1',
      borderRadius: 4,
      color: so.textMuted,
      flexShrink: 0,
      fontSize: 11,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
      paddingBlock: 1,
      paddingInline: 5,
    },
    tagsCard: {
      backgroundColor: so.white,
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      padding: 12,
    },
    tagsTitle: {
      color: so.textSecondary,
      fontSize: 13,
      fontWeight: 600,
      marginBlockEnd: 10,
    },
    tagPills: { display: 'flex', flexWrap: 'wrap', gap: 6 },
    tagPill: {
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      fontSize: 12,
      paddingBlock: 4,
      paddingInline: 7,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.tagBgHover, color: so.tagTextHover },
    },
  },
  { namespace: 'rail', source: 'components/right-rail.tsx' },
);

const BLOG_POSTS = [
  'Why compilers are having a moment again',
  'Shipping zero-hydration apps without losing your mind',
  'The hidden cost of a re-render you never see',
];

const META_POSTS = [
  'Code of Conduct refresh — 2026 edition',
  'Outdated Answers: a community-led effort to keep answers fresh',
];

const HOT_QUESTIONS: { id: string; title: string; score: number }[] = [
  { id: 'q5', title: 'How do I vertically and horizontally center a div?', score: 312 },
  { id: 'q14', title: 'Why does 0.1 + 0.2 not equal 0.3?', score: 268 },
  { id: 'q7', title: 'How do I undo the most recent local Git commit?', score: 241 },
  { id: 'q11', title: 'How do I select the latest row per group in SQL?', score: 187 },
  { id: 'q6', title: 'What is a closure, in plain terms?', score: 156 },
  { id: 'q3', title: 'Why does my useEffect run twice on mount?', score: 124 },
];

const WATCHED_TAGS = ['javascript', 'reactjs', 'typescript', 'css', 'sql'];

function blogCard(): string {
  return (
    <div style={railStyles.card}>
      <div style={railStyles.cardHead}>The Overflow Blog</div>
      <div style={railStyles.cardBody}>
        {BLOG_POSTS.map((title) => (
          <a href="/" style={railStyles.item}>
            <span style={railStyles.bullet}>&#9998;</span>
            <span>{title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function metaCard(): string {
  return (
    <div style={railStyles.card}>
      <div style={railStyles.cardHead}>Featured on Meta</div>
      <div style={railStyles.cardBody}>
        {META_POSTS.map((title) => (
          <a href="/" style={railStyles.item}>
            <span style={railStyles.bullet}>&#9670;</span>
            <span>{title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function hotCard(title: string, items: { id: string; title: string; score: number }[]): string {
  return (
    <div style={railStyles.hotCard}>
      <div style={railStyles.hotHead}>{title}</div>
      {items.map((item) => (
        <a href={`/questions/${item.id}`} style={railStyles.hotItem}>
          <span style={railStyles.hotScore}>{item.score}</span>
          <span>{item.title}</span>
        </a>
      ))}
    </div>
  );
}

function watchedTagsCard(): string {
  return (
    <div style={railStyles.tagsCard}>
      <div style={railStyles.tagsTitle}>Watched Tags</div>
      <div style={railStyles.tagPills}>
        {WATCHED_TAGS.map((tag) => (
          <a href={tagHref(tag)} style={railStyles.tagPill}>
            {tag}
          </a>
        ))}
      </div>
    </div>
  );
}

/** The right rail for the question list (home) page. */
export function homeRail(): string {
  return (
    <aside style={railStyles.rail}>
      {blogCard()}
      {metaCard()}
      {watchedTagsCard()}
      {hotCard('Hot Network Questions', HOT_QUESTIONS)}
    </aside>
  );
}

/** The right rail for a question detail page: related + hot questions. */
export function questionRail(currentId: string): string {
  const related = HOT_QUESTIONS.filter((item) => item.id !== currentId).slice(0, 5);
  return (
    <aside style={railStyles.rail}>
      {hotCard('Related', related)}
      {hotCard('Hot Network Questions', HOT_QUESTIONS.slice(0, 5))}
      {watchedTagsCard()}
    </aside>
  );
}

/** Two-column page layout: morphable main region on the left, static rail on
 *  the right. The rail collapses below 1000px. */
export function withRail(main: unknown, rail: string): string {
  return (
    <div style={railStyles.columns}>
      <div style={railStyles.mainCol}>{main}</div>
      {rail}
    </div>
  );
}
