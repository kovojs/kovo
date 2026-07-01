export const DEC8_SECURITY_PRESETS = ['node', 'cloudflare', 'vercel'] as const;

export const DEC8_SECURITY_DIALECTS = ['pglite', 'better-sqlite3'] as const;

export type Dec8SecurityPreset = (typeof DEC8_SECURITY_PRESETS)[number];

export type Dec8SecurityDialect = (typeof DEC8_SECURITY_DIALECTS)[number];

export interface Dec8SecurityMatrixEntry {
  preset: Dec8SecurityPreset;
  dialect: Dec8SecurityDialect;
}

export const DEC8_SECURITY_MATRIX: readonly Dec8SecurityMatrixEntry[] =
  DEC8_SECURITY_PRESETS.flatMap((preset) =>
    DEC8_SECURITY_DIALECTS.map((dialect) => ({ preset, dialect })),
  );

export type GateAdversary =
  | 'hostile-committer'
  | 'hostile-end-user'
  | 'hostile-end-user-input'
  | 'honest-fallible-author';

export type GateAdversaryClass = 'capability-auth' | 'ddl-sql-guard' | 'egress-wire' | 'kv-taint';

export interface GateAdversaryMapEntry {
  adversaryClass: GateAdversaryClass;
  adversaries: readonly GateAdversary[];
  hostileTest: string;
  rationale: string;
}

const ddlSqlGuard = {
  adversaryClass: 'ddl-sql-guard',
  adversaries: ['hostile-committer'],
  hostileTest: 'scripts/check-sink-policy-gate.test.mjs',
  rationale: 'DEC9 maps DDL/SQL guards to a hostile committer mutating the choke or policy.',
} satisfies GateAdversaryMapEntry;

const sqlWriteGuard = {
  adversaryClass: 'ddl-sql-guard',
  adversaries: ['hostile-committer'],
  hostileTest: 'packages/server/src/sql-write-allowlist.test.ts',
  rationale:
    'DEC9 maps write-table parsing and SQL write classification to hostile committer drift.',
} satisfies GateAdversaryMapEntry;

const egressWire = {
  adversaryClass: 'egress-wire',
  adversaries: ['hostile-committer', 'hostile-end-user-input'],
  hostileTest: 'packages/server/src/response.test.ts',
  rationale: 'DEC9 maps egress chokes to both committer drift and hostile reflected input.',
} satisfies GateAdversaryMapEntry;

const queryWire = {
  adversaryClass: 'egress-wire',
  adversaries: ['hostile-committer', 'hostile-end-user-input'],
  hostileTest: 'packages/server/src/query-endpoint.test.ts',
  rationale: 'DEC9 maps query wire output to egress choke and hostile input coverage.',
} satisfies GateAdversaryMapEntry;

const mutationWire = {
  adversaryClass: 'egress-wire',
  adversaries: ['hostile-committer', 'hostile-end-user-input'],
  hostileTest: 'packages/server/src/mutation-response.test.ts',
  rationale: 'DEC9 maps mutation wire output to egress choke and hostile input coverage.',
} satisfies GateAdversaryMapEntry;

const documentWire = {
  adversaryClass: 'egress-wire',
  adversaries: ['hostile-committer', 'hostile-end-user-input'],
  hostileTest: 'packages/server/src/document.test.ts',
  rationale: 'DEC9 maps SSR document output to the response egress choke.',
} satisfies GateAdversaryMapEntry;

const staticExportWire = {
  adversaryClass: 'egress-wire',
  adversaries: ['hostile-committer', 'hostile-end-user-input'],
  hostileTest: 'packages/server/src/static-export-headers.test.ts',
  rationale: 'DEC9 maps static-export response headers to egress choke coverage.',
} satisfies GateAdversaryMapEntry;

const capabilityAuth = {
  adversaryClass: 'capability-auth',
  adversaries: ['hostile-end-user'],
  hostileTest: 'packages/server/src/capability-url.test.ts',
  rationale: 'DEC9 maps capability and auth gates to hostile end-user tampering and replay.',
} satisfies GateAdversaryMapEntry;

const kvTrustedHtmlTaint = {
  adversaryClass: 'kv-taint',
  adversaries: ['hostile-end-user-input'],
  hostileTest: 'packages/compiler/src/trusted-html-provenance.test.ts',
  rationale: 'DEC9 maps KV426 trusted-HTML provenance to hostile end-user input.',
} satisfies GateAdversaryMapEntry;

const kvConfidentialityTaint = {
  adversaryClass: 'kv-taint',
  adversaries: ['hostile-end-user-input'],
  hostileTest: 'packages/drizzle/src/confidentiality-folded-read-set.test.ts',
  rationale: 'DEC9 maps KV435 confidentiality flow to hostile end-user input reaching wire output.',
} satisfies GateAdversaryMapEntry;

const kvQueryShapeTaint = {
  adversaryClass: 'kv-taint',
  adversaries: ['hostile-end-user-input'],
  hostileTest: 'packages/drizzle/src/index.query-shapes.test.ts',
  rationale: 'DEC9 maps query-shape taint and wrapper recognition to hostile end-user input.',
} satisfies GateAdversaryMapEntry;

const kvFrameworkIdentityTaint = {
  adversaryClass: 'kv-taint',
  adversaries: ['hostile-end-user-input'],
  hostileTest: 'packages/drizzle/src/index.identity-resolver.test.ts',
  rationale: 'DEC9 maps framework identity and alias recognition to hostile end-user input.',
} satisfies GateAdversaryMapEntry;

export function gateDecisionKey(file: string, name: string): string {
  return `${file}#${name}`;
}

function gateEntries(
  file: string,
  names: readonly string[],
  entry: GateAdversaryMapEntry,
): Record<string, GateAdversaryMapEntry> {
  const entries: Record<string, GateAdversaryMapEntry> = {};
  for (const name of names) entries[gateDecisionKey(file, name)] = entry;
  return entries;
}

export const GATE_ADVERSARY_MAP: Readonly<Record<string, GateAdversaryMapEntry>> = {
  ...gateEntries(
    'packages/server/src/sql-safe-handle.ts',
    [
      'assertReadSqlStatement',
      'assertSqlWriteTablesAllowed',
      'enforceManagedSql',
      'managedSqlSafetyMode',
      'parseManagedSqlWriteTables',
    ],
    ddlSqlGuard,
  ),
  ...gateEntries(
    'packages/server/src/sql-write-allowlist.ts',
    ['parseSqlWriteTables', 'unparsedSqliteWriteStatement', 'writeTablesForStatement'],
    sqlWriteGuard,
  ),
  ...gateEntries(
    'packages/server/src/response.ts',
    [
      'blessRedirectResponse',
      'htmlServerErrorResponse',
      'redirectLocationHeader',
      'redirectLocationHeaderValue',
      'routeOutcomeHeaders',
      'routeOutcomeResponse',
      'routeResponseToDocumentResponse',
      'routeResponseToWebResponse',
      'serverResponseToWebResponse',
    ],
    egressWire,
  ),
  ...gateEntries(
    'packages/server/src/query.ts',
    [
      'queryJsonHeaders',
      'renderQueryEndpointChunk',
      'renderQueryEndpointResponse',
      'renderQueryRegistryEndpointResponse',
      'withQueryCacheHeaders',
    ],
    queryWire,
  ),
  ...gateEntries(
    'packages/server/src/mutation/wire-response.ts',
    [
      'enhancedMutationReauthResponse',
      'mutationWireFailureResponse',
      'mutationWireResponseHeaders',
      'renderMutationWireLifecycleResponse',
      'renderSuccessfulMutationWireResponse',
    ],
    mutationWire,
  ),
  ...gateEntries(
    'packages/server/src/mutation/streaming.ts',
    ['renderStreamingMutationWireResponse'],
    mutationWire,
  ),
  ...gateEntries(
    'packages/server/src/document-core.ts',
    ['renderDocument', 'renderErrorDocument', 'renderRouteDocumentResponse'],
    documentWire,
  ),
  ...gateEntries('packages/server/src/app-system-response.ts', ['appSystemResponse'], egressWire),
  ...gateEntries(
    'packages/server/src/capability-url.ts',
    ['verifyCapability', 'signCapability'],
    capabilityAuth,
  ),
  ...gateEntries(
    'packages/server/src/static-export-headers.ts',
    ['createStaticExportHeaderSink', 'staticExportHeaders'],
    staticExportWire,
  ),
  ...gateEntries(
    'packages/compiler/src/validate/trusted-html-provenance.ts',
    [
      'classifyExpression',
      'rawTrustSinkForCall',
      'rawTrustSinkForExpression',
      'validateTrustedHtmlProvenance',
    ],
    kvTrustedHtmlTaint,
  ),
  ...gateEntries(
    'packages/compiler/src/validate/confidentiality.ts',
    ['secretQueryShapePaths', 'tableRowQueryShapePaths', 'validateSecretQueryWire'],
    kvConfidentialityTaint,
  ),
  ...gateEntries(
    'packages/drizzle/src/static/query-shapes.ts',
    [
      'isOpaqueProjection',
      'isQueryShapeWrapper',
      'selectShapeFromQueryBody',
      'sourceDestructuredQueryReceiverDiagnostics',
      'typedSqlProjectionShape',
    ],
    kvQueryShapeTaint,
  ),
  ...gateEntries(
    'packages/drizzle/src/static/framework-identity.ts',
    [
      'canonicalExpression',
      'canonicalFrameworkExportForExpression',
      'frameworkIdentityExpressionKindResolution',
      'namespaceMemberIdentityForIdentifier',
    ],
    kvFrameworkIdentityTaint,
  ),
};
