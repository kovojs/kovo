/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { scrollQuery, type ScrollResult } from './shared';

export const ScrollPanel = component({
  queries: { scroll: scrollQuery },
  render: ({ scroll }: { scroll: ScrollResult }) => {
    const rows = Array.from({ length: 28 }, (_value, index) => {
      const rowNumber = index + 1;
      return {
        label:
          rowNumber === 14
            ? `Inserted content version ${scroll.version}`
            : `Stable row ${rowNumber}`,
        rowNumber,
      };
    });
    return (
      <section kovo-key="scroll-panel">
        <div kovo-key="scroll-region" data-scroll-region>
          {rows.map((row) => (
            <p kovo-key={`row-${row.rowNumber}`} data-row={row.rowNumber}>
              {row.label}
            </p>
          ))}
        </div>
        <p>
          Server version <output>{scroll.version}</output>
        </p>
      </section>
    );
  },
});
