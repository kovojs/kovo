import {
  collectJavaScriptModuleReferences,
  isJavaScriptAstNode,
  type JavaScriptAstNode,
  parseJavaScriptModule,
  staticStringValue,
} from './javascript-ast.js';
import {
  translationArrayAppend,
  translationArrayAppendAll,
  translationArrayCopy,
  translationArrayIsArray,
  translationArrayJoin,
  translationArrayLength,
  translationArrayPop,
  translationArrayPrototype,
  translationArraySort,
  translationCreateMap,
  translationCreateNullRecord,
  translationCreateSet,
  translationDefineOwnDataProperty,
  translationErrorMessage,
  translationGetOwnPropertyDescriptor,
  translationGetOwnPropertyDescriptors,
  translationGetPrototypeOf,
  translationJsonParse,
  translationJsonStringify,
  translationMapForEach,
  translationMapGet,
  translationMapHas,
  translationMapSet,
  translationNumberIsSafeInteger,
  translationNumberParseInt,
  translationObjectKeys,
  translationObjectPrototype,
  translationOwnDataValue,
  translationOwnKeys,
  translationRegExpMatches,
  translationRegExpReplace,
  translationRegExpTest,
  translationSameDataDescriptor,
  translationSetAdd,
  translationSetHas,
  translationStringEndsWith,
  translationStringFromCodePoint,
  translationStringIncludes,
  translationStringIndexOf,
  translationStringSlice,
  translationStringSplit,
  translationStringTrim,
  translationSyntaxError,
  translationTypeError,
} from './translation-intrinsics.js';

export { translationClaimCompilerLockTransition } from './translation-intrinsics.js';

/** @internal One compiler-emitted artifact checked by the Plan 3 §2.2 translation validator. */
export interface KovoEmittedTranslationArtifact {
  fileName: string;
  /** Deliberately open at the API edge so an unreviewed future kind fails at runtime. */
  kind: string;
  source: string;
}

/** @internal One exact import binding admitted by the compiler's KV437 decision record. */
export interface KovoReviewedClientImport {
  imports: readonly { importedName: string; localName: string }[];
  moduleSpecifier: string;
}

/** @internal One compiler-decided browser or server operation serialized into generated source. */
export interface KovoTranslationOperation {
  door: string;
  justification?: string;
  kind: string;
  root?: string;
  target?: string;
}

/**
 * @internal Typed facts supplied to the independent emitted-text checker. This is not a second
 * certificate.
 */
export interface KovoEmittedTranslationDecision {
  clientHandlers: readonly {
    exportName: string;
    operations: readonly KovoTranslationOperation[];
  }[];
  clientImports: readonly KovoReviewedClientImport[];
  secretFieldNames: readonly string[];
  serverOperations: readonly KovoTranslationOperation[];
}

/** @internal In-memory translation check input: emitted bytes plus compiler typed decision facts. */
export interface KovoEmittedTranslationInput {
  artifacts: readonly KovoEmittedTranslationArtifact[];
  decision: KovoEmittedTranslationDecision;
}

/** @internal A fail-closed discrepancy in one Plan 3 §2.2 translation relation. */
export interface KovoEmittedTranslationFinding {
  artifactKind?: string;
  code: string;
  message: string;
  relation:
    | 'artifact-coverage'
    | 'client-import-subset'
    | 'decision-record'
    | 'operation-serialization'
    | 'secret-field-absence';
}

/** @internal Result of independently checking compiler decision facts against emitted text. */
export interface KovoEmittedTranslationResult {
  findings: readonly KovoEmittedTranslationFinding[];
  ok: boolean;
}

const browserOperationKinds = new Set([
  'browser.dialog.close',
  'browser.dialog.open',
  'browser.dom.focus',
  'browser.event.control',
  'browser.event.read',
  'browser.form.reset',
  'browser.form.submit',
  'browser.framework.call',
  'browser.state.read',
  'browser.state.write',
  'browser.timer.cancel',
  'browser.timer.schedule',
]);

const serverOperationKinds = new Set([
  'server.authority.scope',
  'server.data.declassify',
  'server.database.read',
  'server.database.trusted-sql',
  'server.database.write',
  'server.egress.request',
  'server.handler.root',
  'server.helper.call',
  'server.output.trusted-html',
  'server.response.cookie',
  'server.response.header',
  'server.response.outcome',
  'server.response.raw',
  'server.response.redirect',
  'server.storage.read',
  'server.storage.write',
  'server.task.compose',
]);

const operationDoorByKind = new Map<string, string>([
  ['browser.dialog.close', 'platform-invoker'],
  ['browser.dialog.open', 'platform-invoker'],
  ['browser.dom.focus', 'compiler-dom-focus'],
  ['browser.event.control', 'delegated-event'],
  ['browser.event.read', 'delegated-event'],
  ['browser.form.reset', 'compiler-form'],
  ['browser.form.submit', 'compiler-form'],
  ['browser.framework.call', 'reviewed-client-export'],
  ['browser.state.read', 'compiler-state'],
  ['browser.state.write', 'compiler-state'],
  ['browser.timer.cancel', 'framework-timer'],
  ['browser.timer.schedule', 'framework-timer'],
  ['server.authority.scope', 'principal-scope'],
  ['server.data.declassify', 'declassify'],
  ['server.database.read', 'managed-db'],
  ['server.database.trusted-sql', 'trustedSql'],
  ['server.database.write', 'managed-db'],
  ['server.egress.request', 'ctx.fetch'],
  ['server.handler.root', 'handler-root'],
  ['server.helper.call', 'local-call-edge'],
  ['server.output.trusted-html', 'trustedHtml'],
  ['server.response.cookie', 'context.setCookie'],
  ['server.response.header', 'structured-headers'],
  ['server.response.outcome', 'respond.*'],
  ['server.response.raw', 'Response'],
  ['server.response.redirect', 'redirect'],
  ['server.storage.read', 'framework-storage'],
  ['server.storage.write', 'framework-storage'],
  ['server.task.compose', 'task-context'],
]);

const artifactRelations = new Map<string, readonly string[]>([
  ['client', ['client-import-subset', 'secret-field-absence', 'operation-serialization']],
  ['css', ['reviewed-exclusion:non-executable-stylesheet']],
  ['registry', ['secret-field-absence']],
  ['server', ['operation-serialization']],
]);

const serverManifestName = '__kovoSecurityOperationManifest_v1';
const securityOperationSchema = 'kovo-security-operation-ir/v1';

interface NormalizedInput {
  artifacts: KovoEmittedTranslationArtifact[];
  decision: {
    clientHandlers: { exportName: string; operations: NormalizedOperation[] }[];
    clientImports: KovoReviewedClientImport[];
    secretFieldNames: string[];
    serverOperations: NormalizedOperation[];
  };
}

interface NormalizedOperation {
  door: string;
  justification?: string;
  kind: string;
  root?: string;
  target?: string;
}

interface ParsedOperationArray {
  end: number;
  operations: NormalizedOperation[];
}

interface SourceToken {
  end: number;
  kind: 'identifier' | 'punctuator' | 'string';
  start: number;
  value: string;
}

/**
 * Re-parse emitted text with no Kovo imports and compare it to compiler decision facts.
 *
 * The checker deliberately performs only direct relations: actual client imports must be a subset
 * of the KV437 record; exact secret field tokens must be absent from client-visible source; every
 * artifact kind must have a reviewed relation or exclusion; and emitted operation JSON must equal
 * the typed decision multiset. It does not re-run compiler analysis (Plan 3 §2.2).
 *
 * @internal
 */
export function verifyEmittedTranslation(input: unknown): KovoEmittedTranslationResult {
  const findings: KovoEmittedTranslationFinding[] = [];
  const normalized = normalizeInput(input, findings);
  if (normalized === undefined) return result(findings);

  checkArtifactCoverage(normalized.artifacts, findings);
  checkClientImports(normalized, findings);
  checkSecretFields(normalized, findings);
  checkOperationSerialization(normalized, findings);
  return result(findings);
}

function normalizeInput(
  input: unknown,
  findings: KovoEmittedTranslationFinding[],
): NormalizedInput | undefined {
  const record = exactRecord(input, 'translation input', ['artifacts', 'decision'], findings);
  if (record === undefined) return undefined;
  const artifactsInput = denseArray(record.artifacts, 'translation artifacts', findings);
  const decision = exactRecord(
    record.decision,
    'translation decision',
    ['clientHandlers', 'clientImports', 'secretFieldNames', 'serverOperations'],
    findings,
  );
  if (artifactsInput === undefined || decision === undefined) return undefined;

  const artifacts: KovoEmittedTranslationArtifact[] = [];
  const seenArtifactFiles = translationCreateSet<string>();
  for (let index = 0; index < translationArrayLength(artifactsInput); index += 1) {
    const value = artifactsInput[index];
    const artifact = exactRecord(
      value,
      `translation artifacts[${index}]`,
      ['fileName', 'kind', 'source'],
      findings,
    );
    if (
      artifact === undefined ||
      !nonemptyString(artifact.fileName) ||
      !nonemptyString(artifact.kind) ||
      typeof artifact.source !== 'string'
    ) {
      pushFinding(
        findings,
        'decision-record',
        'artifact-record-invalid',
        `translation artifacts[${index}] must contain fileName, kind, and source strings`,
      );
      continue;
    }
    if (translationSetHas(seenArtifactFiles, artifact.fileName)) {
      pushFinding(
        findings,
        'decision-record',
        'artifact-record-duplicate',
        `duplicate emitted artifact ${artifact.fileName}`,
      );
      continue;
    }
    translationSetAdd(seenArtifactFiles, artifact.fileName);
    translationArrayAppend(artifacts, {
      fileName: artifact.fileName,
      kind: artifact.kind,
      source: artifact.source,
    });
  }

  const clientImports = normalizeClientImports(decision.clientImports, findings);
  const clientHandlers = normalizeClientHandlers(decision.clientHandlers, findings);
  const secretFieldNames = normalizeSecretFieldNames(decision.secretFieldNames, findings);
  const serverOperations = normalizeExpectedOperations(
    decision.serverOperations,
    'server',
    'translation decision serverOperations',
    findings,
  );
  if (
    clientImports === undefined ||
    clientHandlers === undefined ||
    secretFieldNames === undefined ||
    serverOperations === undefined ||
    hasFindingRelation(findings, 'decision-record')
  ) {
    return undefined;
  }
  return {
    artifacts,
    decision: { clientHandlers, clientImports, secretFieldNames, serverOperations },
  };
}

function normalizeClientImports(
  value: unknown,
  findings: KovoEmittedTranslationFinding[],
): KovoReviewedClientImport[] | undefined {
  const rows = denseArray(value, 'translation decision clientImports', findings);
  if (rows === undefined) return undefined;
  const result: KovoReviewedClientImport[] = [];
  const seen = translationCreateSet<string>();
  for (let index = 0; index < translationArrayLength(rows); index += 1) {
    const value = rows[index];
    const row = exactRecord(
      value,
      `translation decision clientImports[${index}]`,
      ['imports', 'moduleSpecifier'],
      findings,
    );
    const imports = denseArray(
      row?.imports,
      `translation decision clientImports[${index}].imports`,
      findings,
    );
    if (row === undefined || imports === undefined || !nonemptyString(row.moduleSpecifier)) {
      pushFinding(
        findings,
        'decision-record',
        'client-import-record-invalid',
        `translation decision clientImports[${index}] is invalid`,
      );
      continue;
    }
    const normalizedImports: { importedName: string; localName: string }[] = [];
    for (let importIndex = 0; importIndex < translationArrayLength(imports); importIndex += 1) {
      const importValue = imports[importIndex];
      const imported = exactRecord(
        importValue,
        `translation decision clientImports[${index}].imports[${importIndex}]`,
        ['importedName', 'localName'],
        findings,
      );
      if (
        imported === undefined ||
        !identifier(imported.importedName) ||
        !identifier(imported.localName)
      ) {
        pushFinding(
          findings,
          'decision-record',
          'client-import-record-invalid',
          `translation decision clientImports[${index}].imports[${importIndex}] is invalid`,
        );
        continue;
      }
      const key = importKey(row.moduleSpecifier, imported.importedName, imported.localName);
      if (translationSetHas(seen, key)) {
        pushFinding(
          findings,
          'decision-record',
          'client-import-record-duplicate',
          `duplicate reviewed client import ${keyForMessage(key)}`,
        );
        continue;
      }
      translationSetAdd(seen, key);
      translationArrayAppend(normalizedImports, {
        importedName: imported.importedName,
        localName: imported.localName,
      });
    }
    translationArrayAppend(result, {
      imports: normalizedImports,
      moduleSpecifier: row.moduleSpecifier,
    });
  }
  return result;
}

function normalizeClientHandlers(
  value: unknown,
  findings: KovoEmittedTranslationFinding[],
): { exportName: string; operations: NormalizedOperation[] }[] | undefined {
  const rows = denseArray(value, 'translation decision clientHandlers', findings);
  if (rows === undefined) return undefined;
  const result: { exportName: string; operations: NormalizedOperation[] }[] = [];
  const seen = translationCreateSet<string>();
  for (let index = 0; index < translationArrayLength(rows); index += 1) {
    const value = rows[index];
    const row = exactRecord(
      value,
      `translation decision clientHandlers[${index}]`,
      ['exportName', 'operations'],
      findings,
    );
    if (row === undefined || !identifier(row.exportName)) {
      pushFinding(
        findings,
        'decision-record',
        'client-handler-record-invalid',
        `translation decision clientHandlers[${index}] is invalid`,
      );
      continue;
    }
    if (translationSetHas(seen, row.exportName)) {
      pushFinding(
        findings,
        'decision-record',
        'client-handler-record-duplicate',
        `duplicate client handler decision ${row.exportName}`,
      );
      continue;
    }
    translationSetAdd(seen, row.exportName);
    const operations = normalizeExpectedOperations(
      row.operations,
      'client',
      `translation decision clientHandlers[${index}].operations`,
      findings,
    );
    if (operations !== undefined) {
      translationArrayAppend(result, { exportName: row.exportName, operations });
    }
  }
  return result;
}

function normalizeSecretFieldNames(
  value: unknown,
  findings: KovoEmittedTranslationFinding[],
): string[] | undefined {
  const rows = denseArray(value, 'translation decision secretFieldNames', findings);
  if (rows === undefined) return undefined;
  const names: string[] = [];
  for (let index = 0; index < translationArrayLength(rows); index += 1) {
    const item = rows[index];
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 1024 ||
      translationStringIncludes(item, '\0')
    ) {
      pushFinding(
        findings,
        'decision-record',
        'secret-field-record-invalid',
        `translation decision secretFieldNames[${index}] is invalid`,
      );
      continue;
    }
    translationArrayAppend(names, item);
  }
  const unique = translationCreateSet<string>();
  const sorted: string[] = [];
  for (let index = 0; index < translationArrayLength(names); index += 1) {
    const name = names[index]!;
    if (translationSetHas(unique, name)) continue;
    translationSetAdd(unique, name);
    translationArrayAppend(sorted, name);
  }
  translationArraySort(sorted, compareStrings);
  if (!sameStrings(names, sorted)) {
    pushFinding(
      findings,
      'decision-record',
      'secret-field-record-order',
      'translation decision secretFieldNames must be sorted and unique',
    );
  }
  return names;
}

function normalizeExpectedOperations(
  value: unknown,
  context: 'client' | 'server',
  label: string,
  findings: KovoEmittedTranslationFinding[],
): NormalizedOperation[] | undefined {
  const rows = denseArray(value, label, findings);
  if (rows === undefined) return undefined;
  const operations: NormalizedOperation[] = [];
  for (let index = 0; index < translationArrayLength(rows); index += 1) {
    const row = rows[index];
    const operation = normalizeOperation(row, context, `${label}[${index}]`, findings, true);
    if (operation !== undefined) translationArrayAppend(operations, operation);
  }
  return operations;
}

function checkArtifactCoverage(
  artifacts: readonly KovoEmittedTranslationArtifact[],
  findings: KovoEmittedTranslationFinding[],
): void {
  for (let index = 0; index < translationArrayLength(artifacts); index += 1) {
    const artifact = artifacts[index]!;
    if (!translationMapHas(artifactRelations, artifact.kind)) {
      pushFinding(
        findings,
        'artifact-coverage',
        'artifact-kind-unreviewed',
        `${artifact.fileName} has unreviewed emitted kind ${translationJsonStringify(artifact.kind)}`,
        artifact.kind,
      );
    }
    const inferredKind = artifactKindFromReviewedFileName(artifact.fileName);
    if (inferredKind === undefined) {
      pushFinding(
        findings,
        'artifact-coverage',
        'artifact-filename-unreviewed',
        `${artifact.fileName} does not match a reviewed emitted filename shape`,
        artifact.kind,
      );
    } else if (inferredKind !== artifact.kind) {
      pushFinding(
        findings,
        'artifact-coverage',
        'artifact-kind-mismatch',
        `${artifact.fileName} implies ${inferredKind} but is tagged ${artifact.kind}`,
        artifact.kind,
      );
    }
  }
}

function artifactKindFromReviewedFileName(fileName: string): string | undefined {
  if (translationStringEndsWith(fileName, '.client.js')) return 'client';
  if (translationStringEndsWith(fileName, '.server.js')) return 'server';
  if (translationStringEndsWith(fileName, '.css')) return 'css';
  if (fileName === 'generated/registries.d.ts') return 'registry';
  return undefined;
}

function checkClientImports(
  input: NormalizedInput,
  findings: KovoEmittedTranslationFinding[],
): void {
  const reviewed = translationCreateSet<string>();
  for (
    let entryIndex = 0;
    entryIndex < translationArrayLength(input.decision.clientImports);
    entryIndex += 1
  ) {
    const entry = input.decision.clientImports[entryIndex]!;
    for (
      let importIndex = 0;
      importIndex < translationArrayLength(entry.imports);
      importIndex += 1
    ) {
      const imported = entry.imports[importIndex]!;
      translationSetAdd(
        reviewed,
        importKey(entry.moduleSpecifier, imported.importedName, imported.localName),
      );
    }
  }

  for (
    let artifactIndex = 0;
    artifactIndex < translationArrayLength(input.artifacts);
    artifactIndex += 1
  ) {
    const artifact = input.artifacts[artifactIndex]!;
    if (artifact.kind !== 'client') continue;
    let imports: ReturnType<typeof collectJavaScriptModuleReferences>['references'];
    try {
      const collected = collectJavaScriptModuleReferences(parseJavaScriptModule(artifact.source));
      if (collected.limitExceeded) {
        pushFinding(
          findings,
          'client-import-subset',
          'client-import-budget',
          'emitted client module exceeds the finite module-reference budget',
          artifact.kind,
        );
        continue;
      }
      imports = collected.references;
    } catch (error) {
      pushFinding(
        findings,
        'client-import-subset',
        'client-import-parse',
        `${artifact.fileName} import parse failed: ${errorMessage(error)}`,
        artifact.kind,
      );
      continue;
    }
    for (let importIndex = 0; importIndex < translationArrayLength(imports); importIndex += 1) {
      const imported = imports[importIndex]!;
      if (imported.kind !== 'import' || imported.specifier === undefined) {
        pushFinding(
          findings,
          'client-import-subset',
          'client-import-unreviewed',
          `${artifact.fileName} contains a dynamic or computed module acquisition`,
          artifact.kind,
        );
        continue;
      }
      const bindings = staticNamedImportBindings(imported.node);
      if (bindings === undefined) {
        pushFinding(
          findings,
          'client-import-subset',
          'client-import-unreviewed',
          `${artifact.fileName} contains non-canonical import or re-export from ${translationJsonStringify(imported.specifier)}`,
          artifact.kind,
        );
        continue;
      }
      for (
        let bindingIndex = 0;
        bindingIndex < translationArrayLength(bindings);
        bindingIndex += 1
      ) {
        const binding = bindings[bindingIndex]!;
        const key = importKey(imported.specifier, binding.importedName, binding.localName);
        if (translationSetHas(reviewed, key)) continue;
        pushFinding(
          findings,
          'client-import-subset',
          'client-import-unreviewed',
          `${artifact.fileName} emitted unreviewed import ${keyForMessage(key)}`,
          artifact.kind,
        );
      }
    }
  }
}

function staticNamedImportBindings(
  imported: JavaScriptAstNode,
): { importedName: string; localName: string }[] | undefined {
  const importedType = translationOwnDataValue(imported, 'type');
  const specifiers = translationOwnDataValue(imported, 'specifiers');
  const attributes = translationOwnDataValue(imported, 'attributes');
  const assertions = translationOwnDataValue(imported, 'assertions');
  if (
    importedType !== 'ImportDeclaration' ||
    !translationArrayIsArray(specifiers) ||
    translationArrayLength(specifiers) === 0 ||
    (translationArrayIsArray(attributes) && translationArrayLength(attributes) > 0) ||
    (translationArrayIsArray(assertions) && translationArrayLength(assertions) > 0)
  ) {
    return undefined;
  }
  const result: { importedName: string; localName: string }[] = [];
  for (let index = 0; index < translationArrayLength(specifiers); index += 1) {
    const specifier = translationOwnDataValue(specifiers, index);
    if (
      !isJavaScriptAstNode(specifier) ||
      translationOwnDataValue(specifier, 'type') !== 'ImportSpecifier'
    ) {
      return undefined;
    }
    const importedNode = translationOwnDataValue(specifier, 'imported');
    const localNode = translationOwnDataValue(specifier, 'local');
    if (!isJavaScriptAstNode(importedNode) || !isJavaScriptAstNode(localNode)) return undefined;
    const importedNodeType = translationOwnDataValue(importedNode, 'type');
    const localNodeType = translationOwnDataValue(localNode, 'type');
    const importedNodeName = translationOwnDataValue(importedNode, 'name');
    const localNodeName = translationOwnDataValue(localNode, 'name');
    const importedName =
      importedNodeType === 'Identifier' && typeof importedNodeName === 'string'
        ? importedNodeName
        : staticStringValue(importedNode);
    const localName =
      localNodeType === 'Identifier' && typeof localNodeName === 'string'
        ? localNodeName
        : undefined;
    if (
      importedName === undefined ||
      localName === undefined ||
      !identifier(importedName) ||
      !identifier(localName)
    ) {
      return undefined;
    }
    translationArrayAppend(result, { importedName, localName });
  }
  return result;
}

function checkSecretFields(
  input: NormalizedInput,
  findings: KovoEmittedTranslationFinding[],
): void {
  if (input.decision.secretFieldNames.length === 0) return;
  for (
    let artifactIndex = 0;
    artifactIndex < translationArrayLength(input.artifacts);
    artifactIndex += 1
  ) {
    const artifact = input.artifacts[artifactIndex]!;
    if (artifact.kind !== 'client' && artifact.kind !== 'registry') continue;
    let tokens: SourceToken[];
    try {
      tokens = tokenizeSource(artifact.source);
    } catch (error) {
      pushFinding(
        findings,
        'secret-field-absence',
        'secret-field-scan',
        `${artifact.fileName} could not be lexically scanned: ${errorMessage(error)}`,
        artifact.kind,
      );
      continue;
    }
    for (
      let fieldIndex = 0;
      fieldIndex < translationArrayLength(input.decision.secretFieldNames);
      fieldIndex += 1
    ) {
      const field = input.decision.secretFieldNames[fieldIndex]!;
      if (!sourceCarriesField(artifact.source, tokens, field)) continue;
      pushFinding(
        findings,
        'secret-field-absence',
        'secret-field-emitted',
        `${artifact.fileName} contains refused secret field ${translationJsonStringify(field)}`,
        artifact.kind,
      );
    }
  }
}

function sourceCarriesField(
  source: string,
  tokens: readonly SourceToken[],
  field: string,
): boolean {
  const decodedSource = decodeIdentifierEscapes(source);
  if (identifier(field)) return stringArrayIncludes(identifierWords(decodedSource), field);
  if (translationStringIncludes(decodedSource, field)) return true;
  for (let index = 0; index < translationArrayLength(tokens); index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'string' && token.value === field) return true;
  }
  return false;
}

function decodeIdentifierEscapes(source: string): string {
  return translationRegExpReplace(
    /\\u(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))/gu,
    source,
    (match, braced, fixed) => {
      try {
        return translationStringFromCodePoint(parseEscapeDigits((braced ?? fixed) as string));
      } catch {
        return match ?? '';
      }
    },
  );
}

function identifierWords(value: string): string[] {
  return translationRegExpMatches(/[$A-Z_a-z][$\w]*/gu, value);
}

function checkOperationSerialization(
  input: NormalizedInput,
  findings: KovoEmittedTranslationFinding[],
): void {
  const expectedClients = translationCreateMap<string, readonly NormalizedOperation[]>();
  for (
    let handlerIndex = 0;
    handlerIndex < translationArrayLength(input.decision.clientHandlers);
    handlerIndex += 1
  ) {
    const handler = input.decision.clientHandlers[handlerIndex]!;
    translationMapSet(expectedClients, handler.exportName, handler.operations);
  }
  const actualClients = translationCreateMap<string, NormalizedOperation[]>();
  let serverManifestCount = 0;
  const actualServer: NormalizedOperation[] = [];

  for (
    let artifactIndex = 0;
    artifactIndex < translationArrayLength(input.artifacts);
    artifactIndex += 1
  ) {
    const artifact = input.artifacts[artifactIndex]!;
    if (artifact.kind === 'client') {
      const extractedHandlers = extractClientHandlerOperations(artifact, findings);
      for (
        let extractedIndex = 0;
        extractedIndex < translationArrayLength(extractedHandlers);
        extractedIndex += 1
      ) {
        const extracted = extractedHandlers[extractedIndex]!;
        if (translationMapHas(actualClients, extracted.exportName)) {
          pushFinding(
            findings,
            'operation-serialization',
            'operation-handler-duplicate',
            `${artifact.fileName} duplicates generated handler ${extracted.exportName}`,
            artifact.kind,
          );
          continue;
        }
        translationMapSet(actualClients, extracted.exportName, extracted.operations);
      }
    } else if (artifact.kind === 'server') {
      const extracted = extractServerOperations(artifact, findings);
      serverManifestCount += extracted.manifests;
      translationArrayAppendAll(actualServer, extracted.operations);
    }
  }

  translationMapForEach(expectedClients, (expected, exportName) => {
    const actual = translationMapGet(actualClients, exportName);
    if (actual !== undefined && sameOperationMultiset(actual, expected)) return;
    pushFinding(
      findings,
      'operation-serialization',
      'operation-decision-mismatch',
      `client handler ${exportName} operation multiset differs from the decision record`,
      'client',
    );
  });
  translationMapForEach(actualClients, (_actual, exportName) => {
    if (translationMapHas(expectedClients, exportName)) return;
    pushFinding(
      findings,
      'operation-serialization',
      'operation-decision-mismatch',
      `emitted client handler ${exportName} is absent from the decision record`,
      'client',
    );
  });

  const expectedServerManifestCount = input.decision.serverOperations.length === 0 ? 0 : 1;
  if (
    serverManifestCount !== expectedServerManifestCount ||
    !sameOperationMultiset(actualServer, input.decision.serverOperations)
  ) {
    pushFinding(
      findings,
      'operation-serialization',
      'operation-decision-mismatch',
      `server operation multiset differs from the decision record (expected=${input.decision.serverOperations.length}, actual=${actualServer.length}, manifests=${serverManifestCount})`,
      'server',
    );
  }
}

function extractClientHandlerOperations(
  artifact: KovoEmittedTranslationArtifact,
  findings: KovoEmittedTranslationFinding[],
): { exportName: string; operations: NormalizedOperation[] }[] {
  let tokens: SourceToken[];
  try {
    tokens = tokenizeSource(artifact.source);
  } catch (error) {
    pushFinding(
      findings,
      'operation-serialization',
      'operation-source-scan',
      `${artifact.fileName} could not be lexically scanned: ${errorMessage(error)}`,
      artifact.kind,
    );
    return [];
  }
  const result: { exportName: string; operations: NormalizedOperation[] }[] = [];
  const recognizedCalls = translationCreateSet<number>();
  for (let index = 0; index + 5 < tokens.length; index += 1) {
    if (
      !tokenIs(tokens[index], 'identifier', 'export') ||
      !tokenIs(tokens[index + 1], 'identifier', 'const') ||
      tokens[index + 2]?.kind !== 'identifier' ||
      !tokenIs(tokens[index + 3], 'punctuator', '=') ||
      !tokenIs(tokens[index + 4], 'identifier', 'securityHandler') ||
      !tokenIs(tokens[index + 5], 'punctuator', '(')
    ) {
      continue;
    }
    translationSetAdd(recognizedCalls, index + 4);
    const open = tokens[index + 6];
    if (open?.kind !== 'punctuator' || open.value !== '[') {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-json',
        `${artifact.fileName} handler ${tokens[index + 2]!.value} does not start with JSON`,
        artifact.kind,
      );
      continue;
    }
    const parsed = parseOperationArray(
      artifact,
      open.start,
      'client',
      `handler ${tokens[index + 2]!.value}`,
      findings,
    );
    if (parsed === undefined) continue;
    const tokenAfterArray = tokenAtOrAfterSourceOffset(tokens, parsed.end);
    if (!tokenIs(tokenAfterArray, 'punctuator', ',')) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-handler-shape',
        `${artifact.fileName} handler ${tokens[index + 2]!.value} operation JSON is not the complete first argument`,
        artifact.kind,
      );
      continue;
    }
    translationArrayAppend(result, {
      exportName: tokens[index + 2]!.value,
      operations: parsed.operations,
    });
  }
  for (let index = 0; index < translationArrayLength(tokens); index += 1) {
    const token = tokens[index]!;
    if (
      tokenIs(token, 'identifier', 'securityHandler') &&
      tokenIs(tokens[index + 1], 'punctuator', '(') &&
      !translationSetHas(recognizedCalls, index)
    ) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-handler-shape',
        `${artifact.fileName} contains a non-canonical securityHandler call`,
        artifact.kind,
      );
    }
  }
  return result;
}

function extractServerOperations(
  artifact: KovoEmittedTranslationArtifact,
  findings: KovoEmittedTranslationFinding[],
): { manifests: number; operations: NormalizedOperation[] } {
  let tokens: SourceToken[];
  try {
    tokens = tokenizeSource(artifact.source);
  } catch (error) {
    pushFinding(
      findings,
      'operation-serialization',
      'operation-source-scan',
      `${artifact.fileName} could not be lexically scanned: ${errorMessage(error)}`,
      artifact.kind,
    );
    return { manifests: 0, operations: [] };
  }
  const direct = extractServerOperationsFromTokens(artifact, tokens, findings);
  if (direct.manifests > 0) return direct;

  const nested = { manifests: 0, operations: [] as NormalizedOperation[] };
  for (let index = 0; index < translationArrayLength(tokens); index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'string' || !translationStringIncludes(token.value, serverManifestName)) {
      continue;
    }
    let nestedTokens: SourceToken[];
    try {
      nestedTokens = tokenizeSource(token.value);
    } catch (error) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-source-scan',
        `${artifact.fileName} embedded render source could not be lexically scanned: ${errorMessage(error)}`,
        artifact.kind,
      );
      continue;
    }
    const extracted = extractServerOperationsFromTokens(
      { ...artifact, source: token.value },
      nestedTokens,
      findings,
    );
    nested.manifests += extracted.manifests;
    translationArrayAppendAll(nested.operations, extracted.operations);
  }
  return nested;
}

function extractServerOperationsFromTokens(
  artifact: KovoEmittedTranslationArtifact,
  tokens: readonly SourceToken[],
  findings: KovoEmittedTranslationFinding[],
): { manifests: number; operations: NormalizedOperation[] } {
  let manifests = 0;
  const operations: NormalizedOperation[] = [];
  for (let index = 0; index < translationArrayLength(tokens); index += 1) {
    const token = tokens[index]!;
    if (!tokenIs(token, 'identifier', serverManifestName)) continue;
    manifests += 1;
    if (
      !tokenIs(tokens[index - 2], 'identifier', 'export') ||
      !tokenIs(tokens[index - 1], 'identifier', 'const') ||
      !tokenIs(tokens[index + 1], 'punctuator', '=') ||
      !tokenIs(tokens[index + 2], 'identifier', 'Object') ||
      !tokenIs(tokens[index + 3], 'punctuator', '.') ||
      !tokenIs(tokens[index + 4], 'identifier', 'freeze') ||
      !tokenIs(tokens[index + 5], 'punctuator', '(') ||
      !tokenIs(tokens[index + 6], 'punctuator', '{')
    ) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} contains a non-canonical ${serverManifestName}`,
        artifact.kind,
      );
      continue;
    }
    const manifestCloseIndex = matchingPunctuatorIndex(tokens, index + 6, '{', '}');
    if (manifestCloseIndex === -1 || !tokenIs(tokens[manifestCloseIndex + 1], 'punctuator', ')')) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} has an unbounded server security-operation manifest`,
        artifact.kind,
      );
      continue;
    }
    const operationsIndex = index + 7;
    if (
      !tokenSequenceAt(tokens, operationsIndex, [
        ['identifier', 'operations'],
        ['punctuator', ':'],
        ['identifier', 'Object'],
        ['punctuator', '.'],
        ['identifier', 'freeze'],
        ['punctuator', '('],
        ['punctuator', '['],
      ])
    ) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} has an incomplete server security-operation manifest`,
        artifact.kind,
      );
      continue;
    }
    const open = tokens[operationsIndex + 6]!;
    const parsed = parseOperationArray(artifact, open.start, 'server', 'server manifest', findings);
    if (parsed === undefined) continue;
    const tokenAfterArrayIndex = tokenIndexAtOrAfterSourceOffset(tokens, parsed.end);
    if (tokenAfterArrayIndex === -1 || !tokenIs(tokens[tokenAfterArrayIndex], 'punctuator', ')')) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} server operation JSON is not the complete Object.freeze argument`,
        artifact.kind,
      );
      continue;
    }
    const manifestTailIndex = tokenAfterArrayIndex + 1;
    if (
      !tokenSequenceAt(tokens, manifestTailIndex, [
        ['punctuator', ','],
        ['identifier', 'schema'],
        ['punctuator', ':'],
        ['string', securityOperationSchema],
        ['punctuator', ','],
        ['identifier', 'semanticGraph'],
        ['punctuator', ':'],
      ])
    ) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} has duplicate, reordered, or incomplete server manifest fields`,
        artifact.kind,
      );
      continue;
    }
    const semanticGraphToken = tokens[manifestTailIndex + 7];
    const manifestClose = tokens[manifestCloseIndex]!;
    if (
      semanticGraphToken === undefined ||
      semanticGraphToken.start >= manifestClose.start ||
      !isOwnDataJsonOrUndefined(
        translationStringTrim(
          translationStringSlice(artifact.source, semanticGraphToken.start, manifestClose.start),
        ),
      )
    ) {
      pushFinding(
        findings,
        'operation-serialization',
        'operation-manifest-shape',
        `${artifact.fileName} has a non-data semantic graph or trailing manifest fields`,
        artifact.kind,
      );
      continue;
    }
    translationArrayAppendAll(operations, parsed.operations);
  }
  return { manifests, operations };
}

function tokenSequenceAt(
  tokens: readonly SourceToken[],
  start: number,
  sequence: readonly (readonly [SourceToken['kind'], string])[],
): boolean {
  for (let offset = 0; offset < translationArrayLength(sequence); offset += 1) {
    const expected = sequence[offset]!;
    if (!tokenIs(tokens[start + offset], expected[0], expected[1])) return false;
  }
  return true;
}

function isOwnDataJsonOrUndefined(source: string): boolean {
  if (source === 'undefined') return true;
  try {
    translationJsonParse(source);
    return true;
  } catch {
    return false;
  }
}

function matchingPunctuatorIndex(
  tokens: readonly SourceToken[],
  openIndex: number,
  open: string,
  close: string,
): number {
  if (!tokenIs(tokens[openIndex], 'punctuator', open)) return -1;
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokenIs(tokens[index], 'punctuator', open)) depth += 1;
    else if (tokenIs(tokens[index], 'punctuator', close)) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function tokenAtOrAfterSourceOffset(
  tokens: readonly SourceToken[],
  sourceOffset: number,
): SourceToken | undefined {
  const index = tokenIndexAtOrAfterSourceOffset(tokens, sourceOffset);
  return index === -1 ? undefined : tokens[index];
}

function tokenIndexAtOrAfterSourceOffset(
  tokens: readonly SourceToken[],
  sourceOffset: number,
): number {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.start >= sourceOffset) return index;
  }
  return -1;
}

/*
 * Keep the operation array parser below separate from manifest-shape parsing: JSON ownership and
 * vocabulary are one obligation; proving that exact JSON is the runtime argument is another.
 */
function parseOperationArray(
  artifact: KovoEmittedTranslationArtifact,
  start: number,
  context: 'client' | 'server',
  label: string,
  findings: KovoEmittedTranslationFinding[],
): ParsedOperationArray | undefined {
  const end = jsonArrayEnd(artifact.source, start);
  if (end === undefined) {
    pushFinding(
      findings,
      'operation-serialization',
      'operation-json',
      `${artifact.fileName} ${label} operation array is not bounded JSON`,
      artifact.kind,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = translationJsonParse(translationStringSlice(artifact.source, start, end));
  } catch {
    pushFinding(
      findings,
      'operation-serialization',
      'operation-json',
      `${artifact.fileName} ${label} operation array is not own-data JSON`,
      artifact.kind,
    );
    return undefined;
  }
  const rows = denseArray(parsed, `${artifact.fileName} ${label} operations`, findings, {
    artifactKind: artifact.kind,
    relation: 'operation-serialization',
  });
  if (rows === undefined) return undefined;
  const operations: NormalizedOperation[] = [];
  for (let index = 0; index < translationArrayLength(rows); index += 1) {
    const row = rows[index];
    const operation = normalizeOperation(
      row,
      context,
      `${artifact.fileName} ${label} operations[${index}]`,
      findings,
      false,
      artifact.kind,
    );
    if (operation !== undefined) translationArrayAppend(operations, operation);
  }
  return { end, operations };
}

function normalizeOperation(
  value: unknown,
  context: 'client' | 'server',
  label: string,
  findings: KovoEmittedTranslationFinding[],
  decision: boolean,
  artifactKind?: string,
): NormalizedOperation | undefined {
  const relation = decision ? 'decision-record' : 'operation-serialization';
  const record = dataRecord(value, label, findings, {
    ...(artifactKind === undefined ? {} : { artifactKind }),
    relation,
  });
  if (record === undefined) return undefined;
  const allowed =
    context === 'client'
      ? stringSet(['door', 'kind', 'target'])
      : stringSet(['door', 'justification', 'kind', 'root', 'target']);
  const keys = translationObjectKeys(record);
  if (
    !stringArrayIncludes(keys, 'door') ||
    !stringArrayIncludes(keys, 'kind') ||
    hasStringOutsideSet(keys, allowed)
  ) {
    pushFinding(
      findings,
      relation,
      decision ? 'operation-decision-invalid' : 'operation-json',
      `${label} has invalid operation keys`,
      artifactKind,
    );
    return undefined;
  }
  if (!nonemptyString(record.kind) || !nonemptyString(record.door)) {
    pushFinding(
      findings,
      relation,
      decision ? 'operation-decision-invalid' : 'operation-json',
      `${label} kind and door must be non-empty strings`,
      artifactKind,
    );
    return undefined;
  }
  const vocabulary = context === 'client' ? browserOperationKinds : serverOperationKinds;
  if (!translationSetHas(vocabulary, record.kind)) {
    pushFinding(
      findings,
      relation,
      decision ? 'operation-decision-invalid' : 'operation-kind-unreviewed',
      `${label} uses unreviewed operation kind ${translationJsonStringify(record.kind)}`,
      artifactKind,
    );
    return undefined;
  }
  const expectedDoor = translationMapGet(operationDoorByKind, record.kind);
  if (record.door !== expectedDoor) {
    pushFinding(
      findings,
      relation,
      decision ? 'operation-decision-invalid' : 'operation-door-mismatch',
      `${label} pairs ${record.kind} with ${translationJsonStringify(record.door)} instead of ${expectedDoor}`,
      artifactKind,
    );
    return undefined;
  }
  const optionalKeys = ['justification', 'root', 'target'] as const;
  for (let index = 0; index < translationArrayLength(optionalKeys); index += 1) {
    const optional = optionalKeys[index]!;
    if (record[optional] !== undefined && typeof record[optional] !== 'string') {
      pushFinding(
        findings,
        relation,
        decision ? 'operation-decision-invalid' : 'operation-json',
        `${label}.${optional} must be a string when present`,
        artifactKind,
      );
      return undefined;
    }
  }
  return {
    door: record.door,
    kind: record.kind,
    ...(record.justification === undefined
      ? {}
      : { justification: record.justification as string }),
    ...(record.root === undefined ? {} : { root: record.root as string }),
    ...(record.target === undefined ? {} : { target: record.target as string }),
  };
}

function sameOperationMultiset(
  left: readonly NormalizedOperation[],
  right: readonly NormalizedOperation[],
): boolean {
  const leftKeys: string[] = [];
  const rightKeys: string[] = [];
  for (let index = 0; index < translationArrayLength(left); index += 1) {
    translationArrayAppend(leftKeys, operationKey(left[index]!));
  }
  for (let index = 0; index < translationArrayLength(right); index += 1) {
    translationArrayAppend(rightKeys, operationKey(right[index]!));
  }
  translationArraySort(leftKeys, compareStrings);
  translationArraySort(rightKeys, compareStrings);
  return sameStrings(leftKeys, rightKeys);
}

function operationKey(operation: NormalizedOperation): string {
  const door = translationOwnDataValue(operation, 'door');
  const justification = translationOwnDataValue(operation, 'justification');
  const kind = translationOwnDataValue(operation, 'kind');
  const root = translationOwnDataValue(operation, 'root');
  const target = translationOwnDataValue(operation, 'target');
  return translationArrayJoin(
    [
      translationJsonStringify(door),
      translationJsonStringify(justification ?? null),
      translationJsonStringify(kind),
      translationJsonStringify(root ?? null),
      translationJsonStringify(target ?? null),
    ],
    '\0',
  );
}

function tokenizeSource(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  for (let index = 0; index < source.length; ) {
    const char = source[index]!;
    if (translationRegExpTest(/\s/u, char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const newline = translationStringIndexOf(source, '\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const close = translationStringIndexOf(source, '*/', index + 2);
      if (close === -1) throw translationSyntaxError('unterminated block comment');
      index = close + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = quotedStringEnd(source, index, char);
      const raw = translationStringSlice(source, index, end);
      translationArrayAppend(tokens, {
        end,
        kind: 'string',
        start: index,
        value: decodeQuotedString(raw, char),
      });
      index = end;
      continue;
    }
    if (char === '`') {
      const end = templateEnd(source, index);
      translationArrayAppend(tokens, {
        end,
        kind: 'string',
        start: index,
        value: decodeTemplateText(translationStringSlice(source, index + 1, end - 1)),
      });
      index = end;
      continue;
    }
    if (translationRegExpTest(/[$A-Z_a-z]/u, char)) {
      let end = index + 1;
      while (end < source.length && translationRegExpTest(/[$\w]/u, source[end]!)) end += 1;
      translationArrayAppend(tokens, {
        end,
        kind: 'identifier',
        start: index,
        value: translationStringSlice(source, index, end),
      });
      index = end;
      continue;
    }
    translationArrayAppend(tokens, {
      end: index + 1,
      kind: 'punctuator',
      start: index,
      value: char,
    });
    index += 1;
  }
  return tokens;
}

function quotedStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (source[index] === '\n' || source[index] === '\r') {
      throw translationSyntaxError('newline in quoted string');
    }
  }
  throw translationSyntaxError('unterminated quoted string');
}

function decodeQuotedString(raw: string, quote: string): string {
  if (quote === '"') return translationJsonParse(raw) as string;
  let output = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index]!;
    if (char !== '\\') {
      output += char;
      continue;
    }
    const escaped = raw[++index];
    if (escaped === undefined) throw translationSyntaxError('truncated string escape');
    const simple = simpleEscape(escaped);
    if (simple !== undefined) {
      output += simple;
    } else if (escaped === 'x') {
      output += codePointEscape(raw, index + 1, 2);
      index += 2;
    } else if (escaped === 'u') {
      if (raw[index + 1] === '{') {
        const close = translationStringIndexOf(raw, '}', index + 2);
        if (close === -1) throw translationSyntaxError('unterminated unicode escape');
        output += translationStringFromCodePoint(
          parseEscapeDigits(translationStringSlice(raw, index + 2, close)),
        );
        index = close;
      } else {
        output += codePointEscape(raw, index + 1, 4);
        index += 4;
      }
    } else if (escaped !== '\n' && escaped !== '\r') {
      output += escaped;
    }
  }
  return output;
}

function codePointEscape(source: string, start: number, length: number): string {
  return translationStringFromCodePoint(
    parseEscapeDigits(translationStringSlice(source, start, start + length)),
  );
}

function parseEscapeDigits(value: string): number {
  if (!translationRegExpTest(/^[0-9A-Fa-f]+$/u, value)) {
    throw translationSyntaxError('invalid hexadecimal escape');
  }
  const parsed = translationNumberParseInt(value, 16);
  if (!translationNumberIsSafeInteger(parsed) || parsed > 0x10ffff) {
    throw translationSyntaxError('invalid unicode code point');
  }
  return parsed;
}

function templateEnd(source: string, start: number): number {
  let interpolationDepth = 0;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === '$' && source[index + 1] === '{') {
      interpolationDepth += 1;
      index += 1;
      continue;
    }
    if (source[index] === '}' && interpolationDepth > 0) {
      interpolationDepth -= 1;
      continue;
    }
    if (source[index] === '`' && interpolationDepth === 0) return index + 1;
  }
  throw translationSyntaxError('unterminated template literal');
}

function decodeTemplateText(raw: string): string {
  let output = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char !== '\\') {
      output += char;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined) throw translationSyntaxError('truncated template escape');
    output += escaped;
    index += 1;
  }
  return output;
}

function jsonArrayEnd(source: string, start: number): number | undefined {
  if (source[start] !== '[') return undefined;
  const stack = [']'];
  let inString = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') translationArrayAppend(stack, ']');
    else if (char === '{') translationArrayAppend(stack, '}');
    else if (char === ']' || char === '}') {
      if (translationArrayPop(stack) !== char) return undefined;
      if (stack.length === 0) return index + 1;
    }
  }
  return undefined;
}

function exactRecord(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
  findings: KovoEmittedTranslationFinding[],
): Record<string, unknown> | undefined {
  const record = dataRecord(value, label, findings);
  if (record === undefined) return undefined;
  const actual = translationObjectKeys(record);
  const expected = translationArrayCopy(expectedKeys);
  translationArraySort(actual, compareStrings);
  translationArraySort(expected, compareStrings);
  if (!sameStrings(actual, expected)) {
    pushFinding(
      findings,
      'decision-record',
      'decision-record-keys',
      `${label} keys must equal ${translationArrayJoin(expected, ',')}; got ${translationArrayJoin(actual, ',')}`,
    );
    return undefined;
  }
  return record;
}

function dataRecord(
  value: unknown,
  label: string,
  findings: KovoEmittedTranslationFinding[],
  context: {
    artifactKind?: string;
    relation?: KovoEmittedTranslationFinding['relation'];
  } = {},
): Record<string, unknown> | undefined {
  const requestedRelation = translationOwnDataValue(context, 'relation');
  const relation =
    requestedRelation === 'operation-serialization' ? 'operation-serialization' : 'decision-record';
  const contextArtifactKind = translationOwnDataValue(context, 'artifactKind');
  const artifactKind = typeof contextArtifactKind === 'string' ? contextArtifactKind : undefined;
  if (typeof value !== 'object' || value === null || translationArrayIsArray(value)) {
    pushFinding(
      findings,
      relation,
      relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
      `${label} must be an own-data object`,
      artifactKind,
    );
    return undefined;
  }
  try {
    const firstPrototype = translationGetPrototypeOf(value);
    const secondPrototype = translationGetPrototypeOf(value);
    if (firstPrototype !== translationObjectPrototype || secondPrototype !== firstPrototype) {
      pushFinding(
        findings,
        relation,
        relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
        `${label} must use Object.prototype`,
        artifactKind,
      );
      return undefined;
    }
    const firstDescriptors = translationGetOwnPropertyDescriptors(value);
    const secondDescriptors = translationGetOwnPropertyDescriptors(value);
    const keys = translationOwnKeys(firstDescriptors);
    const secondKeys = translationOwnKeys(secondDescriptors);
    if (!sameStrings(keys, secondKeys)) throw translationTypeError('unstable object keys');
    const snapshot = translationCreateNullRecord<unknown>();
    for (let index = 0; index < translationArrayLength(keys); index += 1) {
      const key = keys[index]!;
      if (typeof key !== 'string') {
        pushFinding(
          findings,
          relation,
          relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
          `${label} must not contain symbol keys`,
          artifactKind,
        );
        return undefined;
      }
      const first = firstDescriptors[key];
      const second = secondDescriptors[key];
      if (!translationSameDataDescriptor(first, second)) {
        pushFinding(
          findings,
          relation,
          relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
          `${label}.${key} must be stable own data`,
          artifactKind,
        );
        return undefined;
      }
      translationDefineOwnDataProperty(snapshot, key, first.value);
    }
    return snapshot;
  } catch {
    pushFinding(
      findings,
      relation,
      relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
      `${label} could not be snapshotted`,
      artifactKind,
    );
    return undefined;
  }
}

function denseArray(
  value: unknown,
  label: string,
  findings: KovoEmittedTranslationFinding[],
  context: {
    artifactKind?: string;
    relation?: KovoEmittedTranslationFinding['relation'];
  } = {},
): readonly unknown[] | undefined {
  const requestedRelation = translationOwnDataValue(context, 'relation');
  const relation =
    requestedRelation === 'operation-serialization' ? 'operation-serialization' : 'decision-record';
  const contextArtifactKind = translationOwnDataValue(context, 'artifactKind');
  const artifactKind = typeof contextArtifactKind === 'string' ? contextArtifactKind : undefined;
  if (!translationArrayIsArray(value)) {
    pushFinding(
      findings,
      relation,
      relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
      `${label} must be a dense own-data array`,
      artifactKind,
    );
    return undefined;
  }
  try {
    const firstPrototype = translationGetPrototypeOf(value);
    const secondPrototype = translationGetPrototypeOf(value);
    if (firstPrototype !== translationArrayPrototype || secondPrototype !== firstPrototype) {
      throw translationTypeError('array prototype');
    }
    const firstDescriptors = translationGetOwnPropertyDescriptors(value);
    const secondDescriptors = translationGetOwnPropertyDescriptors(value);
    const firstKeys = translationOwnKeys(firstDescriptors);
    const secondKeys = translationOwnKeys(secondDescriptors);
    if (!sameStrings(firstKeys, secondKeys)) throw translationTypeError('array keys');
    const lengthDescriptor = firstDescriptors['length'];
    const secondLengthDescriptor = secondDescriptors['length'];
    if (
      !translationSameDataDescriptor(lengthDescriptor, secondLengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number'
    ) {
      throw translationTypeError('array length');
    }
    const length = lengthDescriptor.value;
    if (!translationNumberIsSafeInteger(length) || length < 0 || length > 1_000_000) {
      throw translationTypeError('array length');
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const first = firstDescriptors[`${index}`];
      const second = secondDescriptors[`${index}`];
      if (!translationSameDataDescriptor(first, second)) {
        throw translationTypeError('array hole');
      }
      translationArrayAppend(output, first.value);
    }
    if (translationArrayLength(firstKeys) !== length + 1) {
      throw translationTypeError('array property');
    }
    for (let index = 0; index < translationArrayLength(firstKeys); index += 1) {
      const key = firstKeys[index];
      if (key === 'length') continue;
      if (typeof key !== 'string' || !canonicalArrayIndex(key, length)) {
        throw translationTypeError('array property');
      }
    }
    return output;
  } catch {
    pushFinding(
      findings,
      relation,
      relation === 'decision-record' ? 'decision-record-own-data' : 'operation-json',
      `${label} must be a dense own-data array`,
      artifactKind,
    );
    return undefined;
  }
}

function result(findings: readonly KovoEmittedTranslationFinding[]): KovoEmittedTranslationResult {
  const sorted = translationArrayCopy(findings);
  translationArraySort(
    sorted,
    (left, right) =>
      compareStrings(left.relation, right.relation) ||
      compareStrings(left.code, right.code) ||
      compareStrings(findingArtifactKind(left), findingArtifactKind(right)) ||
      compareStrings(left.message, right.message),
  );
  return { findings: sorted, ok: sorted.length === 0 };
}

function pushFinding(
  findings: KovoEmittedTranslationFinding[],
  relation: KovoEmittedTranslationFinding['relation'],
  code: string,
  message: string,
  artifactKind?: string,
): void {
  translationArrayAppend(findings, {
    ...(artifactKind === undefined ? {} : { artifactKind }),
    code,
    message,
    relation,
  });
}

function tokenIs(
  token: SourceToken | undefined,
  kind: SourceToken['kind'],
  value: string,
): boolean {
  return token?.kind === kind && token.value === value;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && translationRegExpTest(/^[$A-Z_a-z][$\w]*$/u, value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function importKey(moduleSpecifier: string, importedName: string, localName: string): string {
  return `${moduleSpecifier}\0${importedName}\0${localName}`;
}

function keyForMessage(key: string): string {
  const values = translationStringSplit(key, '\0');
  const serialized: string[] = [];
  for (let index = 0; index < translationArrayLength(values); index += 1) {
    translationArrayAppend(serialized, translationJsonStringify(values[index]));
  }
  return translationArrayJoin(serialized, ' / ');
}

function sameStrings(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (translationArrayLength(left) !== translationArrayLength(right)) return false;
  for (let index = 0; index < translationArrayLength(left); index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return translationErrorMessage(error);
}

function findingArtifactKind(finding: KovoEmittedTranslationFinding): string {
  const artifactKind = translationOwnDataValue(finding, 'artifactKind');
  return typeof artifactKind === 'string' ? artifactKind : '';
}

function hasFindingRelation(
  findings: readonly KovoEmittedTranslationFinding[],
  relation: KovoEmittedTranslationFinding['relation'],
): boolean {
  for (let index = 0; index < translationArrayLength(findings); index += 1) {
    if (findings[index]!.relation === relation) return true;
  }
  return false;
}

function stringArrayIncludes(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < translationArrayLength(values); index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function stringSet(values: readonly string[]): Set<string> {
  const result = translationCreateSet<string>();
  for (let index = 0; index < translationArrayLength(values); index += 1) {
    translationSetAdd(result, values[index]!);
  }
  return result;
}

function hasStringOutsideSet(values: readonly string[], allowed: ReadonlySet<string>): boolean {
  for (let index = 0; index < translationArrayLength(values); index += 1) {
    if (!translationSetHas(allowed, values[index]!)) return true;
  }
  return false;
}

function simpleEscape(value: string): string | undefined {
  if (value === 'b') return '\b';
  if (value === 'f') return '\f';
  if (value === 'n') return '\n';
  if (value === 'r') return '\r';
  if (value === 't') return '\t';
  if (value === 'v') return '\v';
  return undefined;
}

function canonicalArrayIndex(value: string, length: number): boolean {
  if (value.length === 0) return false;
  const parsed = translationNumberParseInt(value, 10);
  return (
    translationNumberIsSafeInteger(parsed) &&
    parsed >= 0 &&
    parsed < length &&
    `${parsed}` === value
  );
}
