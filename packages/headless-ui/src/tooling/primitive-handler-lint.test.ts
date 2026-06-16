import { describe, expect, it } from 'vitest';

import {
  formatPrimitiveHandlerLintFindings,
  lintPrimitiveHandlers,
} from './primitive-handler-lint.js';

describe('primitive handler lint', () => {
  it('accepts marked primitive handlers that no-op on defaultPrevented', () => {
    expect(
      lintPrimitiveHandlers([
        {
          path: 'src/dialog.ts',
          source: `
/** @kovoPrimitiveHandler */
export function triggerClick(event: Event): void {
  if (event.defaultPrevented) return;
  openDialog();
}

/** @kovoPrimitiveHandler */
export const closeClick = (evt: Event): void => {
  if (evt.defaultPrevented === true) {
    return;
  }
  closeDialog();
};
`,
        },
      ]),
    ).toEqual([]);
  });

  it('reports marked primitive handlers that do not start with the guard from SPEC §4.6', () => {
    const findings = lintPrimitiveHandlers([
      {
        path: 'src/tooltip.ts',
        source: `
const setup = true;

/** @kovoPrimitiveHandler */
export const triggerPointerEnter = (event: Event): void => {
  showTooltip();
};
`,
      },
    ]);

    expect(findings).toEqual([
      {
        code: 'KOVO_HUI001',
        column: 14,
        handlerName: 'triggerPointerEnter',
        line: 5,
        message:
          'Primitive handler must begin by no-oping when event.defaultPrevented is true; SPEC.md §4.6 keeps chained on:* handlers running left-to-right and assigns cancellation handling to primitive handlers.',
        path: 'src/tooltip.ts',
      },
    ]);
    expect(formatPrimitiveHandlerLintFindings(findings)).toBe(
      'src/tooltip.ts:5:14 KOVO_HUI001 triggerPointerEnter Primitive handler must begin by no-oping when event.defaultPrevented is true; SPEC.md §4.6 keeps chained on:* handlers running left-to-right and assigns cancellation handling to primitive handlers.',
    );
  });

  it('reports unmarked event-shaped primitive handlers by default', () => {
    const findings = lintPrimitiveHandlers([
      {
        path: 'src/tooltip.ts',
        source: `
export function tooltipPointerEnter(event: Event): void {
  showTooltip();
}
`,
      },
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'KOVO_HUI001',
        handlerName: 'tooltipPointerEnter',
        path: 'src/tooltip.ts',
      }),
    ]);
  });

  it('requires the guard to check the first event parameter', () => {
    expect(
      lintPrimitiveHandlers([
        {
          path: 'src/popover.ts',
          source: `
/** @kovoPrimitiveHandler */
export function triggerClick(event: Event): void {
  if (other.defaultPrevented) return;
  openPopover();
}
`,
        },
      ]),
    ).toHaveLength(1);
  });
});
