/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { idemQuery, type IdemResult } from './shared';

export const IdemStatus = component({
  queries: { idem: idemQuery },
  render: ({ idem }: { idem: IdemResult }) => <output>{idem.count}</output>,
});
