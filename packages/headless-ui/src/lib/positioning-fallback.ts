export type FloatingPlacementSide = 'bottom' | 'left' | 'right' | 'top';
export type FloatingPlacementAlign = 'center' | 'end' | 'start';
export type FloatingPlacement =
  | FloatingPlacementSide
  | `${FloatingPlacementSide}-${Exclude<FloatingPlacementAlign, 'center'>}`;

export interface FloatingRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface FloatingSize {
  readonly height: number;
  readonly width: number;
}

export interface FloatingOffset {
  readonly crossAxis?: number;
  readonly mainAxis?: number;
}

export interface FloatingOverflow {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface FloatingPositionOptions {
  readonly anchor: FloatingRect;
  readonly fallbackPlacements?: readonly FloatingPlacement[];
  readonly floating: FloatingSize;
  readonly flip?: boolean;
  readonly offset?: FloatingOffset | number;
  readonly placement?: FloatingPlacement;
  readonly shift?: boolean;
  readonly viewport: FloatingRect;
  readonly viewportPadding?: number;
  readonly writingDirection?: 'ltr' | 'rtl';
}

export interface FloatingPosition {
  readonly fits: boolean;
  readonly initialPlacement: FloatingPlacement;
  readonly overflow: FloatingOverflow;
  readonly placement: FloatingPlacement;
  readonly shifted: boolean;
  readonly x: number;
  readonly y: number;
}

interface ParsedPlacement {
  readonly align: FloatingPlacementAlign;
  readonly side: FloatingPlacementSide;
}

interface Candidate {
  readonly overflow: FloatingOverflow;
  readonly placement: FloatingPlacement;
  readonly rawX: number;
  readonly rawY: number;
  readonly score: number;
}

export function computeFloatingPosition(options: FloatingPositionOptions): FloatingPosition {
  const initialPlacement = options.placement ?? 'bottom';
  const placements = candidatePlacements(
    initialPlacement,
    options.fallbackPlacements,
    options.flip ?? true,
  );
  const offset = normalizeOffset(options.offset);
  const padding = Math.max(0, options.viewportPadding ?? 0);
  const candidates = placements.map((placement) =>
    candidateForPlacement(placement, options, offset, padding),
  );
  const selected = candidates.reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best,
  );
  const shifted = options.shift ?? true;
  const x = shifted
    ? clampToViewport(selected.rawX, options.floating.width, options.viewport, 'x', padding)
    : selected.rawX;
  const y = shifted
    ? clampToViewport(selected.rawY, options.floating.height, options.viewport, 'y', padding)
    : selected.rawY;
  const overflow = measureOverflow(
    { x, y, width: options.floating.width, height: options.floating.height },
    options.viewport,
    padding,
  );

  return {
    fits: overflowScore(overflow) === 0,
    initialPlacement,
    overflow,
    placement: selected.placement,
    shifted: x !== selected.rawX || y !== selected.rawY,
    x,
    y,
  };
}

export function oppositePlacement(placement: FloatingPlacement): FloatingPlacement {
  const parsed = parsePlacement(placement);
  const oppositeSide: Record<FloatingPlacementSide, FloatingPlacementSide> = {
    bottom: 'top',
    left: 'right',
    right: 'left',
    top: 'bottom',
  };
  return formatPlacement(oppositeSide[parsed.side], parsed.align);
}

function candidatePlacements(
  placement: FloatingPlacement,
  fallbacks: readonly FloatingPlacement[] | undefined,
  flip: boolean,
): readonly FloatingPlacement[] {
  const ordered = [
    placement,
    ...(fallbacks ?? []),
    ...(flip ? [oppositePlacement(placement)] : []),
  ];
  return ordered.filter((candidate, index) => ordered.indexOf(candidate) === index);
}

function candidateForPlacement(
  placement: FloatingPlacement,
  options: FloatingPositionOptions,
  offset: Required<FloatingOffset>,
  padding: number,
): Candidate {
  const parsed = parsePlacement(placement);
  const { x, y } = rawCoordinates(parsed, options, offset);
  const overflow = measureOverflow(
    { x, y, width: options.floating.width, height: options.floating.height },
    options.viewport,
    padding,
  );

  return {
    overflow,
    placement,
    rawX: x,
    rawY: y,
    score: overflowScore(overflow),
  };
}

function rawCoordinates(
  placement: ParsedPlacement,
  options: FloatingPositionOptions,
  offset: Required<FloatingOffset>,
): { x: number; y: number } {
  const { anchor, floating } = options;
  const anchorRight = anchor.x + anchor.width;
  const anchorBottom = anchor.y + anchor.height;
  let x = alignCoordinate(
    anchor.x,
    anchor.width,
    floating.width,
    placement.align,
    options.writingDirection,
  );
  let y = alignCoordinate(anchor.y, anchor.height, floating.height, placement.align);

  if (placement.side === 'top') {
    y = anchor.y - floating.height - offset.mainAxis;
    x += offset.crossAxis;
  } else if (placement.side === 'bottom') {
    y = anchorBottom + offset.mainAxis;
    x += offset.crossAxis;
  } else if (placement.side === 'left') {
    x = anchor.x - floating.width - offset.mainAxis;
    y += offset.crossAxis;
  } else {
    x = anchorRight + offset.mainAxis;
    y += offset.crossAxis;
  }

  return { x, y };
}

function alignCoordinate(
  anchorStart: number,
  anchorSize: number,
  floatingSize: number,
  align: FloatingPlacementAlign,
  direction: 'ltr' | 'rtl' = 'ltr',
): number {
  if (align === 'center') return anchorStart + (anchorSize - floatingSize) / 2;
  if (align === 'start') {
    return direction === 'rtl' ? anchorStart + anchorSize - floatingSize : anchorStart;
  }
  return direction === 'rtl' ? anchorStart : anchorStart + anchorSize - floatingSize;
}

function clampToViewport(
  value: number,
  size: number,
  viewport: FloatingRect,
  axis: 'x' | 'y',
  padding: number,
): number {
  const start = axis === 'x' ? viewport.x : viewport.y;
  const extent = axis === 'x' ? viewport.width : viewport.height;
  const min = start + padding;
  const max = start + extent - padding - size;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function measureOverflow(
  rect: FloatingRect,
  viewport: FloatingRect,
  padding: number,
): FloatingOverflow {
  const minX = viewport.x + padding;
  const minY = viewport.y + padding;
  const maxX = viewport.x + viewport.width - padding;
  const maxY = viewport.y + viewport.height - padding;

  return {
    bottom: Math.max(0, rect.y + rect.height - maxY),
    left: Math.max(0, minX - rect.x),
    right: Math.max(0, rect.x + rect.width - maxX),
    top: Math.max(0, minY - rect.y),
  };
}

function normalizeOffset(offset: FloatingPositionOptions['offset']): Required<FloatingOffset> {
  if (typeof offset === 'number') return { crossAxis: 0, mainAxis: offset };
  return { crossAxis: offset?.crossAxis ?? 0, mainAxis: offset?.mainAxis ?? 0 };
}

function overflowScore(overflow: FloatingOverflow): number {
  return overflow.bottom + overflow.left + overflow.right + overflow.top;
}

function parsePlacement(placement: FloatingPlacement): ParsedPlacement {
  const [side, align = 'center'] = placement.split('-') as [
    FloatingPlacementSide,
    FloatingPlacementAlign | undefined,
  ];
  return { align, side };
}

function formatPlacement(
  side: FloatingPlacementSide,
  align: FloatingPlacementAlign,
): FloatingPlacement {
  return align === 'center' ? side : `${side}-${align}`;
}
