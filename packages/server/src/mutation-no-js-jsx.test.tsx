/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { renderComponentMutationFailure } from './component-render.js';
import { renderNoJsMutationResponse } from './mutation.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('no-JS mutation JSX responses', () => {
  it('renders component-scoped FormError as a real full-page 422 output element', async () => {
    const saveQuestionForm = form<
      'question/save',
      { title: string },
      { code: 'BLOCKED_TITLE'; payload: { title: string } }
    >('question/save');
    const QuestionForm = component({
      mutations: { saveQuestion: saveQuestionForm },
      render: (_queries, _state, { forms }) => (
        <html>
          <body>
            <form>
              <input name="title" value={forms.saveQuestion.submitted?.title ?? ''} />
              <FormError
                code="BLOCKED_TITLE"
                failure={forms.saveQuestion.failure}
                message={(failure: { payload: { title: string } }) =>
                  `Blocked title: ${failure.payload.title}`
                }
              />
            </form>
          </body>
        </html>
      ),
    });
    const saveQuestion = mutation('question/save', {
      errors: {
        BLOCKED_TITLE: s.object({ title: s.string() }),
      },
      input: s.object({ title: s.string() }),
      handler(input, _request, context) {
        return context.fail('BLOCKED_TITLE', { title: input.title });
      },
    });

    const response = await renderNoJsMutationResponse(saveQuestion, {
      rawInput: { title: '<output>helper</output>' },
      redirectTo: '/questions',
      renderFailurePage: (failure, rawInput) =>
        renderComponentMutationFailure(QuestionForm, {}, failure, {
          formName: 'saveQuestion',
          submitted: rawInput,
        }),
      request: {},
    });

    expect(response.status).toBe(422);
    expect(response.body).toContain(
      '<output role="alert" data-error-code="BLOCKED_TITLE">Blocked title: &lt;output&gt;helper&lt;/output&gt;</output>',
    );
    expect(response.body).not.toContain('&lt;output role=&quot;alert&quot;');
  });
});
