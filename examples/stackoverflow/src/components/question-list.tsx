/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { postQuestionMutation, soCsrf } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import { postQuestionForm, type QuestionListItem, type SoRequest } from '../model.js';
import { freshId, parseTags, renderAuthor, renderTags, voteButton } from '../components/chrome.js';

// Question list for `/`. It reads the question rowset and total vote score, then
// renders the ask form and question cards.

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;
type QuestionScoreQueryResult = Awaited<ReturnType<typeof questionScore.load>>;
type QuestionListRenderSlots = ComponentRenderSlots<{ postQuestion: typeof postQuestionForm }> & {
  request?: SoRequest | undefined;
};
interface DuplicateTitleFailure {
  code: 'DUPLICATE_TITLE';
  payload: { title: string };
}

const defaultQuestionListRenderSlots: QuestionListRenderSlots = {
  forms: { postQuestion: { failure: null } },
};

const listStyles = style.create(
  {
    composer: {
      display: 'grid',
      gap: 11,
    },
    composerActions: {
      display: 'flex',
      justifyContent: 'flex-end',
    },
    composerTitle: {
      color: tokens.sys.color.onSurface,
      fontSize: 15,
      fontWeight: 600,
      margin: 0,
    },
    error: {
      color: tokens.sys.color.error,
      fontSize: 14,
    },
    input: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: tokens.sys.color.onSurface,
      fontSize: 14,
      paddingBlock: 10,
      paddingInline: 13,
      width: '100%',
      ':focus': {
        borderColor: tokens.sys.color.primary,
        outline: 'none',
      },
    },
    list: {
      display: 'grid',
      gap: 14,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    pageHead: {
      alignItems: 'flex-end',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
    },
    pageSub: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
      marginBlockEnd: 0,
      marginBlockStart: 6,
    },
    pageTitle: {
      color: tokens.sys.color.onSurface,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 0,
      margin: 0,
    },
    row: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
    },
    rowExcerpt: {
      color: tokens.sys.color.onSurfaceVariant,
      display: '-webkit-box',
      fontSize: 14,
      lineHeight: 1.5,
      margin: 0,
      overflow: 'hidden',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 2,
    },
    rowMain: {
      display: 'grid',
      flex: '1 1 0%',
      gap: 9,
      minWidth: 0,
    },
    rowMeta: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    rowStat: {
      alignItems: 'center',
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onSurfaceVariant,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 2,
      paddingBlock: 6,
      width: 52,
    },
    rowStatLabel: {
      color: tokens.sys.color.outline,
      fontSize: 10,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    },
    rowStatNum: {
      color: tokens.sys.color.onSurface,
      fontSize: 17,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
    },
    rowTitle: {
      color: tokens.sys.color.primary,
      fontSize: 17,
      fontWeight: 600,
      lineHeight: 1.35,
      textDecoration: 'none',
      ':hover': {
        color: tokens.sys.color.primary,
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      },
    },
    score: {
      color: tokens.sys.color.onSurface,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
    },
    stack: {
      display: 'grid',
      gap: 20,
    },
    textarea: {
      lineHeight: 1.5,
      resize: 'vertical',
    },
  },
  {
    namespace: 'so-question-list',
    source: 'examples/stackoverflow/src/components/question-list.tsx',
  },
);

export const questionListStyleCss = style.emitAtomicCss(
  Object.values(listStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderQuestionRow(question: QuestionListItem, request?: SoRequest): string {
  const tags = parseTags(question.tags);
  const body = (
    <div style={listStyles.row}>
      {voteButton(question.id, question.score, request)}
      <div style={listStyles.rowStat}>
        <span style={listStyles.rowStatNum}>{question.answerCount}</span>
        <span style={listStyles.rowStatLabel}>answers</span>
      </div>
      <div style={listStyles.rowMain}>
        <a style={listStyles.rowTitle} href={`/questions/${question.id}`}>
          {question.title}
        </a>
        {question.body ? <p style={listStyles.rowExcerpt}>{question.body}</p> : ''}
        <div style={listStyles.rowMeta}>
          {renderTags(tags)}
          {renderAuthor(question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </div>
  );
  // Keep the stable key on the repeated child that the fragment morphs.
  return <li kovo-key={question.id}>{Card.definition.render({ children: body })}</li>;
}

// Interactive region rendered inside the full page and fragment responses.
export const QuestionListRegion = component({
  mutations: { postQuestion: postQuestionForm },
  queries: { questionList, questionScore },
  render: (
    {
      questionList,
      questionScore,
    }: {
      questionList: QuestionListQueryResult;
      questionScore: QuestionScoreQueryResult;
    },
    _state,
    slots: QuestionListRenderSlots = defaultQuestionListRenderSlots,
  ) => {
    const questions = questionList.items;
    const totalVotes = questionScore.score;
    const askButton = Button.definition.render({
      children: 'Ask question',
      type: 'submit',
      variant: 'primary',
    });

    return (
      <div style={listStyles.stack}>
        <div style={listStyles.pageHead}>
          <div>
            <h1 style={listStyles.pageTitle}>Top questions</h1>
            <p style={listStyles.pageSub}>
              {questions.length} questions · <span style={listStyles.score}>{totalVotes}</span>{' '}
              votes cast
            </p>
          </div>
          {Badge.definition.render({ children: 'Newest', variant: 'success' })}
        </div>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance mutation={postQuestionMutation} style={listStyles.composer}>
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p style={listStyles.composerTitle}>Ask the community</p>
          <input
            name="title"
            required
            placeholder="What's your programming question? Be specific."
            style={listStyles.input}
          />
          <textarea
            name="body"
            required
            rows="2"
            placeholder="Add the details that help others answer…"
            style={[listStyles.input, listStyles.textarea]}
          />
          <div style={listStyles.composerActions}>{askButton}</div>
          <FormError
            code="DUPLICATE_TITLE"
            style={listStyles.error}
            message={(failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.`
            }
          />
        </form>

        <ul style={listStyles.list}>
          {questions.map((question) => renderQuestionRow(question, slots.request))}
        </ul>
      </div>
    );
  },
});
