import {
  derived,
  punt,
  type AlgebraicField,
  type AlgebraicQueryShape,
  type DerivationResult,
  type PatchOp,
  type PuntReason,
  type PushPosition,
  type Rowset,
  type RowsetFilter,
  type SymbolicEffect,
  type SymbolicMatch,
  type SymbolicValue,
} from '@jiso/core';

// SPEC.md §10.5 Stage 3 — push each write effect through a query's algebraic
// shape to produce a JSON-patch program, or a named punt. The deriver is
// source-agnostic: it consumes the shared IR (effects + shape), so the Drizzle
// extractor and the commerce hand-authored facts drive the exact same rules.
// All-or-nothing per field: any Opaque component punts the whole pair, never a
// best-effort patch (wrong predictions are worse than none).

// Phase 3 codegen (PatchProgram → committed transform source) shares this entry.
export {
  lowerTransform,
  serializeDerivedOptimistic,
  type DerivedTransformEntry,
  type SerializeDerivedOptimisticOptions,
} from './derive-codegen.js';

interface FieldDerivation {
  aggOps: PatchOp[];
  connected: boolean;
  reason?: PuntReason;
  rowOps: PatchOp[];
}

/**
 * Derive the optimistic patch program for one (mutation × invalidated query)
 * pair: push every mutation `effect` through the query `shape`. Returns a
 * `derived(PatchProgram)` or a `punt(PuntReason)` from the §10.5 PUNT list.
 */
export function deriveOptimistic(
  effects: readonly SymbolicEffect[],
  shape: AlgebraicQueryShape,
): DerivationResult {
  const rowOps: PatchOp[] = [];
  const aggOps: PatchOp[] = [];
  let connected = false;

  for (const [path, field] of Object.entries(shape.fields)) {
    const result = deriveField(path, field, effects, shape);
    if (result.reason) return punt(result.reason);
    rowOps.push(...result.rowOps);
    aggOps.push(...result.aggOps);
    connected = connected || result.connected;
  }

  if (!connected) {
    // The pair was invalidated via a table the shape doesn't classify (an
    // over-approximation or an opaque field) — never silently emit an empty patch.
    return punt({ code: 'unsupported', detail: 'no classified field over a written table' });
  }

  // Row mutations (push/remove/update) run before recount/resum so aggregates
  // recompute from the already-patched rows (SPEC.md §10.5).
  return derived({ ops: [...rowOps, ...aggOps], query: shape.query });
}

function deriveField(
  path: string,
  field: AlgebraicField,
  effects: readonly SymbolicEffect[],
  shape: AlgebraicQueryShape,
): FieldDerivation {
  if (field.kind === 'opaque') {
    return { aggOps: [], connected: false, reason: field.reason, rowOps: [] };
  }

  const affecting = effects.filter((effect) => effect.table === field.rowset.table);
  if (affecting.length === 0) return { aggOps: [], connected: false, rowOps: [] };

  const rowOps: PatchOp[] = [];
  const aggOps: PatchOp[] = [];
  for (const effect of affecting) {
    const result = deriveFieldEffect(path, field, effect, shape);
    if (result.reason) return { aggOps: [], connected: true, reason: result.reason, rowOps: [] };
    rowOps.push(...result.rowOps);
    aggOps.push(...result.aggOps);
  }
  return { aggOps, connected: true, rowOps };
}

function deriveFieldEffect(
  path: string,
  field: AlgebraicField,
  effect: SymbolicEffect,
  shape: AlgebraicQueryShape,
): FieldDerivation {
  switch (field.kind) {
    case 'agg':
      return deriveAgg(path, field, effect);
    case 'count':
      return deriveCount(path, field, effect, shape);
    case 'cursor':
      return deriveCursor(field.rowset, effect);
    case 'scalar':
      return deriveScalar(path, field.column, field.rowset, effect);
    case 'sum':
      return deriveSum(path, field, effect, shape);
    default:
      return ok();
  }
}

// ── AGG(R, projection): push / remove / update rows ──────────────────────────

function deriveAgg(
  path: string,
  field: Extract<AlgebraicField, { kind: 'agg' }>,
  effect: SymbolicEffect,
): FieldDerivation {
  if (effect.op === 'insert' || effect.op === 'upsert') {
    const position = insertPosition(field.rowset);
    if (position.reason) return fail(position.reason);
    const built = buildInsertRow(field, effect.values);
    // A sorted insert needs the new row's orderBy value; if that column is a
    // placeholder (the inserted value is Opaque, e.g. an auto-increment id), the
    // insertion point is undecidable ⇒ punt (SPEC.md §10.5 Opaque orderBy).
    if (
      typeof position.value === 'object' &&
      built.placeholderColumns.includes(position.value.column)
    ) {
      return fail({ code: 'opaque-orderby', column: position.value.column });
    }
    return rows({
      op: 'push-row',
      path,
      placeholderColumns: built.placeholderColumns,
      position: position.value,
      row: built.row,
    });
  }

  const match = matchToRowMatches(effect.match);
  if (match.reason) return fail(match.reason);

  if (effect.op === 'delete') {
    return rows({ guard: 'find-or-noop', match: match.value, op: 'remove-row', path });
  }

  // UPDATE: per-column membership / order / data classification.
  const ops: PatchOp[] = [];
  const sets: Record<string, SymbolicValue> = {};
  for (const [column, value] of Object.entries(effect.sets)) {
    if (orderByColumns(field.rowset).has(column)) {
      return fail({ code: 'unsupported', detail: `UPDATE of orderBy column ${column}` });
    }
    const filter = field.rowset.filters.find((entry) => entry.column === column);
    if (filter) {
      const transition = membershipTransition(path, match.value, column, value, filter);
      if (transition.reason) return fail(transition.reason);
      ops.push(...transition.rowOps);
      continue;
    }
    sets[column] = value;
  }
  if (Object.keys(sets).length > 0) {
    ops.push({ guard: 'find-or-noop', match: match.value, op: 'update-row', path, sets });
  }
  return { aggOps: [], connected: true, rowOps: ops };
}

function membershipTransition(
  path: string,
  match: readonly { column: string; value: SymbolicValue }[],
  column: string,
  value: SymbolicValue,
  filter: RowsetFilter,
): FieldDerivation {
  // SPEC.md §10.5: SET on a filtered col is a membership transition. Exit is
  // derivable when a Const value provably violates the filter; entry punts
  // (the client lacks the row's other columns).
  if (value.kind !== 'const' || filter.op !== 'eq' || filter.value?.kind !== 'const') {
    return fail({ code: 'membership-entry', field: column });
  }
  const exits = value.value !== filter.value.value;
  return exits ? rows({ guard: 'find-or-noop', match, op: 'remove-row', path }) : ok();
}

// ── SUM(R, arith) ────────────────────────────────────────────────────────────

function deriveSum(
  path: string,
  field: Extract<AlgebraicField, { kind: 'sum' }>,
  effect: SymbolicEffect,
  shape: AlgebraicQueryShape,
): FieldDerivation {
  const rowsPath = fullRowsPath(shape, field.rowset.table);
  const column = field.arith.kind === 'col' ? field.arith.column : undefined;

  if (effect.op === 'insert' || effect.op === 'upsert') {
    if (rowsPath && column) {
      if (isOpaqueColumn(effect.values[column]))
        return fail({ code: 'no-row-witness', field: path });
      return agg({ column, from: rowsPath, op: 'resum', path });
    }
    const contribution = substituteRowColumns(field.arith, effect.values);
    if (!contribution)
      return fail({ code: 'untraceable-param', expr: `SUM(${field.rowset.table})` });
    return agg({ by: contribution, op: 'inc', path });
  }

  if (effect.op === 'delete') {
    if (rowsPath && column) return agg({ column, from: rowsPath, op: 'resum', path });
    return fail({ code: 'no-row-witness', field: path });
  }

  // UPDATE: only matters if the summed column changes.
  if (!column || !(column in effect.sets)) return ok();
  if (rowsPath) return agg({ column, from: rowsPath, op: 'resum', path });
  return fail({ code: 'no-row-witness', field: path });
}

// ── COUNT(R[, pred]) ──────────────────────────────────────────────────────────

function deriveCount(
  path: string,
  field: Extract<AlgebraicField, { kind: 'count' }>,
  effect: SymbolicEffect,
  shape: AlgebraicQueryShape,
): FieldDerivation {
  const rowsPath = fullRowsPath(shape, field.rowset.table);

  if (effect.op === 'insert' || effect.op === 'upsert') {
    const satisfies = predSatisfiedByInsert(field.pred, effect.values);
    if (satisfies === 'opaque')
      return fail({ code: 'opaque-set', expr: `COUNT pred ${field.pred?.column}` });
    if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
    if (satisfies === false) return ok();
    return agg({ by: { kind: 'const', value: 1 }, op: 'inc', path });
  }

  if (effect.op === 'delete') {
    if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
    return fail({ code: 'no-row-witness', field: path });
  }

  // UPDATE: count only changes if the pred column's membership flips.
  if (!field.pred || !(field.pred.column in effect.sets)) return ok();
  if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
  return fail({ code: 'no-row-witness', field: path });
}

// ── Scalar(keyed-row col) ─────────────────────────────────────────────────────

function deriveScalar(
  path: string,
  column: string,
  _rowset: Rowset,
  effect: SymbolicEffect,
): FieldDerivation {
  if (effect.op === 'delete')
    return fail({ code: 'unsupported', detail: 'DELETE of a scalar row' });
  if (effect.op === 'insert') return ok(); // a new row does not change an existing keyed scalar
  const match = matchToRowMatches(effect.match);
  if (match.reason) return fail(match.reason);

  const next = effect.sets[column];
  if (next === undefined) return ok();

  // Self-relative arithmetic (e.g. stock -= qty) lowers to an inc; an absolute
  // input/const value lowers to set-field. Anything opaque punts.
  if (next.kind === 'arith' && next.left.kind === 'col' && next.left.column === column) {
    if (next.op === '+') return agg({ by: next.right, op: 'inc', path });
    if (next.op === '-') {
      return agg({
        by: { kind: 'arith', left: { kind: 'const', value: 0 }, op: '-', right: next.right },
        op: 'inc',
        path,
      });
    }
    return fail({ code: 'opaque-set', expr: `SET ${column}` });
  }
  if (next.kind === 'param' || next.kind === 'const') {
    return agg({ op: 'set-field', path, value: next });
  }
  return fail({ code: 'opaque-set', expr: `SET ${column}` });
}

// ── cursor (pagination metadata derived from rowset order/membership) ─────────

function deriveCursor(rowset: Rowset, effect: SymbolicEffect): FieldDerivation {
  if (effect.op !== 'update') {
    return fail({ code: 'unsupported', detail: `${effect.op} changes paginated membership` });
  }
  const sensitive = new Set<string>([
    ...(rowset.key ? [rowset.key] : []),
    ...orderByColumns(rowset),
    ...rowset.filters.map((filter) => filter.column),
  ]);
  for (const column of Object.keys(effect.sets)) {
    if (sensitive.has(column)) {
      return fail({ code: 'unsupported', detail: `UPDATE of cursor-sensitive column ${column}` });
    }
  }
  // Order + membership invariant under this update ⇒ cursor unchanged.
  return ok();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function insertPosition(rowset: Rowset): { reason?: PuntReason; value: PushPosition } {
  if (rowset.orderBy.length === 0) return { value: 'end' };
  const order = rowset.orderBy[0];
  if (rowset.orderBy.length === 1 && order) {
    if (order.opaque)
      return { reason: { code: 'opaque-orderby', column: order.column }, value: 'end' };
    return { value: { column: order.column, direction: order.direction } };
  }
  return {
    reason: {
      code: 'opaque-orderby',
      column: rowset.orderBy.map((entry) => entry.column).join(','),
    },
    value: 'end',
  };
}

function buildInsertRow(
  field: Extract<AlgebraicField, { kind: 'agg' }>,
  values: Readonly<Record<string, SymbolicValue>>,
): { placeholderColumns: string[]; row: Record<string, SymbolicValue> } {
  const row: Record<string, SymbolicValue> = {};
  const placeholderColumns: string[] = [];
  for (const column of field.projection) {
    const value = values[column];
    if (value && !isOpaqueColumn(value)) {
      row[column] = value;
      continue;
    }
    // Opaque or missing column ⇒ a type-correct placeholder, content-matched on
    // reconcile (SPEC.md §10.5 INSERT × AGG).
    row[column] = placeholderForColumn(field.columnTypes?.[column]);
    placeholderColumns.push(column);
  }
  return { placeholderColumns, row };
}

function placeholderForColumn(type: 'boolean' | 'number' | 'string' | undefined): SymbolicValue {
  if (type === 'number') return { kind: 'const', value: 0 };
  if (type === 'boolean') return { kind: 'const', value: false };
  return { kind: 'placeholder', placeholder: 'tempId' };
}

function matchToRowMatches(match: SymbolicMatch): {
  reason?: PuntReason;
  value: { column: string; value: SymbolicValue }[];
} {
  if (match.kind === 'opaque')
    return { reason: { code: 'non-key-match', expr: match.expr }, value: [] };
  const value = match.eq.map((entry) => ({ column: entry.column, value: entry.value }));
  return { value };
}

function predSatisfiedByInsert(
  pred: RowsetFilter | undefined,
  values: Readonly<Record<string, SymbolicValue>>,
): 'opaque' | boolean {
  if (!pred) return true;
  if (pred.op !== 'eq' || pred.value?.kind !== 'const') return 'opaque';
  const inserted = values[pred.column];
  if (!inserted || inserted.kind !== 'const') return 'opaque';
  return inserted.value === pred.value.value;
}

function substituteRowColumns(
  value: SymbolicValue,
  rowValues: Readonly<Record<string, SymbolicValue>>,
): SymbolicValue | undefined {
  switch (value.kind) {
    case 'arith': {
      const left = substituteRowColumns(value.left, rowValues);
      const right = substituteRowColumns(value.right, rowValues);
      if (!left || !right) return undefined;
      return { kind: 'arith', left, op: value.op, right };
    }
    case 'col': {
      const resolved = rowValues[value.column];
      if (!resolved || isOpaqueColumn(resolved)) return undefined;
      return resolved;
    }
    case 'const':
    case 'param':
      return value;
    default:
      return undefined;
  }
}

function fullRowsPath(shape: AlgebraicQueryShape, table: string): string | undefined {
  const witness = shape.rowsByTable?.[table];
  if (!witness) return undefined;
  const paginated = Object.values(shape.fields).some(
    (field) => field.kind === 'cursor' && field.rowset.table === table,
  );
  return paginated ? undefined : witness.rowsPath;
}

function orderByColumns(rowset: Rowset): Set<string> {
  return new Set(rowset.orderBy.map((order) => order.column));
}

function isOpaqueColumn(value: SymbolicValue | undefined): boolean {
  return value === undefined || value.kind === 'opaque';
}

function ok(): FieldDerivation {
  return { aggOps: [], connected: true, rowOps: [] };
}

function fail(reason: PuntReason): FieldDerivation {
  return { aggOps: [], connected: true, reason, rowOps: [] };
}

function rows(...ops: PatchOp[]): FieldDerivation {
  return { aggOps: [], connected: true, rowOps: ops };
}

function agg(...ops: PatchOp[]): FieldDerivation {
  return { aggOps: ops, connected: true, rowOps: [] };
}
