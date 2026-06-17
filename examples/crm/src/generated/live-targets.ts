// @kovojs-ir - generated live-target registry for CRM components (SPEC.md section 9.1). Do not edit; regenerate with `pnpm run emit-components`.
import { collectGeneratedLiveTargetRenderers } from '@kovojs/server/internal/wire';

import * as contactsModule from './contacts.js';
import * as dealDetailModule from './deal-detail.js';
import * as pipelineModule from './pipeline.js';

export const liveTargetRenderers = collectGeneratedLiveTargetRenderers([
  contactsModule,
  dealDetailModule,
  pipelineModule,
]);
