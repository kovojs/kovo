import { runWithExampleGeneratedGraphs } from '../example-generated-graphs.setup.js';
import { componentLiveTargetRenderer } from '../../packages/server/src/internal/wire.js';

import { ContactsRegion } from '../../examples/crm/src/components/contacts.js';
import { DealDetailRegion } from '../../examples/crm/src/components/deal-detail.js';
import { PipelineRegion } from '../../examples/crm/src/components/pipeline.js';

const crmLiveTargetRenderers = [
  componentLiveTargetRenderer({
    component: ContactsRegion,
    componentId: 'components/contacts/contacts-region',
  }),
  componentLiveTargetRenderer({
    component: PipelineRegion,
    componentId: 'components/pipeline/pipeline-region',
  }),
  componentLiveTargetRenderer({
    component: DealDetailRegion,
    componentId: 'components/deal-detail/deal-detail-region',
  }),
];

/** Vitest-only renderer inventory for the CRM app's exact generated graph. */
export function runWithCrmGeneratedGraphs<Value>(load: () => Value): Value {
  return runWithExampleGeneratedGraphs(crmLiveTargetRenderers, load);
}
