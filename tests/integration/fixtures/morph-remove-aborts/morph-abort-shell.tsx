/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { trustedHtml } from '@kovojs/server';

import { morphAbortQuery, type MorphAbortResult } from './shared';

export const MorphAbortShell = component({
  queries: { morphAbort: morphAbortQuery },
  render: ({ morphAbort }: { morphAbort: MorphAbortResult }) => (
    <div>
      {morphAbort.stage === 'removed' ? (
        <section data-morph-stage="removed">
          {trustedHtml(
            '<replacement-abort-island kovo-c="replacement-abort-island"><button type="button" on:click="/client.ts#touchReplacement">Touch replacement</button></replacement-abort-island>',
          )}
        </section>
      ) : (
        <section data-morph-stage="active">
          {trustedHtml(
            '<abortable-island kovo-c="abortable-island"><button type="button" on:click="/client.ts#startAbortable">Start abortable</button></abortable-island>',
          )}
        </section>
      )}
    </div>
  ),
});
