/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { runnerQuery } from './shared';

export const PrimaryRunner = component({
  queries: { runner: runnerQuery },
  render: () => (
    <primary-runner-host data-stage="active">
      <button type="button" data-primary-runner on:click="/client.ts#startLongTask">
        Start primary task
      </button>
    </primary-runner-host>
  ),
});
