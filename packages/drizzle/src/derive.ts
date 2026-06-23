import {
  derived,
  punt,
  type AlgebraicField,
  type AlgebraicQueryShape,
  type DerivationResult,
  type PatchOp,
  type PuntReason,
  type PushPosition,
  type RowMatch,
  type Rowset,
  type RowsetFilter,
  type SymbolicEffect,
  type SymbolicMatch,
  type SymbolicValue,
} from '@kovojs/core/internal/derivation';

// SPEC.md §10.5 Stage 3 — push each write effect through a query's algebraic
// shape to produce a JSON-patch program, or a named punt. The deriver is
// source-agnostic: it consumes the shared IR (effects + shape), so the Drizzle
// extractor and the commerce hand-authored facts drive the exact same rules.
// All-or-nothing per field: any Opaque component punts the whole pair, never a
// best-effort patch (wrong predictions are worse than none).

interface FieldDerivation {
  aggOps: PatchOp[];
  connected: boolean;
  reason?: PuntReason;
  rowOps: PatchOp[];
}

interface RowMatchAlternative {
  coveredColumns: ReadonlySet<string>;
  match: readonly RowMatch[];
}

/**
 * Derive the optimistic patch program for one (mutation × invalidated query)
 * pair: push every mutation `effect` through the query `shape`. Returns a
 * `derived(PatchProgram)` or a `punt(PuntReason)` from the §10.5 PUNT list.
 *
 * @internal Repo-internal Stage-3 deriver. Its signature is built from
 * `@kovojs/core/internal/derivation` types, so it cannot be public
 * (recursive-publicness, `rules/api-surface.md`). Consumed by the CLI and the
 * drizzle codegen lowerer via `@kovojs/drizzle/internal/derive`.
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
    // C2 (SPEC.md §10.5 membership-entry rule): a filtered list must not receive an
    // INSERTed row that PROVABLY violates its rowset filters (the row would appear and
    // then vanish on reconcile — worse than no prediction).  Only a decidable const-eq
    // filter that the inserted const value contradicts is a provable non-member: no-op.
    // An undecidable filter (non-eq / opaque value) keeps the §10.4 push — the author's
    // mutation is assumed to write into the filtered scope and reconcile content-matches.
    if (insertSatisfiesAllFilters(field.rowset.filters, effect.values) === false) return ok();

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

  const alternatives = matchToRowMatchAlternatives(effect.match, field.rowset);
  if (alternatives.reason) return fail(alternatives.reason);

  // C5: A `keys`-kind match whose columns don't cover the declared rowKey is a
  // non-key predicate that may match multiple rows.  Only single-row update/delete
  // is safe, so punt when the eq columns don't include every key column.
  // (SPEC.md §10.5 "eq(t.col,value) only when cols provably cover the table key")
  if (field.rowKey) {
    const keyColumns = field.rowKey.split(',').map((c) => c.trim());
    for (const alternative of alternatives.value) {
      const coveredKeyColumns = keyColumns.filter((keyColumn) =>
        alternative.coveredColumns.has(keyColumn),
      );
      if (coveredKeyColumns.length === keyColumns.length) continue;
      if (coveredKeyColumns.length > 0) {
        return fail({
          code: 'partial-key',
          columns: keyColumns.filter((keyColumn) => !alternative.coveredColumns.has(keyColumn)),
          table: field.rowset.table,
        });
      }
      return fail({ code: 'non-key-match', expr: `non-key eq on ${field.rowset.table}` });
    }
  }

  if (effect.op === 'delete') {
    return rows(
      ...alternatives.value.map((alternative) => ({
        guard: 'find-or-noop' as const,
        match: alternative.match,
        op: 'remove-row' as const,
        path,
      })),
    );
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
      for (const alternative of alternatives.value) {
        const transition = membershipTransition(path, alternative.match, column, value, filter);
        if (transition.reason) return fail(transition.reason);
        ops.push(...transition.rowOps);
      }
      continue;
    }
    sets[column] = value;
  }
  if (Object.keys(sets).length > 0) {
    ops.push(
      ...alternatives.value.map((alternative) => ({
        guard: 'find-or-noop' as const,
        match: alternative.match,
        op: 'update-row' as const,
        path,
        sets,
      })),
    );
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
  const column = field.arith.kind === 'col' ? field.arith.column : undefined;

  // C1 (SPEC.md §10.5): a filtered SUM ranges over only its rowset members. The
  // resum-over-witness path reads the sibling AGG's (unfiltered) rows, which over-counts
  // a filtered total, so the witness path is disabled when the SUM is filtered. The
  // inc-path must NOT add a row that PROVABLY violates a decidable const-eq filter (the
  // C1 over-count: `inc by 50` for `{status:'pending'}` into `WHERE status='active'`).
  // An undecidable filter (non-eq / opaque value, e.g. inserting `cartId=<param>` into
  // `WHERE cartId='c1'`) keeps the §10.5:1164 inc — the author's mutation is assumed to
  // write into the queried scope; reconcile settles the exact total.
  const filtered = field.rowset.filters.length > 0;

  // C6: Only use the resum-over-witness path when the witness ships the summed
  // column AND the witness ranges over the same membership as this SUM. Legacy
  // witnesses without rowset facts are accepted only for unfiltered SUMs. Reading
  // row[col] from a witness that doesn't ship col yields 0 for every row,
  // collapsing the total (SPEC.md §10.5).
  const witness = shape.rowsByTable?.[field.rowset.table];
  const witnessShipsSummedCol = witness && column ? witness.columns.includes(column) : false;
  const rowsPath =
    witnessShipsSummedCol && aggregateWitnessCoversRowset(shape, field.rowset, witness)
      ? witness?.rowsPath
      : undefined;

  if (effect.op === 'insert' || effect.op === 'upsert') {
    // C1: no-op only when the inserted row provably violates a decidable filter.
    if (filtered && insertSatisfiesAllFilters(field.rowset.filters, effect.values) === false) {
      return ok();
    }
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
  // C3/C4 (SPEC.md §10.5 "soundly optimistic — wrong predictions are worse than none"):
  // the rowsByTable witness is a sibling AGG built over its own (typically unfiltered)
  // rowset, so recount(witness) counts every shipped row, not only those satisfying THIS
  // COUNT's WHERE chain.  ANY predicate makes the unfiltered-witness recount unsound, so
  // only plain COUNT(*) (no predicates) may recount over the witness.  The effective
  // predicate set is the full rowset filter chain (C3: not just the first eq), plus a
  // standalone `field.pred` when an extraction supplies one outside the chain (C4).
  const predicates = countPredicates(field);
  const witness = shape.rowsByTable?.[field.rowset.table];
  const rowsPath =
    witness && aggregateWitnessCoversFilters(shape, field.rowset, predicates, witness)
      ? witness.rowsPath
      : undefined;

  if (effect.op === 'insert' || effect.op === 'upsert') {
    // C3: evaluate the inserted row against the ENTIRE predicate set — keeping only the
    // first eq over-counts a row that PROVABLY violates a sibling predicate (no-op then).
    // An undecidable predicate keeps the §10.5:1164 inc-by-1 (assume member); the witness
    // recount is gated off above so it never counts the unfiltered witness (C3-2 / C4).
    if (insertSatisfiesAllFilters(predicates, effect.values) === false) return ok();
    if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
    return agg({ by: { kind: 'const', value: 1 }, op: 'inc', path });
  }

  if (effect.op === 'delete') {
    if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
    return fail({ code: 'no-row-witness', field: path });
  }

  // UPDATE: count only changes if a predicate column's membership flips. With predicates
  // present there is no sound witness unless the shipped rows carry the same rowset
  // membership facts, so any touched predicate column without that witness punts.
  if (!predicates.some((predicate) => predicate.column in effect.sets)) return ok();
  if (rowsPath) return agg({ from: rowsPath, op: 'recount', path });
  return fail({ code: 'no-row-witness', field: path });
}

/**
 * C3/C4 (SPEC.md §10.5): a COUNT's effective predicate set — the full rowset
 * filter chain plus any standalone `field.pred` not already represented in the
 * chain (so a shape that carries `pred` outside `rowset.filters` still gates the
 * unfiltered-witness recount).
 */
function countPredicates(
  field: Extract<AlgebraicField, { kind: 'count' }>,
): readonly RowsetFilter[] {
  const filters = field.rowset.filters;
  if (!field.pred) return filters;
  if (filters.some((filter) => filter === field.pred || filter.column === field.pred?.column)) {
    return filters;
  }
  return [...filters, field.pred];
}

/**
 * C3 (SPEC.md §10.5): does an inserted row provably satisfy EVERY filter in the
 * COUNT's WHERE chain? `true`/`false` only when every filter is a decidable
 * const-eq; any non-eq/opaque filter or an opaque/missing inserted value is
 * `'opaque'` (undecidable ⇒ punt).
 */
function insertSatisfiesAllFilters(
  filters: readonly RowsetFilter[],
  values: Readonly<Record<string, SymbolicValue>>,
): 'opaque' | boolean {
  let satisfiesAll = true;
  for (const filter of filters) {
    const satisfies = predSatisfiedByInsert(filter, values);
    if (satisfies === 'opaque') return 'opaque';
    if (satisfies === false) satisfiesAll = false;
  }
  return satisfiesAll;
}

// ── Scalar(keyed-row col) ─────────────────────────────────────────────────────

function deriveScalar(
  path: string,
  column: string,
  rowset: Rowset,
  effect: SymbolicEffect,
): FieldDerivation {
  if (effect.op === 'delete')
    return fail({ code: 'unsupported', detail: 'DELETE of a scalar row' });
  if (effect.op === 'insert') return ok(); // a new row does not change an existing keyed scalar
  const match = matchToRowMatches(effect.match, rowset);
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

function matchToRowMatches(
  match: SymbolicMatch,
  rowset?: Rowset,
): {
  reason?: PuntReason;
  value: { column: string; value: SymbolicValue }[];
} {
  const alternatives = matchToRowMatchAlternatives(match, rowset);
  if (alternatives.reason) return { reason: alternatives.reason, value: [] };
  if (alternatives.value.length !== 1) {
    return {
      reason: { code: 'unsupported', detail: 'disjunctive scalar row match' },
      value: [],
    };
  }
  const alternative = alternatives.value[0];
  if (!alternative) {
    return { reason: { code: 'unsupported', detail: 'empty scalar row match' }, value: [] };
  }
  return { value: [...alternative.match] };
}

function matchToRowMatchAlternatives(
  match: SymbolicMatch,
  rowset?: Rowset,
): {
  reason?: PuntReason;
  value: RowMatchAlternative[];
} {
  if (match.kind === 'opaque') {
    return {
      reason: match.reason ?? { code: 'non-key-match', expr: match.expr },
      value: [],
    };
  }
  if (match.kind === 'or') {
    return { value: match.arms.map((arm) => rowMatchAlternativeFromEq(arm.eq, rowset)) };
  }
  return { value: [rowMatchAlternativeFromEq(match.eq, rowset)] };
}

function rowMatchAlternativeFromEq(
  eq: readonly { column: string; value: SymbolicValue }[],
  rowset?: Rowset,
): RowMatchAlternative {
  return {
    coveredColumns: new Set(eq.map((entry) => entry.column)),
    match: eq
      .filter((entry) => !rowset || !rowsetProvesPrivateScope(rowset, entry))
      .map((entry) => ({ column: entry.column, value: entry.value })),
  };
}

function rowsetProvesPrivateScope(
  rowset: Rowset,
  match: { column: string; value: SymbolicValue },
): boolean {
  if (!isPrivateScopeValue(match.value)) return false;
  return rowset.filters.some(
    (filter) =>
      filter.op === 'eq' &&
      filter.column === match.column &&
      filter.value !== undefined &&
      symbolicValuesEqual(filter.value, match.value),
  );
}

function isPrivateScopeValue(value: SymbolicValue): boolean {
  return value.kind === 'guard' || value.kind === 'session' || value.kind === 'tenant';
}

function predSatisfiedByInsert(
  pred: RowsetFilter | undefined,
  values: Readonly<Record<string, SymbolicValue>>,
): 'opaque' | boolean {
  if (!pred) return true;
  if (pred.op !== 'eq' || pred.value === undefined) return 'opaque';
  const inserted = values[pred.column];
  if (!inserted) return 'opaque';
  return symbolicValuesEqual(inserted, pred.value)
    ? true
    : constValuesContradict(inserted, pred.value);
}

function symbolicValuesEqual(left: SymbolicValue, right: SymbolicValue): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'arith':
      return (
        right.kind === 'arith' &&
        left.op === right.op &&
        symbolicValuesEqual(left.left, right.left) &&
        symbolicValuesEqual(left.right, right.right)
      );
    case 'col':
      return right.kind === 'col' && left.column === right.column && left.table === right.table;
    case 'const':
      return right.kind === 'const' && left.value === right.value;
    case 'opaque':
      return right.kind === 'opaque' && left.expr === right.expr;
    case 'param':
      return right.kind === 'param' && left.path === right.path;
    case 'placeholder':
      return right.kind === 'placeholder' && left.placeholder === right.placeholder;
    case 'guard':
      return right.kind === 'guard' && left.path === right.path;
    case 'session':
      return right.kind === 'session' && left.path === right.path;
    case 'tenant':
      return right.kind === 'tenant' && left.path === right.path;
  }
}

function constValuesContradict(left: SymbolicValue, right: SymbolicValue): 'opaque' | false {
  if (left.kind !== 'const' || right.kind !== 'const') return 'opaque';
  return left.value !== right.value ? false : 'opaque';
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
    case 'guard':
    case 'param':
    case 'session':
    case 'tenant':
      return value;
    default:
      return undefined;
  }
}

function aggregateWitnessCoversRowset(
  shape: AlgebraicQueryShape,
  rowset: Rowset,
  witness: { rowset?: Rowset; rowsPath: string },
): boolean {
  return aggregateWitnessCoversFilters(shape, rowset, rowset.filters, witness);
}

function aggregateWitnessCoversFilters(
  shape: AlgebraicQueryShape,
  rowset: Rowset,
  filters: readonly RowsetFilter[],
  witness: { rowset?: Rowset; rowsPath: string },
): boolean {
  const paginated = Object.values(shape.fields).some(
    (field) => field.kind === 'cursor' && field.rowset.table === rowset.table,
  );
  if (paginated) return false;
  if (witness.rowset) {
    return rowsetsHaveSameMembership({ ...rowset, filters }, witness.rowset);
  }
  return filters.length === 0;
}

function rowsetsHaveSameMembership(left: Rowset, right: Rowset): boolean {
  if (left.table !== right.table) return false;
  if (left.filters.length !== right.filters.length) return false;
  const unmatched = [...right.filters];
  for (const filter of left.filters) {
    const index = unmatched.findIndex((candidate) => rowsetFiltersEqual(filter, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

function rowsetFiltersEqual(left: RowsetFilter, right: RowsetFilter): boolean {
  if (left.column !== right.column || left.op !== right.op) return false;
  if (left.value === undefined || right.value === undefined) {
    return left.value === undefined && right.value === undefined;
  }
  return symbolicValuesEqual(left.value, right.value);
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
