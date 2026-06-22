/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import type { QuestionListItem } from '../model.js';
import {
  compactCount,
  parseTags,
  renderTags,
  renderUserCard,
  viewsFor,
  voteButton,
} from './chrome.js';

// Palette inlined as a same-file literal: the StyleX-style extractor resolves
// only same-file literals (and public @kovojs/style tokens) inside
// `style.create`, not cross-module imports (SPEC §13.1). Mirrors the `so`
// palette in chrome.tsx.
const so = {
  border: '#e3e6e8',
  acceptedText: '#3d8b5f',
  link: '#0074cc',
  linkHover: '#0a95ff',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  textLight: '#6a737c',
} as const;

// The shared "question summary" row — the stat rail (votes / answers / views),
// the title + excerpt, and the tag + asker footer — used by the All Questions
// list and the per-tag filtered list. On the interactive list the vote control
// is a live `enhance` form; on filtered pages (which are not morph targets) the
// score renders statically.

export const cardStyles = style.create(
  {
    list: {
      borderTopColor: so.border,
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    row: {
      borderBottomColor: so.border,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      gap: 16,
      paddingBlock: 16,
      '@media (max-width: 600px)': { gap: 10 },
    },
    stats: {
      color: so.textMuted,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontSize: 13,
      gap: 8,
      paddingTop: 2,
      width: 90,
      '@media (max-width: 600px)': { width: 58 },
    },
    statVotes: {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    },
    statVotesLabel: { color: so.textMuted, fontSize: 13, lineHeight: 1 },
    staticScore: {
      color: so.textSecondary,
      fontSize: 17,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 500,
      lineHeight: 1.1,
    },
    statBox: {
      alignItems: 'center',
      borderColor: so.acceptedText,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.acceptedText,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      paddingBlock: 4,
      paddingInline: 6,
    },
    statPlain: {
      alignItems: 'center',
      color: so.textMuted,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      paddingBlock: 4,
    },
    statNum: {
      fontSize: 15,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 400,
      lineHeight: 1,
    },
    statLabel: { fontSize: 12, lineHeight: 1 },
    statViews: { color: so.textLight, fontSize: 12, textAlign: 'center' },
    rowMain: { display: 'grid', flex: '1 1 0%', gap: 6, minWidth: 0 },
    rowTitle: {
      color: so.link,
      fontSize: 17,
      fontWeight: 400,
      lineHeight: 1.3,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    rowExcerpt: {
      color: so.textMuted,
      display: '-webkit-box',
      fontSize: 13,
      lineHeight: 1.5,
      margin: 0,
      overflow: 'hidden',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 2,
    },
    rowMeta: {
      alignItems: 'flex-end',
      columnGap: 12,
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBlockStart: 4,
      rowGap: 8,
    },
  },
  { namespace: 'card', source: 'components/question-card.tsx' },
);

function answerStat(answerCount: number): string {
  const label = answerCount === 1 ? 'answer' : 'answers';
  if (answerCount > 0) {
    return (
      <div style={cardStyles.statBox}>
        <span style={cardStyles.statNum}>{answerCount}</span>
        <span style={cardStyles.statLabel}>{label}</span>
      </div>
    );
  }
  return (
    <div style={cardStyles.statPlain}>
      <span style={cardStyles.statNum}>0</span>
      <span style={cardStyles.statLabel}>answers</span>
    </div>
  );
}

function voteStat(question: QuestionListItem, interactive: boolean): string {
  if (interactive) {
    return (
      <div style={cardStyles.statVotes}>
        {voteButton(question.id, question.score)}
        <span style={cardStyles.statVotesLabel}>votes</span>
      </div>
    );
  }
  return (
    <div style={cardStyles.statVotes}>
      <span style={cardStyles.staticScore}>{question.score}</span>
      <span style={cardStyles.statVotesLabel}>votes</span>
    </div>
  );
}

export interface QuestionRowOptions {
  interactive?: boolean;
}

export function renderQuestionRow(
  question: QuestionListItem,
  options: QuestionRowOptions = {},
): string {
  const interactive = options.interactive ?? true;
  const tags = parseTags(question.tags);
  const views = viewsFor(question.id, question.score);
  return (
    <li kovo-key={question.id} style={cardStyles.row}>
      <div style={cardStyles.stats}>
        {voteStat(question, interactive)}
        {answerStat(question.answerCount)}
        <span style={cardStyles.statViews}>{`${compactCount(views)} views`}</span>
      </div>
      <div style={cardStyles.rowMain}>
        <a style={cardStyles.rowTitle} href={`/questions/${question.id}`}>
          {question.title}
        </a>
        {question.body ? <p style={cardStyles.rowExcerpt}>{question.body}</p> : ''}
        <div style={cardStyles.rowMeta}>
          {renderTags(tags)}
          {renderUserCard(question.authorId, question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </li>
  );
}

/** Newest-first ordering for display. Posted questions carry no timestamp and
 *  sort to the top (they are the freshest). Stable under vote morphs because a
 *  score change never moves a row. */
export function newestFirst(items: QuestionListItem[]): QuestionListItem[] {
  const sortKey = (value: string) => (value && value.length > 0 ? value : '9999-12-31');
  return [...items].sort((left, right) =>
    sortKey(right.createdAt).localeCompare(sortKey(left.createdAt)),
  );
}
