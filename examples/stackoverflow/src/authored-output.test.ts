import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { renderHtmlValue } from '@kovojs/server/internal/html';
import { compileComponentModule } from '../../../packages/compiler/src/compile.js';

import { renderQuestionRow } from './components/question-card.js';

describe('Stack Overflow authored TSX output', () => {
  it('lowers authored question identity to the runtime kovo-key stamp', () => {
    const html = renderHtmlValue(
      renderQuestionRow(
        {
          answerCount: 1,
          authorId: 'u1',
          authorName: 'Ada',
          body: 'Question body',
          createdAt: '2026-07-22T00:00:00.000Z',
          id: 'q-proof',
          score: 3,
          tags: 'typescript',
          title: 'How does this work?',
        },
        { interactive: false },
      ),
    );

    // SPEC §5.2/§13.2: the example authors `key`; only rendered output carries lowered IR.
    expect(html).toContain('<li kovo-key="q-proof"');
  });

  it('lets the query-backed component own refresh identity inside its Defer region', () => {
    const fileName = 'examples/stackoverflow/src/components/question-detail.tsx';
    const result = compileComponentModule({
      fileName,
      source: readFileSync(new URL('./components/question-detail.tsx', import.meta.url), 'utf8'),
    });
    const lowered = result.loweredSource ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV235')).toEqual([]);
    expect(lowered).toContain('kovo-fragment-target="question-detail-region"');
    expect(lowered).not.toContain('kovo-fragment-target={`question-detail-secondary:');
  });
});
