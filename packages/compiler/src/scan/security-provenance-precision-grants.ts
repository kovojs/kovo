import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerCreateMap,
  compilerFreeze,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import precisionGrantDocument from './security-provenance-precision-grants.v1.json' with { type: 'json' };
import {
  serverValueProvenanceStates,
  type ServerValueProvenance,
} from './security-provenance-relation.js';

export const serverProvenancePrecisionGrantIds = [
  'identifier-environment-lookup',
  'new-response-outcome',
  'new-foreign-executable',
  'new-unsafe-wire-data',
  'new-local-constructor',
  'call-principal-scope',
  'call-scoped-key',
  'call-intrinsic-identity',
  'call-response-constructor',
  'call-governed-data',
  'call-unsafe-wire-data',
  'call-local',
  'binary-finite-join',
  'conditional-finite-join',
  'static-member-relation',
  'fallthrough-foreign-containment',
  'fallthrough-governed-data-containment',
  'fallthrough-unsafe-wire-data',
  'fallthrough-contained-local',
] as const;

export type ServerProvenancePrecisionGrantId = (typeof serverProvenancePrecisionGrantIds)[number];

export interface ServerProvenancePrecisionGrantRow {
  readonly generatorExpectedProvenance: Exclude<ServerValueProvenance, 'unknown-authority'>;
  readonly generatorTransfer: string;
  readonly id: ServerProvenancePrecisionGrantId;
  readonly owner: string;
  readonly prerequisites: readonly string[];
  readonly semanticsWitness: string;
}

export interface ServerProvenancePrecisionObservation {
  readonly id: ServerProvenancePrecisionGrantId;
  readonly provenance: Exclude<ServerValueProvenance, 'unknown-authority'>;
}

export interface ServerProvenancePrecisionCaptureResult<Result> {
  readonly observations: readonly ServerProvenancePrecisionObservation[];
  readonly result: Result;
}

interface ServerProvenancePrecisionCapture {
  readonly observations: ServerProvenancePrecisionObservation[];
}

const precisionGrantRowsById = compilerCreateMap<
  ServerProvenancePrecisionGrantId,
  ServerProvenancePrecisionGrantRow
>();

export const serverProvenancePrecisionGrantRows = validatePrecisionGrantDocument();

let activePrecisionCapture: ServerProvenancePrecisionCapture | undefined;

/**
 * Record one reviewed precision grant while preserving the analyzer result unchanged.
 *
 * `unknown-authority` is the lattice top and is deliberately not an observation: a registered
 * site may still close at top for some inputs. The register owns only results below top
 * (SPEC §11.2; plans/10x-better-security-3.md §4.5).
 */
export function serverPrecisionGrant(
  id: ServerProvenancePrecisionGrantId,
  provenance: ServerValueProvenance,
): ServerValueProvenance {
  if (compilerMapGet(precisionGrantRowsById, id) === undefined) {
    throw new TypeError(`Unknown server provenance precision grant: ${id}`);
  }
  if (provenance !== 'unknown-authority' && activePrecisionCapture !== undefined) {
    compilerArrayAppend(
      activePrecisionCapture.observations,
      compilerFreeze({ id, provenance }),
      'Server provenance precision observations',
    );
  }
  return provenance;
}

/** Synchronously capture the below-top grants exercised by one compiler invocation. */
export function captureServerProvenancePrecisionGrants<Result>(
  operation: () => Result,
): ServerProvenancePrecisionCaptureResult<Result> {
  if (activePrecisionCapture !== undefined) {
    throw new TypeError('Server provenance precision capture cannot be nested.');
  }
  const capture: ServerProvenancePrecisionCapture = { observations: [] };
  activePrecisionCapture = capture;
  try {
    const result = operation();
    return compilerFreeze({
      observations: compilerFreeze(
        compilerSnapshotDenseArray(
          capture.observations,
          'Server provenance precision observations',
        ),
      ),
      result,
    });
  } finally {
    activePrecisionCapture = undefined;
  }
}

function validatePrecisionGrantDocument(): readonly ServerProvenancePrecisionGrantRow[] {
  if (
    compilerOwnDataValue(precisionGrantDocument, 'schema', 'Precision-grant register') !==
      'kovo-security-provenance-precision-grants/v1' ||
    compilerOwnDataValue(precisionGrantDocument, 'authorityTop', 'Precision-grant register') !==
      'unknown-authority' ||
    compilerOwnDataValue(precisionGrantDocument, 'extractor', 'Precision-grant register') !==
      'packages/compiler/src/scan/security-operation-ir.ts#serverExpressionProvenance'
  ) {
    throw new TypeError('Server provenance precision-grant register header is invalid.');
  }
  const sourceRows = compilerOwnDataValue(
    precisionGrantDocument,
    'rows',
    'Precision-grant register',
  );
  if (!compilerArrayIsArray(sourceRows)) {
    throw new TypeError('Server provenance precision-grant rows must be an array.');
  }
  const snapshot = compilerSnapshotDenseArray(sourceRows, 'Server provenance precision grants');
  if (snapshot.length !== serverProvenancePrecisionGrantIds.length) {
    throw new TypeError('Server provenance precision-grant row count is stale.');
  }
  const rows: ServerProvenancePrecisionGrantRow[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const source = snapshot[index];
    const expectedId = serverProvenancePrecisionGrantIds[index]!;
    const id = compilerOwnDataValue(source, 'id', `Precision grant ${index}`);
    const owner = compilerOwnDataValue(source, 'owner', `Precision grant ${index}`);
    const semanticsWitness = compilerOwnDataValue(
      source,
      'semanticsWitness',
      `Precision grant ${index}`,
    );
    const generatorTransfer = compilerOwnDataValue(
      source,
      'generatorTransfer',
      `Precision grant ${index}`,
    );
    const generatorExpectedProvenance = compilerOwnDataValue(
      source,
      'generatorExpectedProvenance',
      `Precision grant ${index}`,
    );
    const sourcePrerequisites = compilerOwnDataValue(
      source,
      'prerequisites',
      `Precision grant ${index}`,
    );
    if (
      id !== expectedId ||
      typeof owner !== 'string' ||
      compilerStringTrim(owner).length === 0 ||
      typeof semanticsWitness !== 'string' ||
      compilerStringTrim(semanticsWitness).length < 80 ||
      typeof generatorTransfer !== 'string' ||
      compilerStringTrim(generatorTransfer).length === 0 ||
      !isBelowTopServerValueProvenance(generatorExpectedProvenance) ||
      !compilerArrayIsArray(sourcePrerequisites)
    ) {
      throw new TypeError(`Server provenance precision grant ${expectedId} is invalid.`);
    }
    const prerequisiteValues = compilerSnapshotDenseArray(
      sourcePrerequisites,
      `Precision grant ${expectedId} prerequisites`,
    );
    const prerequisites: string[] = [];
    for (
      let prerequisiteIndex = 0;
      prerequisiteIndex < prerequisiteValues.length;
      prerequisiteIndex += 1
    ) {
      const prerequisite = prerequisiteValues[prerequisiteIndex];
      if (typeof prerequisite !== 'string' || compilerStringTrim(prerequisite).length === 0) {
        throw new TypeError(
          `Server provenance precision grant ${expectedId} has an invalid prerequisite.`,
        );
      }
      compilerArrayAppend(
        prerequisites,
        prerequisite,
        `Precision grant ${expectedId} prerequisites`,
      );
    }
    const row = compilerFreeze({
      generatorExpectedProvenance,
      generatorTransfer,
      id: expectedId,
      owner,
      prerequisites: compilerFreeze(prerequisites),
      semanticsWitness,
    });
    if (compilerMapGet(precisionGrantRowsById, expectedId) !== undefined) {
      throw new TypeError(`Duplicate server provenance precision grant: ${expectedId}`);
    }
    compilerMapSet(precisionGrantRowsById, expectedId, row);
    compilerArrayAppend(rows, row, 'Server provenance precision-grant rows');
  }
  return compilerFreeze(rows);
}

function isBelowTopServerValueProvenance(
  value: unknown,
): value is Exclude<ServerValueProvenance, 'unknown-authority'> {
  if (typeof value !== 'string' || value === 'unknown-authority') return false;
  const states = compilerSnapshotDenseArray(
    serverValueProvenanceStates,
    'Server provenance vocabulary',
  );
  for (let index = 0; index < states.length; index += 1) {
    if (states[index] === value) return true;
  }
  return false;
}
