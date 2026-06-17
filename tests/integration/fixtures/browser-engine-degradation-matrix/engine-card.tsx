/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { engineQuery, type EngineResult } from './shared';

export const EngineMatrixCard = component({
  fragmentTarget: true,
  queries: { engine: engineQuery },
  render: ({ engine }: { engine: EngineResult }) => (
    <engine-matrix-card kovo-fragment-target="engine-card">
      <output>{engine.message}</output>
    </engine-matrix-card>
  ),
});
