import { s } from '@kovojs/server';

import { app } from './scaffold-kovo.js';

/**
 * A typed, stateless interaction suitable for an immediately buildable scaffold. It proves the
 * mutation/form path without pretending that an unconfigured starter owns database authority.
 */
export const advanceDeal = app.mutation({
  access: app.publicAccess('stateless CRM scaffold workflow'),
  input: s.object({ dealId: s.string() }),
  handler(input) {
    return { dealId: input.dealId, stage: 'qualified' };
  },
  redirectTo() {
    return '/?advanced=1';
  },
});
