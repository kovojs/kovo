import { runWithExampleGeneratedGraphs } from '../example-generated-graphs.setup.js';
import { componentLiveTargetRenderer } from '../../packages/server/src/internal/wire.js';

import { QuestionDetailRegion } from '../../examples/stackoverflow/src/components/question-detail.js';
import { QuestionListRegion } from '../../examples/stackoverflow/src/components/question-list.js';

const stackOverflowLiveTargetRenderers = [
  componentLiveTargetRenderer({
    component: QuestionListRegion,
    componentId: 'components/question-list/question-list-region',
  }),
  componentLiveTargetRenderer({
    component: QuestionDetailRegion,
    componentId: 'components/question-detail/question-detail-region',
  }),
];

/** Vitest-only renderer inventory for Stack Overflow's exact generated graph. */
export function runWithStackOverflowGeneratedGraphs<Value>(load: () => Value): Value {
  return runWithExampleGeneratedGraphs(stackOverflowLiveTargetRenderers, load);
}
