import type { DiagnosticCode } from '@kovojs/core';

import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import { analyzeSafeComponentFixes, type SafeComponentFixCode } from '../scan/safe-fixes.js';

/** @internal Closed source-analyzer corpus authored by the cost-to-green implementation agent. */
export interface AgentAuthoredCostToGreenCase {
  readonly code: DiagnosticCode;
  readonly defectOwner?: string;
  readonly fileName: string;
  readonly id: string;
  readonly safeRewrite: boolean;
  readonly source: string;
}

/** @internal Per-diagnostic cost measurement over the agent-authored corpus. */
export type CostToGreenDiagnosticMeasurement =
  | {
      readonly code: DiagnosticCode;
      readonly costDelta: number | null;
      readonly defectOwner: string;
      readonly escapeEditAtoms: 2;
      readonly safeEditAtoms: number | null;
      readonly status: 'framework-defect';
      readonly traffic: number;
    }
  | {
      readonly code: SafeComponentFixCode;
      readonly costDelta: number;
      readonly defectOwner: null;
      readonly escapeEditAtoms: 2;
      readonly safeEditAtoms: number;
      readonly status: 'safe-rewrite';
      readonly traffic: number;
    };

/** @internal Versioned, deterministic report returned by `kovo fix --cost-report`. */
export interface AgentAuthoredCostToGreenReport {
  readonly cases: number;
  readonly corpusAuthor: 'codex-agent-cost-to-green-20260720';
  readonly diagnostics: readonly CostToGreenDiagnosticMeasurement[];
  readonly highestTrafficSafeCodes: readonly SafeComponentFixCode[];
  readonly metric: 'safe AST-node edit atoms minus the two argv atoms in --allow-diagnostic CODE';
  readonly schema: 'kovo.cost-to-green/v1';
}

// The corpus intentionally puts ambiguous output-context obligations ahead of the two highest-
// traffic *suitable* recipes. KV236 has no general behavior-preserving rewrite: choosing a route,
// a sanitizer policy, or a trusted value is an author decision. It remains a named framework UX
// defect rather than being laundered into an automatic trust escape. KV232 deletion must preserve
// the exact semantic behavior fingerprint. KV223 deletion is a compiler-derived hardening: the
// invalid authored lowered-IR stamp suppresses escaping, so there is no accepted behavior to
// preserve; the closed AST recipe must instead recompile diagnostic-free through the genuine gate.
/** @internal Versioned authored fixtures measured by the cost-to-green report. */
export const agentAuthoredCostToGreenCorpus = [
  {
    code: 'KV236',
    defectOwner: 'compiler-output-safety',
    fileName: 'corpus/dynamic-script.tsx',
    id: 'dynamic-script-policy-required',
    safeRewrite: false,
    source: `
export const DynamicScript = component({
  render: ({ profile }) => <script>{profile.script}</script>,
});
`,
  },
  {
    code: 'KV236',
    defectOwner: 'compiler-output-safety',
    fileName: 'corpus/dynamic-style.tsx',
    id: 'dynamic-style-policy-required',
    safeRewrite: false,
    source: `
export const DynamicStyle = component({
  render: ({ profile }) => <style>{profile.css}</style>,
});
`,
  },
  {
    code: 'KV236',
    defectOwner: 'compiler-output-safety',
    fileName: 'corpus/nested-dynamic-script.tsx',
    id: 'nested-dynamic-script-policy-required',
    safeRewrite: false,
    source: `
export const NestedDynamicScript = component({
  render: ({ profile }) => <main><script>{profile.bootstrap}</script></main>,
});
`,
  },
  {
    code: 'KV236',
    defectOwner: 'compiler-output-safety',
    fileName: 'corpus/literal-onclick.tsx',
    id: 'literal-onclick-policy-required',
    safeRewrite: false,
    source: `
export const LiteralOnclick = component({
  render: () => <button onclick="alert(1)">Click</button>,
});
`,
  },
  {
    code: 'KV236',
    defectOwner: 'compiler-output-safety',
    fileName: 'corpus/literal-srcdoc.tsx',
    id: 'literal-srcdoc-policy-required',
    safeRewrite: false,
    source: `
export const LiteralSrcdoc = component({
  render: () => <iframe srcdoc={"<script>alert(1)</script>"} />,
});
`,
  },
  {
    code: 'KV232',
    fileName: 'corpus/equal-role.tsx',
    id: 'primitive-owned-state-tooltip',
    safeRewrite: true,
    source: `
export const TooltipState = component({
  render: () => (
    <Tooltip.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state="open">Open</button>}
    </Tooltip.Trigger>
  ),
});
`,
  },
  {
    code: 'KV232',
    fileName: 'corpus/equal-label.tsx',
    id: 'primitive-owned-state-menu',
    safeRewrite: true,
    source: `
export const MenuState = component({
  render: () => (
    <Menu.Item attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state="highlighted">Open</button>}
    </Menu.Item>
  ),
});
`,
  },
  {
    code: 'KV232',
    fileName: 'corpus/equal-state.tsx',
    id: 'primitive-owned-state-dialog',
    safeRewrite: true,
    source: `
export const DialogState = component({
  render: () => (
    <Dialog.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state={'open'}>Open</button>}
    </Dialog.Trigger>
  ),
});
`,
  },
  {
    code: 'KV232',
    fileName: 'corpus/equal-live.tsx',
    id: 'primitive-owned-state-popover',
    safeRewrite: true,
    source: `
export const PopoverState = component({
  render: () => (
    <Popover.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => (
        <button {...attrs} data-state="open">Open</button>
      )}
    </Popover.Trigger>
  ),
});
`,
  },
  {
    code: 'KV223',
    fileName: 'corpus/redundant-bind.tsx',
    id: 'redundant-data-bind',
    safeRewrite: true,
    source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
  },
  {
    code: 'KV223',
    fileName: 'corpus/redundant-user-bind.tsx',
    id: 'redundant-user-data-bind',
    safeRewrite: true,
    source: `
export const UserName = component({
  queries: { user: userQuery },
  render: ({ user }) => <strong data-bind="user.name">{user.name}</strong>,
});
`,
  },
  {
    code: 'KV223',
    fileName: 'corpus/redundant-order-bind.tsx',
    id: 'redundant-order-data-bind',
    safeRewrite: true,
    source: `
export const OrderTotal = component({
  queries: { order: orderQuery },
  render: ({ order }) => <output data-bind="order.total">{order.total}</output>,
});
`,
  },
] as const satisfies readonly AgentAuthoredCostToGreenCase[];

/**
 * Compile every corpus case, re-prove every claimed safe rewrite, and aggregate one structural
 * cost measurement per diagnostic. A missing safe recipe is represented as an infinite safe cost
 * (`null` on the wire) and MUST carry a non-empty framework owner.
 *
 * @internal Used by `kovo fix --cost-report` and its release gate.
 */
export function measureAgentAuthoredCostToGreenCorpus(): AgentAuthoredCostToGreenReport {
  const accumulators: {
    code: DiagnosticCode;
    defectOwner?: string;
    safeCosts: number[];
    safeRewrite: boolean;
    traffic: number;
  }[] = [];

  for (let caseIndex = 0; caseIndex < agentAuthoredCostToGreenCorpus.length; caseIndex += 1) {
    const corpusCase = agentAuthoredCostToGreenCorpus[caseIndex]!;
    const analysis = analyzeSafeComponentFixes({
      fileName: corpusCase.fileName,
      source: corpusCase.source,
    });
    const diagnosticCodes = uniqueDiagnosticCodes(analysis.diagnosticsBefore);
    if (!diagnosticCodesMatchCase(diagnosticCodes, corpusCase.code)) {
      throw new Error(
        `Cost-to-green corpus ${corpusCase.id} drifted: expected only ${corpusCase.code}, observed ${compilerArrayJoin(diagnosticCodes, ',') || 'green'}.`,
      );
    }
    if (corpusCase.safeRewrite !== (analysis.status === 'fixable')) {
      throw new Error(
        `Cost-to-green corpus ${corpusCase.id} safe-rewrite verdict drifted to ${analysis.status}.`,
      );
    }
    const corpusDefectOwner = 'defectOwner' in corpusCase ? corpusCase.defectOwner : undefined;

    let accumulator = accumulatorFor(accumulators, corpusCase.code);
    if (accumulator === undefined) {
      accumulator = {
        code: corpusCase.code,
        ...(corpusDefectOwner === undefined ? {} : { defectOwner: corpusDefectOwner }),
        safeCosts: [],
        safeRewrite: corpusCase.safeRewrite,
        traffic: 0,
      };
      compilerArrayAppend(accumulators, accumulator, 'Cost-to-green accumulators');
    }
    if (accumulator.safeRewrite !== corpusCase.safeRewrite) {
      throw new Error(`Cost-to-green corpus mixes safe and unsafe recipes for ${corpusCase.code}.`);
    }
    if (accumulator.defectOwner !== corpusDefectOwner) {
      throw new Error(
        `Cost-to-green corpus has inconsistent defect owners for ${corpusCase.code}.`,
      );
    }
    accumulator.traffic += 1;
    if (analysis.status === 'fixable') {
      let cost = 0;
      for (let editIndex = 0; editIndex < analysis.edits.length; editIndex += 1) {
        cost += analysis.edits[editIndex]!.editAtoms;
      }
      compilerArrayAppend(accumulator.safeCosts, cost, 'Cost-to-green safe costs');
    }
  }

  stableTrafficSort(accumulators);
  const diagnostics: CostToGreenDiagnosticMeasurement[] = [];
  const safeCodes: { code: SafeComponentFixCode; traffic: number }[] = [];
  for (let index = 0; index < accumulators.length; index += 1) {
    const accumulator = accumulators[index]!;
    if (!accumulator.safeRewrite) {
      const defectOwner =
        accumulator.defectOwner === undefined
          ? undefined
          : compilerStringTrim(accumulator.defectOwner);
      if (!defectOwner) {
        throw new Error(`Escape-cheaper diagnostic ${accumulator.code} has no framework owner.`);
      }
      compilerArrayAppend(
        diagnostics,
        {
          code: accumulator.code,
          costDelta: null,
          defectOwner,
          escapeEditAtoms: 2,
          safeEditAtoms: null,
          status: 'framework-defect',
          traffic: accumulator.traffic,
        },
        'Cost-to-green measurements',
      );
      continue;
    }

    const safeEditAtoms = medianInteger(accumulator.safeCosts);
    const costDelta = safeEditAtoms - 2;
    if (accumulator.code !== 'KV223' && accumulator.code !== 'KV232') {
      throw new Error(
        `Safe cost-to-green corpus row ${accumulator.code} has no closed rewrite code.`,
      );
    }
    const code = accumulator.code;
    compilerArrayAppend(safeCodes, { code, traffic: accumulator.traffic }, 'Safe-fix traffic');
    if (costDelta > 0) {
      const defectOwner =
        accumulator.defectOwner === undefined
          ? undefined
          : compilerStringTrim(accumulator.defectOwner);
      if (!defectOwner) {
        throw new Error(`Escape-cheaper diagnostic ${code} has no framework owner.`);
      }
      compilerArrayAppend(
        diagnostics,
        {
          code,
          costDelta,
          defectOwner,
          escapeEditAtoms: 2,
          safeEditAtoms,
          status: 'framework-defect',
          traffic: accumulator.traffic,
        },
        'Cost-to-green measurements',
      );
      continue;
    }
    compilerArrayAppend(
      diagnostics,
      {
        code,
        costDelta,
        defectOwner: null,
        escapeEditAtoms: 2,
        safeEditAtoms,
        status: 'safe-rewrite',
        traffic: accumulator.traffic,
      },
      'Cost-to-green measurements',
    );
  }
  stableTrafficSort(safeCodes);

  return {
    cases: agentAuthoredCostToGreenCorpus.length,
    corpusAuthor: 'codex-agent-cost-to-green-20260720',
    diagnostics,
    highestTrafficSafeCodes: [safeCodes[0]!.code, safeCodes[1]!.code],
    metric: 'safe AST-node edit atoms minus the two argv atoms in --allow-diagnostic CODE',
    schema: 'kovo.cost-to-green/v1',
  };
}

function diagnosticCodesMatchCase(
  observed: readonly DiagnosticCode[],
  expected: DiagnosticCode,
): boolean {
  if (observed.length === 1 && observed[0] === expected) return true;
  return (
    expected === 'KV223' &&
    observed.length === 2 &&
    diagnosticCodePresent(observed, 'KV223') &&
    diagnosticCodePresent(observed, 'KV235')
  );
}

function diagnosticCodePresent(
  observed: readonly DiagnosticCode[],
  expected: DiagnosticCode,
): boolean {
  for (let index = 0; index < observed.length; index += 1) {
    if (observed[index] === expected) return true;
  }
  return false;
}

function uniqueDiagnosticCodes(
  diagnostics: readonly { readonly code: DiagnosticCode }[],
): DiagnosticCode[] {
  const codes: DiagnosticCode[] = [];
  for (let diagnosticIndex = 0; diagnosticIndex < diagnostics.length; diagnosticIndex += 1) {
    const code = diagnostics[diagnosticIndex]!.code;
    let seen = false;
    for (let codeIndex = 0; codeIndex < codes.length; codeIndex += 1) {
      if (codes[codeIndex] === code) seen = true;
    }
    if (!seen) compilerArrayAppend(codes, code, 'Cost-to-green diagnostic codes');
  }
  return codes;
}

function accumulatorFor<Value extends { readonly code: DiagnosticCode }>(
  values: readonly Value[],
  code: DiagnosticCode,
): Value | undefined {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]!.code === code) return values[index];
  }
  return undefined;
}

function stableTrafficSort<
  Value extends { readonly code: DiagnosticCode; readonly traffic: number },
>(values: Value[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertion = index;
    while (
      insertion > 0 &&
      (values[insertion - 1]!.traffic < value.traffic ||
        (values[insertion - 1]!.traffic === value.traffic &&
          values[insertion - 1]!.code > value.code))
    ) {
      values[insertion] = values[insertion - 1]!;
      insertion -= 1;
    }
    values[insertion] = value;
  }
}

function medianInteger(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Safe cost-to-green row has no measured cases.');
  const sorted = [...values];
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && sorted[insertion - 1]! > value) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}
