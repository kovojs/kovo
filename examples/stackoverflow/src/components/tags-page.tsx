/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { questionList } from '../queries.js';
import type { QuestionListItem } from '../model.js';
import { orderTags, tagDescription } from '../directory.js';
import { parseTags, tagHref } from './chrome.js';

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  border: '#e3e6e8',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  textLight: '#6a737c',
  tagBg: '#e1ecf4',
  tagText: '#39739d',
  tagBgHover: '#cee0ed',
  tagTextHover: '#2c5877',
} as const;

// The Tags index (`/tags`): every tag used across the question set, with a short
// description and how many questions carry it, rendered as Stack Overflow's card
// grid. Counts are computed live from the questionList query (reused, so no new
// query enters the behavior graph).

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;

const SO_NOW = Date.parse('2026-06-17T00:00:00Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const tagsStyles = style.create(
  {
    head: { marginBlockEnd: 6 },
    title: { color: so.text, fontSize: 27, fontWeight: 400, margin: 0 },
    intro: {
      color: so.textMuted,
      fontSize: 14,
      lineHeight: 1.5,
      marginBlock: 8,
      maxWidth: 760,
    },
    count: { color: so.textSecondary, fontSize: 14, marginBlockEnd: 14 },
    grid: {
      display: 'grid',
      gap: 16,
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      '@media (max-width: 900px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      '@media (max-width: 560px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    },
    card: {
      borderColor: so.border,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minHeight: 140,
      padding: 16,
    },
    tagPill: {
      alignSelf: 'flex-start',
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      fontSize: 12,
      paddingBlock: 4,
      paddingInline: 7,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.tagBgHover, color: so.tagTextHover },
    },
    desc: {
      color: so.textMuted,
      display: '-webkit-box',
      flex: '1 1 auto',
      fontSize: 12,
      lineHeight: 1.5,
      margin: 0,
      overflow: 'hidden',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 4,
    },
    foot: {
      color: so.textLight,
      display: 'flex',
      fontSize: 12,
      gap: 10,
    },
    footStrong: { color: so.textMuted },
  },
  { namespace: 'tags', source: 'components/tags-page.tsx' },
);

interface TagStat {
  tag: string;
  count: number;
  week: number;
}

function collectTags(items: QuestionListItem[]): TagStat[] {
  const counts = new Map<string, { count: number; week: number }>();
  for (const item of items) {
    const fresh = item.createdAt ? SO_NOW - Date.parse(item.createdAt) < WEEK_MS : true;
    for (const tag of parseTags(item.tags)) {
      const entry = counts.get(tag) ?? { count: 0, week: 0 };
      entry.count += 1;
      if (fresh && !Number.isNaN(Date.parse(item.createdAt))) entry.week += 1;
      counts.set(tag, entry);
    }
  }
  const ordered = orderTags(
    [...counts.entries()].map(([tag, value]) => ({ tag, count: value.count })),
  );
  return ordered.map(({ tag, count }) => ({ tag, count, week: counts.get(tag)?.week ?? 0 }));
}

function tagCard(stat: TagStat): string {
  return (
    <div style={tagsStyles.card}>
      <a href={tagHref(stat.tag)} style={tagsStyles.tagPill}>
        {stat.tag}
      </a>
      <p style={tagsStyles.desc}>{tagDescription(stat.tag)}</p>
      <div style={tagsStyles.foot}>
        <span>
          <span style={tagsStyles.footStrong}>{stat.count.toLocaleString('en-US')}</span> questions
        </span>
        <span>
          <span style={tagsStyles.footStrong}>{stat.week}</span> this week
        </span>
      </div>
    </div>
  );
}

export const TagsPage = component({
  queries: { questionList },
  render: ({ questionList }: { questionList: QuestionListQueryResult }) => {
    const tags = collectTags(questionList.items as QuestionListItem[]);
    return (
      <div>
        <div style={tagsStyles.head}>
          <h1 style={tagsStyles.title}>Tags</h1>
          <p style={tagsStyles.intro}>
            A tag is a keyword or label that categorizes your question with other, similar
            questions. Using the right tags makes it easier for others to find and answer your
            question.
          </p>
        </div>
        <p style={tagsStyles.count}>{tags.length.toLocaleString('en-US')} tags</p>
        <div style={tagsStyles.grid}>{tags.map(tagCard)}</div>
      </div>
    );
  },
});
