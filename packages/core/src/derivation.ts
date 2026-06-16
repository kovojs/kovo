import type { JsonValue } from './index.js';

// SPEC.md §10.5 (derivation algebra). This module is the *shared contract* every
// derived-optimism slice consumes: Stage-1 write→effect lowering, Stage-2 query
// shape classification, the Stage-3 effect-through-shape deriver, the codegen
// that lowers a `PatchProgram` to a committed transform, the diagnostics that
// report `derived ✓` / named punts, and the commuting-diagram property suite.
// The IRs are intentionally formatting-resistant data (no source strings) so
// every slice asserts algebraic class / status, never incidental formatting.

/**
 * Arithmetic operators in the §10.5 `Arith(op,v,v)` value grammar.
 *
 * @internal
 */
export type ArithOp = '*' | '+' | '-' | '/';

/**
 * Placeholder produced by the Stage-3 `INSERT × AGG` rule for Opaque columns:
 * a `tempId()`/`now()` standin, pending-styled and content-matched on reconcile
 * (SPEC.md §10.5). `tempId` is a fresh client-only id; `now` is a client clock.
 *
 * @internal
 */
export type PlaceholderKind = 'now' | 'tempId';

/**
 * §10.5 Stage-1 `value` grammar:
 * `value ::= Param(path) | Const | ColRef(t.c) | Arith(op,v,v) | Opaque`.
 *
 * `col` doubles as the §10.5 `ColRef(t.c)` in effects and, inside a row-scoped
 * `PatchOp`, as a read of the row's own column in client data (e.g. `stock -= q`
 * lowers to `arith('-', col('stock'), param('quantity'))`). `opaque` is the
 * Stage-1 "could not trace" marker; it never survives into a *derivable* program
 * (the deriver either replaces an INSERT column with a `placeholder` or punts).
 *
 * @internal
 */
export type SymbolicValue =
  | { kind: 'arith'; left: SymbolicValue; op: ArithOp; right: SymbolicValue }
  | { kind: 'col'; column: string; table?: string }
  | { kind: 'const'; value: JsonValue }
  | { kind: 'opaque'; expr: string }
  | { kind: 'param'; path: string }
  | { kind: 'placeholder'; placeholder: PlaceholderKind };

/**
 * One `eq(T.keyCol, expr)` predicate of a write `match` (SPEC.md §10.5/§11.1).
 *
 * @internal
 */
export interface SymbolicKeyEq {
  column: string;
  value: SymbolicValue;
}

/**
 * §10.5 write `match`. `keys` is the AND of eq-predicates on keys; `opaque`
 * marks ranges / `IN` / server-time / non-key predicates ⇒ punt.
 *
 * @internal
 */
export type SymbolicMatch =
  | { eq: readonly SymbolicKeyEq[]; kind: 'keys' }
  | { expr: string; kind: 'opaque' };

/**
 * §10.5 Stage-1 `effect` grammar:
 * `effect ::= INSERT{vals} | UPDATE{match, sets} | DELETE{match} | UPSERT{…}`.
 *
 * @internal
 */
export type SymbolicEffect =
  | { op: 'delete'; match: SymbolicMatch; table: string }
  | { op: 'insert'; table: string; values: Readonly<Record<string, SymbolicValue>> }
  | {
      match: SymbolicMatch;
      op: 'update';
      sets: Readonly<Record<string, SymbolicValue>>;
      table: string;
    }
  | {
      match: SymbolicMatch;
      op: 'upsert';
      sets: Readonly<Record<string, SymbolicValue>>;
      table: string;
      values: Readonly<Record<string, SymbolicValue>>;
    };

/**
 * One `ORDER BY` column of a rowset, with per-column opacity (SPEC.md §10.5).
 *
 * @internal
 */
export interface OrderByColumn {
  column: string;
  direction: 'asc' | 'desc';
  /** Opaque orderBy col ⇒ insertion point is undecidable ⇒ punt. */
  opaque?: boolean;
}

/**
 * One predicate in a rowset's filter chain.
 *
 * @internal
 */
export interface RowsetFilter {
  column: string;
  op: 'eq' | 'non-eq' | 'opaque';
  value?: SymbolicValue;
}

/**
 * §10.5 `R = rowset(filter chain, key, orderBy)` — the rows a query's aggregate
 * or projection ranges over.
 *
 * @internal
 */
export interface Rowset {
  filters: readonly RowsetFilter[];
  /** Instance/row key column (membership + content-match identity). */
  key: string | null;
  orderBy: readonly OrderByColumn[];
  /** The table the rowset ranges over (the touch-graph `via`). */
  table: string;
}

/**
 * Client-data availability witness (SPEC.md §10.5): the result path that already
 * ships an aggregate's contributing rows plus the contribution columns, proving
 * a `COUNT`/`SUM` delete/update can be computed client-side. Absent ⇒ punt.
 *
 * @internal
 */
export interface RowWitness {
  columns: readonly string[];
  rowsPath: string;
}

/**
 * §10.5 Stage-2 `field` grammar:
 * `field ::= Scalar(keyed-row col) | COUNT(R[,pred]) | SUM(R, arith) | AGG(R, projection)`.
 * `opaque` carries the punt reason for out-of-grammar shapes (window / GROUP BY
 * +HAVING / DISTINCT / raw `sql<T>` projections).
 *
 * @internal
 */
export type AlgebraicField =
  | { arith: SymbolicValue; kind: 'sum'; rowset: Rowset; witness?: RowWitness }
  | { column: string; kind: 'scalar'; rowset: Rowset }
  | {
      /** JSON type per projected column, so Opaque INSERT cols get type-correct placeholders. */
      columnTypes?: Readonly<Record<string, 'boolean' | 'number' | 'string'>>;
      kind: 'agg';
      projection: readonly string[];
      rowKey?: string;
      rowset: Rowset;
    }
  | { kind: 'count'; pred?: RowsetFilter; rowset: Rowset; witness?: RowWitness }
  | { kind: 'cursor'; rowset: Rowset }
  | { kind: 'opaque'; reason: PuntReason };

/**
 * A query's result classified into the §10.5 algebra: each result-field path maps
 * to an `AlgebraicField`. `rowsByTable` records which result path ships a given
 * table's rows (the AGG witness for sibling scalar/count/sum fields over the same
 * table).
 *
 * @internal
 */
export interface AlgebraicQueryShape {
  fields: Readonly<Record<string, AlgebraicField>>;
  query: string;
  /** table → result path that ships that table's rows (if any). */
  rowsByTable?: Readonly<Record<string, RowWitness>>;
}

/**
 * Match a client-data row by a column equal to a derived value (SPEC.md §10.5).
 *
 * @internal
 */
export interface RowMatch {
  column: string;
  value: SymbolicValue;
}

/**
 * §10.5 Stage-3 output: a JSON-patch program over client data. Each op is a
 * sound, client-computable mutation of the query value; `update-row` / `remove-row`
 * carry a `find-or-no-op` guard for rows possibly outside the client's rowset.
 *
 * @internal
 */
export type PatchOp =
  | {
      by: SymbolicValue;
      op: 'inc';
      /** dot-path to the numeric field (COUNT/SUM scalar). */
      path: string;
    }
  | {
      /** column summed over each row of `from`. */
      column: string;
      /** dot-path to the row array supplying the contributions. */
      from: string;
      op: 'resum';
      /** dot-path to the SUM scalar field. */
      path: string;
    }
  | {
      /** dot-path to the (fully-shipped) row array to count. */
      from: string;
      op: 'recount';
      /** dot-path to the COUNT scalar field. */
      path: string;
    }
  | {
      guard: 'find-or-noop';
      match: readonly RowMatch[];
      op: 'remove-row';
      /** dot-path to the row array. */
      path: string;
    }
  | {
      guard: 'find-or-noop';
      match: readonly RowMatch[];
      op: 'update-row';
      /** dot-path to the row array. */
      path: string;
      sets: Readonly<Record<string, SymbolicValue>>;
    }
  | {
      op: 'push-row';
      /** dot-path to the row array. */
      path: string;
      /** Placeholder columns (opaque INSERT cols) excluded from soundness equality. */
      placeholderColumns: readonly string[];
      /** Insertion point: list end/start, or an orderBy-driven sorted insert (SPEC.md §10.5). */
      position: PushPosition;
      row: Readonly<Record<string, SymbolicValue>>;
    }
  | {
      op: 'set-field';
      /** dot-path to the scalar field. */
      path: string;
      value: SymbolicValue;
    };

/**
 * Insertion point for a pushed row: list end/start, or a sorted insert by an orderBy column.
 *
 * @internal
 */
export type PushPosition = 'end' | 'start' | { column: string; direction: 'asc' | 'desc' };

/**
 * §10.5 Stage-3 result: a patch program over one query's client value.
 *
 * @internal
 */
export interface PatchProgram {
  ops: readonly PatchOp[];
  query: string;
}

/**
 * §10.5 PUNT list. A punt is *derivation metadata*, never optimistic coverage: it
 * explains why a pair still needs a hand-written transform or `'await-fragment'`,
 * and is rendered inline by `kovo explain --optimistic` (e.g. `PUNTED (Opaque:
 * compute_discount)`). The `code` set mirrors the SPEC PUNT list one-for-one.
 *
 * @internal
 */
export type PuntReason =
  | { code: 'interprocedural'; site: string }
  | { code: 'membership-entry'; field: string }
  | { code: 'no-row-witness'; field: string }
  | { code: 'non-key-match'; expr: string }
  | { code: 'opaque-orderby'; column: string }
  | { code: 'opaque-projection'; expr: string }
  | { code: 'opaque-set'; expr: string }
  | { code: 'opaque-shape'; detail?: string; shape: 'distinct' | 'group-by-having' | 'window' }
  | { code: 'unsupported'; detail: string }
  | { code: 'untraceable-param'; expr: string };

/**
 * Derivation outcome for one (mutation × invalidated query) pair (SPEC.md §10.5).
 *
 * @internal
 */
export type DerivationResult =
  | { kind: 'derived'; program: PatchProgram }
  | { kind: 'punt'; reason: PuntReason };

/**
 * Derivation status carried alongside (never *as*) optimistic coverage
 * (SPEC.md §10.5 / plan Phase 5). A `PUNTED` derivation leaves coverage
 * `UNHANDLED` unless a hand-written transform or `'await-fragment'` covers the pair.
 *
 * @internal
 */
export type DerivationStatus = { reason: PuntReason; status: 'PUNTED' } | { status: 'derived' };

/**
 * Construct a `derived` result.
 *
 * @internal
 */
export function derived(program: PatchProgram): DerivationResult {
  return { kind: 'derived', program };
}

/**
 * Construct a `punt` result.
 *
 * @internal
 */
export function punt(reason: PuntReason): DerivationResult {
  return { kind: 'punt', reason };
}

/**
 * Human-readable punt label for `kovo explain --optimistic` (SPEC.md §10.6 example
 * `PUNTED (Opaque: compute_discount)`). Surfaces wrap this as `PUNTED (<label>)`.
 *
 * @internal
 */
export function puntReasonLabel(reason: PuntReason): string {
  switch (reason.code) {
    case 'interprocedural':
      return `interprocedural KV406: ${reason.site}`;
    case 'membership-entry':
      return `membership entry: ${reason.field}`;
    case 'no-row-witness':
      return `no client rows: ${reason.field}`;
    case 'non-key-match':
      return `non-key match: ${reason.expr}`;
    case 'opaque-orderby':
      return `Opaque orderBy: ${reason.column}`;
    case 'opaque-projection':
      return `Opaque projection: ${reason.expr}`;
    case 'opaque-set':
      return `Opaque: ${reason.expr}`;
    case 'opaque-shape':
      return reason.detail ? `${reason.shape} shape: ${reason.detail}` : `${reason.shape} shape`;
    case 'unsupported':
      return `unsupported: ${reason.detail}`;
    case 'untraceable-param':
      return `untraceable param: ${reason.expr}`;
  }
}

/**
 * Options for the `PatchProgram` interpreter (and parity with codegen).
 *
 * @internal
 */
export interface ApplyPatchOptions {
  /** Client clock for `now` placeholders (default: a fixed sentinel for tests). */
  now?: () => JsonValue;
  /** Fresh-id factory for `tempId` placeholders (default: a fixed sentinel for tests). */
  tempId?: () => JsonValue;
}

/**
 * Reference interpreter for a `PatchProgram`: `patch(clientValue, input)`. It is
 * the executable meaning of the IR — the commuting-diagram suite (SPEC.md §10.5,
 * §11.4) runs it as `patch(clientShape(s), i)`, and the codegen lowers the same
 * ops to the committed transform. Pure: clones the input value, never mutates it.
 *
 * @internal
 */
export function applyPatchProgram(
  value: JsonValue,
  input: JsonValue,
  program: PatchProgram,
  options: ApplyPatchOptions = {},
): JsonValue {
  const tempId = options.tempId ?? (() => '__tempId__');
  const now = options.now ?? (() => 0);
  const next = structuredClone(value);

  for (const op of program.ops) {
    applyPatchOp(next, input, op, { now, tempId });
  }

  return next;
}

interface EvalContext {
  input: JsonValue;
  now: () => JsonValue;
  row?: JsonValue;
  tempId: () => JsonValue;
}

function applyPatchOp(
  value: JsonValue,
  input: JsonValue,
  op: PatchOp,
  placeholders: { now: () => JsonValue; tempId: () => JsonValue },
): void {
  const ctx: EvalContext = { input, now: placeholders.now, tempId: placeholders.tempId };

  switch (op.op) {
    case 'inc': {
      const target = parentRecordForPath(value, op.path);
      if (!target) return;
      const current = target.record[target.leaf];
      const base = typeof current === 'number' ? current : 0;
      target.record[target.leaf] = base + asNumber(evalSymbolicValue(op.by, ctx));
      return;
    }
    case 'push-row': {
      const list = listAtPath(value, op.path);
      if (!list) return;
      const row: Record<string, JsonValue> = {};
      for (const [column, columnValue] of Object.entries(op.row)) {
        row[column] = evalSymbolicValue(columnValue, ctx);
      }
      insertRow(list, row, op.position);
      return;
    }
    case 'recount': {
      const target = parentRecordForPath(value, op.path);
      const list = listAtPath(value, op.from);
      if (!target || !list) return;
      target.record[target.leaf] = list.length;
      return;
    }
    case 'remove-row': {
      const list = listAtPath(value, op.path);
      if (!list) return;
      const index = list.findIndex((row) => rowMatches(row, op.match, ctx));
      if (index >= 0) list.splice(index, 1);
      return;
    }
    case 'resum': {
      const target = parentRecordForPath(value, op.path);
      const list = listAtPath(value, op.from);
      if (!target || !list) return;
      target.record[target.leaf] = list.reduce<number>((total, row) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) return total;
        return total + asNumber((row as Record<string, JsonValue>)[op.column] ?? 0);
      }, 0);
      return;
    }
    case 'set-field': {
      const target = parentRecordForPath(value, op.path);
      if (!target) return;
      target.record[target.leaf] = evalSymbolicValue(op.value, ctx);
      return;
    }
    case 'update-row': {
      const list = listAtPath(value, op.path);
      if (!list) return;
      const row = list.find((candidate) => rowMatches(candidate, op.match, ctx));
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      const rowRecord = row as Record<string, JsonValue>;
      const rowCtx: EvalContext = { ...ctx, row: rowRecord };
      for (const [column, columnValue] of Object.entries(op.sets)) {
        rowRecord[column] = evalSymbolicValue(columnValue, rowCtx);
      }
      return;
    }
  }
}

function insertRow(
  list: JsonValue[],
  row: Record<string, JsonValue>,
  position: PushPosition,
): void {
  if (position === 'start') {
    list.unshift(row);
    return;
  }
  if (position === 'end') {
    list.push(row);
    return;
  }
  const target = asNumber(row[position.column] ?? 0);
  const index = list.findIndex((existing) => {
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) return false;
    const candidate = asNumber((existing as Record<string, JsonValue>)[position.column] ?? 0);
    return position.direction === 'asc' ? candidate > target : candidate < target;
  });
  if (index < 0) list.push(row);
  else list.splice(index, 0, row);
}

function rowMatches(row: JsonValue, match: readonly RowMatch[], ctx: EvalContext): boolean {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  const record = row as Record<string, JsonValue>;
  return match.every((entry) => record[entry.column] === evalSymbolicValue(entry.value, ctx));
}

/** Evaluate a §10.5 `SymbolicValue` against the mutation input and (optional) row. */
function evalSymbolicValue(value: SymbolicValue, ctx: EvalContext): JsonValue {
  switch (value.kind) {
    case 'arith': {
      const left = asNumber(evalSymbolicValue(value.left, ctx));
      const right = asNumber(evalSymbolicValue(value.right, ctx));
      return applyArith(value.op, left, right);
    }
    case 'col': {
      if (ctx.row && typeof ctx.row === 'object' && !Array.isArray(ctx.row)) {
        return (ctx.row as Record<string, JsonValue>)[value.column] ?? null;
      }
      throw new Error(`derivation: col(${value.column}) read outside a row scope`);
    }
    case 'const':
      return value.value;
    case 'opaque':
      throw new Error(`derivation: opaque value(${value.expr}) is not executable`);
    case 'param':
      return readPath(ctx.input, value.path);
    case 'placeholder':
      return value.placeholder === 'now' ? ctx.now() : ctx.tempId();
  }
}

function applyArith(op: ArithOp, left: number, right: number): number {
  switch (op) {
    case '*':
      return left * right;
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '/':
      return left / right;
  }
}

function asNumber(value: JsonValue): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function readPath(source: JsonValue, path: string): JsonValue {
  let current: JsonValue = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, JsonValue>)[segment] ?? null;
  }
  return current;
}

function parentRecordForPath(
  value: JsonValue,
  path: string,
): { leaf: string; record: Record<string, JsonValue> } | undefined {
  const segments = path.split('.');
  const leaf = segments.pop();
  if (leaf === undefined) return undefined;
  let current: JsonValue = value;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, JsonValue>)[segment] ?? null;
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
  return { leaf, record: current as Record<string, JsonValue> };
}

function listAtPath(value: JsonValue, path: string): JsonValue[] | undefined {
  const target = readPath(value, path);
  return Array.isArray(target) ? (target as JsonValue[]) : undefined;
}
