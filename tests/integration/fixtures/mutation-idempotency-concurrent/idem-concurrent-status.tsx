/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { idemConcurrentQuery, type IdemConcurrentResult } from './shared';

export const IdemConcurrentStatus = component({
  queries: { idem: idemConcurrentQuery },
  render: ({ idem }: { idem: IdemConcurrentResult }) => <output>{idem.count}</output>,
});
