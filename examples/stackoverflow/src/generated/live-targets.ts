// @kovojs-ir — generated live-target registry for StackOverflow components (SPEC.md section 9.1). Do not edit; regenerate with `pnpm run emit-components`.
import { collectGeneratedLiveTargetRenderers } from '@kovojs/server/internal/wire';

import * as questionDetailModule from './question-detail.js';
import * as questionListModule from './question-list.js';

export const liveTargetRenderers = collectGeneratedLiveTargetRenderers([
  questionDetailModule,
  questionListModule,
]);
