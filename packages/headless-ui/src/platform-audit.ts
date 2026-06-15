export const h1HeadlessUiPrimitives = [
  'accordion',
  'alert-dialog',
  'avatar',
  'checkbox',
  'collapsible',
  'dialog',
  'hover-card',
  'meter',
  'popover',
  'progress',
  'separator',
  'switch',
  'toggle',
  'tooltip',
] as const;

export type HeadlessUiH1Primitive = (typeof h1HeadlessUiPrimitives)[number];

export type NativePlatformMechanism =
  | 'css-anchor-positioning'
  | 'css-starting-style'
  | 'css-transition-behavior-allow-discrete'
  | 'html-button'
  | 'html-checkbox-input'
  | 'html-details'
  | 'html-dialog'
  | 'html-meter'
  | 'html-popover'
  | 'html-progress'
  | 'invoker-command';

export type PlatformConcern =
  | 'disclosure'
  | 'exit-animation'
  | 'floating-position'
  | 'form-control'
  | 'semantic-only'
  | 'top-layer';

export type LazyFallbackModule = 'floating-positioning';

export interface PlatformConcernAudit {
  concern: PlatformConcern;
  nativeMechanisms: readonly NativePlatformMechanism[];
  decision: 'native' | 'native-enhancement' | 'not-applicable';
  lazyFallbackModule?: LazyFallbackModule;
  lazyFallbackLoad?: 'first-trigger-interaction';
  note: string;
}

export interface PrimitivePlatformAudit {
  primitive: HeadlessUiH1Primitive;
  concerns: readonly PlatformConcernAudit[];
  specSections: readonly string[];
}

const sharedLayerAnimationConcern = {
  concern: 'exit-animation',
  decision: 'native-enhancement',
  nativeMechanisms: ['css-starting-style', 'css-transition-behavior-allow-discrete'] as const,
  note: 'Use @starting-style plus transition-behavior: allow-discrete as progressive CSS for entry/exit; JS-coordinated exit stays an escape hatch, not the v1 default.',
} satisfies PlatformConcernAudit;

const noFloatingFallbackConcern = {
  concern: 'floating-position',
  decision: 'not-applicable',
  nativeMechanisms: [] as const,
  note: 'The primitive does not place a floating surface, so H0 should not load positioning code.',
} satisfies PlatformConcernAudit;

const floatingAnchorFallbackConcern = {
  concern: 'floating-position',
  decision: 'native-enhancement',
  lazyFallbackLoad: 'first-trigger-interaction',
  lazyFallbackModule: 'floating-positioning',
  nativeMechanisms: ['css-anchor-positioning'] as const,
  note: 'Prefer CSS anchor positioning; lazily import the floating fallback only after the first trigger interaction when support or layout constraints require JS placement.',
} satisfies PlatformConcernAudit;

const popoverTopLayerConcern = {
  concern: 'top-layer',
  decision: 'native',
  nativeMechanisms: ['html-popover'] as const,
  note: 'Use the native Popover API for top-layer participation and light-dismiss behavior.',
} satisfies PlatformConcernAudit;

const semanticOnlyConcern = {
  concern: 'semantic-only',
  decision: 'native',
  nativeMechanisms: [] as const,
  note: 'No platform substitution or lazy module is needed beyond emitted semantic markup.',
} satisfies PlatformConcernAudit;

/**
 * F5 platform audit for H1 primitives.
 *
 * SPEC.md §1.3 allows platform-led enhancements to degrade rather than grow
 * eager polyfills. SPEC.md §5.2.4 makes native dialog/popover/details emission a
 * compiler-visible substitution, so this table is executable handoff evidence
 * for H0/H1 rather than prose in the plan.
 */
export const h1PlatformAudit = {
  accordion: {
    primitive: 'accordion',
    concerns: [
      {
        concern: 'disclosure',
        decision: 'native',
        nativeMechanisms: ['html-details'] as const,
        note: 'Render each item with native details/summary disclosure; JS is reserved for grouped keyboard behavior.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3', 'SPEC.md §5.2.4'],
  },
  'alert-dialog': {
    primitive: 'alert-dialog',
    concerns: [
      {
        concern: 'top-layer',
        decision: 'native',
        nativeMechanisms: ['html-dialog', 'invoker-command'] as const,
        note: 'Use native modal dialog semantics and invoker commands for open/close wiring.',
      },
      sharedLayerAnimationConcern,
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3', 'SPEC.md §4.5', 'SPEC.md §5.2.4'],
  },
  avatar: {
    primitive: 'avatar',
    concerns: [semanticOnlyConcern, noFloatingFallbackConcern],
    specSections: ['SPEC.md §1.3'],
  },
  checkbox: {
    primitive: 'checkbox',
    concerns: [
      {
        concern: 'form-control',
        decision: 'native',
        nativeMechanisms: ['html-checkbox-input'] as const,
        note: 'Render a real checkbox input so no-JS POST and checked/disabled behavior remain native.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3'],
  },
  collapsible: {
    primitive: 'collapsible',
    concerns: [
      {
        concern: 'disclosure',
        decision: 'native',
        nativeMechanisms: ['html-details'] as const,
        note: 'Use native details/summary for open state and no-JS disclosure behavior.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3', 'SPEC.md §5.2.4'],
  },
  dialog: {
    primitive: 'dialog',
    concerns: [
      {
        concern: 'top-layer',
        decision: 'native',
        nativeMechanisms: ['html-dialog', 'invoker-command'] as const,
        note: 'Use native dialog top-layer behavior and invoker commands instead of a dismissable-layer runtime.',
      },
      sharedLayerAnimationConcern,
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3', 'SPEC.md §4.5', 'SPEC.md §5.2.4'],
  },
  'hover-card': {
    primitive: 'hover-card',
    concerns: [popoverTopLayerConcern, floatingAnchorFallbackConcern, sharedLayerAnimationConcern],
    specSections: ['SPEC.md §1.3', 'SPEC.md §5.2.4'],
  },
  meter: {
    primitive: 'meter',
    concerns: [
      {
        concern: 'semantic-only',
        decision: 'native',
        nativeMechanisms: ['html-meter'] as const,
        note: 'Use the native meter element for range semantics.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3'],
  },
  popover: {
    primitive: 'popover',
    concerns: [popoverTopLayerConcern, floatingAnchorFallbackConcern, sharedLayerAnimationConcern],
    specSections: ['SPEC.md §1.3', 'SPEC.md §5.2.4'],
  },
  progress: {
    primitive: 'progress',
    concerns: [
      {
        concern: 'semantic-only',
        decision: 'native',
        nativeMechanisms: ['html-progress'] as const,
        note: 'Use the native progress element for progressbar semantics.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3'],
  },
  separator: {
    primitive: 'separator',
    concerns: [semanticOnlyConcern, noFloatingFallbackConcern],
    specSections: ['SPEC.md §1.3'],
  },
  switch: {
    primitive: 'switch',
    concerns: [
      {
        concern: 'form-control',
        decision: 'native',
        nativeMechanisms: ['html-checkbox-input'] as const,
        note: 'Use a real checkbox-backed control so form submission and disabled handling stay native.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3'],
  },
  toggle: {
    primitive: 'toggle',
    concerns: [
      {
        concern: 'form-control',
        decision: 'native',
        nativeMechanisms: ['html-button'] as const,
        note: 'Use a native button with pressed state attributes; no positioning or fallback module is involved.',
      },
      noFloatingFallbackConcern,
    ],
    specSections: ['SPEC.md §1.3'],
  },
  tooltip: {
    primitive: 'tooltip',
    concerns: [floatingAnchorFallbackConcern, sharedLayerAnimationConcern],
    specSections: ['SPEC.md §1.3', 'SPEC.md §5.2.4'],
  },
} as const satisfies Record<HeadlessUiH1Primitive, PrimitivePlatformAudit>;

export function getPrimitivePlatformAudit(
  primitive: HeadlessUiH1Primitive,
): PrimitivePlatformAudit {
  return h1PlatformAudit[primitive];
}

export function primitivesRequiringLazyFallback(
  module: LazyFallbackModule,
): readonly HeadlessUiH1Primitive[] {
  return h1HeadlessUiPrimitives.filter((primitive) =>
    getPrimitivePlatformAudit(primitive).concerns.some(
      (concern) => concern.lazyFallbackModule === module,
    ),
  );
}

export function primitiveUsesNativeMechanism(
  primitive: HeadlessUiH1Primitive,
  mechanism: NativePlatformMechanism,
): boolean {
  return getPrimitivePlatformAudit(primitive).concerns.some((concern) =>
    concern.nativeMechanisms.includes(mechanism),
  );
}
