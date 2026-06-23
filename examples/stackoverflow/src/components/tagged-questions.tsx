/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { questionList } from '../queries.js';
import type { QuestionListItem } from '../model.js';
import { tagDescription } from '../directory.js';
import { parseTags } from './chrome.js';
import { cardStyles, newestFirst, renderQuestionRow } from './question-card.js';

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  link: '#0074cc',
  linkHover: '#0a95ff',
  blue: '#0a95ff',
  blueHover: '#0074cc',
  blueText: '#ffffff',
  tagBg: '#e1ecf4',
  tagText: '#39739d',
} as const;

// `/questions/tagged/:tag` — the question list filtered to a single tag. It
// reuses the questionList query (filtered in render) and the shared question
// row. This route is not a morph target, so the rows render a static score
// rather than the live vote control.

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;

const taggedStyles = style.create(
  {
    head: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
      marginBlockEnd: 10,
    },
    titleWrap: { display: 'grid', gap: 8 },
    title: {
      alignItems: 'center',
      color: so.text,
      display: 'flex',
      fontSize: 26,
      fontWeight: 400,
      gap: 10,
      margin: 0,
    },
    tagBadge: {
      backgroundColor: so.tagBg,
      borderRadius: 4,
      color: so.tagText,
      fontSize: 14,
      paddingBlock: 4,
      paddingInline: 8,
    },
    desc: { color: so.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0, maxWidth: 720 },
    askButton: {
      backgroundColor: so.blue,
      borderColor: so.blue,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.blueText,
      flexShrink: 0,
      fontSize: 13,
      paddingBlock: 10,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.blueHover },
    },
    count: { color: so.textSecondary, fontSize: 15, marginBlock: 14 },
    back: {
      alignItems: 'center',
      color: so.link,
      display: 'inline-flex',
      fontSize: 13,
      gap: 6,
      marginBlockEnd: 12,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
    empty: { color: so.textMuted, fontSize: 15, paddingBlock: 24 },
  },
  { namespace: 'tagged', source: 'components/tagged-questions.tsx' },
);

export const TaggedQuestionsRegion = component({
  props: { tag: String },
  queries: { questionList },
  render: ({ questionList, tag }: { questionList: QuestionListQueryResult; tag: string }) => {
    const matches = newestFirst(
      (questionList.items as QuestionListItem[]).filter((item) =>
        parseTags(item.tags).includes(tag),
      ),
    );
    return (
      <div>
        <a style={taggedStyles.back} href="/tags">
          &larr; All tags
        </a>
        <div style={taggedStyles.head}>
          <div style={taggedStyles.titleWrap}>
            <h1 style={taggedStyles.title}>
              Questions tagged <span style={taggedStyles.tagBadge}>{tag}</span>
            </h1>
            <p style={taggedStyles.desc}>{tagDescription(tag)}</p>
          </div>
          <a href="/#ask-question" style={taggedStyles.askButton}>
            Ask Question
          </a>
        </div>
        <p style={taggedStyles.count}>
          {matches.length.toLocaleString('en-US')} {matches.length === 1 ? 'question' : 'questions'}
        </p>
        {matches.length > 0 ? (
          <ul style={cardStyles.list}>
            {matches.map((question) =>
              trustedHtml(renderQuestionRow(question, { interactive: false })),
            )}
          </ul>
        ) : (
          <p style={taggedStyles.empty}>
            No questions are tagged <strong>{tag}</strong> yet.
          </p>
        )}
      </div>
    );
  },
});
