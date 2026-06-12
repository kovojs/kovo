import { describe, expect, it } from 'vitest';

import { computeFloatingPosition, oppositePlacement } from './positioning-fallback.js';

const viewport = { x: 0, y: 0, width: 300, height: 200 };

describe('headless-ui positioning fallback', () => {
  it('places floating geometry from deterministic rect inputs', () => {
    expect(
      computeFloatingPosition({
        anchor: { x: 100, y: 80, width: 40, height: 20 },
        floating: { width: 80, height: 30 },
        offset: 8,
        placement: 'bottom',
        viewport,
      }),
    ).toMatchObject({
      fits: true,
      placement: 'bottom',
      shifted: false,
      x: 80,
      y: 108,
    });
  });

  it('flips to the opposite side when the preferred placement collides', () => {
    expect(
      computeFloatingPosition({
        anchor: { x: 120, y: 170, width: 40, height: 20 },
        floating: { width: 80, height: 40 },
        offset: 4,
        placement: 'bottom',
        viewport,
      }),
    ).toMatchObject({
      fits: true,
      initialPlacement: 'bottom',
      placement: 'top',
      shifted: false,
      x: 100,
      y: 126,
    });
  });

  it('shifts the selected placement inside padded viewport bounds', () => {
    expect(
      computeFloatingPosition({
        anchor: { x: 4, y: 80, width: 20, height: 20 },
        floating: { width: 90, height: 40 },
        placement: 'bottom-start',
        viewport,
        viewportPadding: 12,
      }),
    ).toMatchObject({
      fits: true,
      placement: 'bottom-start',
      shifted: true,
      x: 12,
      y: 100,
    });
  });

  it('uses explicit fallback placement ordering before the automatic opposite side', () => {
    expect(
      computeFloatingPosition({
        anchor: { x: 260, y: 80, width: 30, height: 20 },
        fallbackPlacements: ['left-start'],
        floating: { width: 80, height: 40 },
        offset: { mainAxis: 6 },
        placement: 'right-start',
        viewport,
      }),
    ).toMatchObject({
      fits: true,
      placement: 'left-start',
      shifted: false,
      x: 174,
      y: 80,
    });
  });

  it('reports residual overflow when the floating size cannot fit in the viewport', () => {
    const result = computeFloatingPosition({
      anchor: { x: 40, y: 40, width: 10, height: 10 },
      floating: { width: 400, height: 60 },
      placement: 'bottom',
      viewport,
      viewportPadding: 10,
    });

    expect(result.fits).toBe(false);
    expect(result.shifted).toBe(true);
    expect(result.overflow.right).toBe(120);
  });

  it('mirrors start and end alignment for right-to-left horizontal placements', () => {
    expect(
      computeFloatingPosition({
        anchor: { x: 100, y: 80, width: 40, height: 20 },
        floating: { width: 80, height: 30 },
        placement: 'bottom-start',
        viewport,
        writingDirection: 'rtl',
      }),
    ).toMatchObject({ x: 60, y: 100 });

    expect(oppositePlacement('bottom-end')).toBe('top-end');
  });
});
