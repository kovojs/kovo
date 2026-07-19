import type {
  BrowserSecurityOperationKind,
  SecurityOperationDoor,
  SecuritySemanticBudgets,
  SecuritySemanticClosedReason,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

/**
 * The finite provenance vocabulary consumed by the Security-IR scanner.
 *
 * These lists are intentionally explicit instead of being mapped from the operation-kind arrays:
 * the provenance gate compares the two authoritative vocabularies and fails when either side grows
 * without a reviewed relation row (SPEC §2 and §6.6).
 */
export const browserBaseProvenanceStates = [
  'dom',
  'event',
  'form',
  'local',
  'raw-browser',
  'state',
  'unknown',
  'unknown-authority',
] as const;

export const browserOperationProvenanceStates = [
  'operation:browser.dialog.close',
  'operation:browser.dialog.open',
  'operation:browser.dom.focus',
  'operation:browser.event.control',
  'operation:browser.event.read',
  'operation:browser.form.reset',
  'operation:browser.form.submit',
  'operation:browser.framework.call',
  'operation:browser.state.read',
  'operation:browser.state.write',
  'operation:browser.timer.cancel',
  'operation:browser.timer.schedule',
] as const satisfies readonly `operation:${BrowserSecurityOperationKind}`[];

export type BrowserValueProvenance =
  | (typeof browserBaseProvenanceStates)[number]
  | `operation:${BrowserSecurityOperationKind}`;

export const browserValueProvenanceStates: readonly BrowserValueProvenance[] = [
  ...browserBaseProvenanceStates,
  ...browserOperationProvenanceStates,
];

export const serverBaseProvenanceStates = [
  'context',
  'database',
  'database-read-namespace',
  'database-relational-query-namespace',
  'database-relational-table-namespace',
  'database-table-namespace',
  'database-write-namespace',
  'headers',
  'global-object',
  'foreign-executable',
  'intrinsic-identity-call',
  'intrinsic-object',
  'local',
  'respond',
  'request',
  'response-constructor',
  'response-outcome',
  'safe-call',
  'scoped-key-call',
  'scope-call',
  'storage',
  'unknown-authority',
] as const;

export const serverOperationProvenanceStates = [
  'operation:server.authority.scope',
  'operation:server.database.read',
  'operation:server.database.trusted-sql',
  'operation:server.database.write',
  'operation:server.egress.request',
  'operation:server.handler.root',
  'operation:server.helper.call',
  'operation:server.output.trusted-html',
  'operation:server.response.cookie',
  'operation:server.response.header',
  'operation:server.response.outcome',
  'operation:server.response.raw',
  'operation:server.response.redirect',
  'operation:server.storage.read',
  'operation:server.storage.write',
  'operation:server.task.compose',
] as const satisfies readonly `operation:${ServerSecurityOperationKind}`[];

export type ServerValueProvenance =
  | (typeof serverBaseProvenanceStates)[number]
  | `operation:${ServerSecurityOperationKind}`;
type ServerOperationProvenance = `operation:${ServerSecurityOperationKind}`;

export const serverValueProvenanceStates: readonly ServerValueProvenance[] = [
  ...serverBaseProvenanceStates,
  ...serverOperationProvenanceStates,
];

export const securitySemanticBudgets = {
  callDepth: 16,
  nodes: 50_000,
  operations: 4_096,
  summaries: 256,
} as const satisfies SecuritySemanticBudgets;

const securitySemanticClosedReasonMembership = {
  'budget-call-depth': true,
  'budget-node-count': true,
  'budget-operation-count': true,
  'budget-summary-count': true,
  'helper-cycle': true,
  'opaque-transfer': true,
  'unknown-operation': true,
  'unsupported-authority-use': true,
} as const satisfies Record<SecuritySemanticClosedReason, true>;

export const securitySemanticClosedReasons = Object.keys(
  securitySemanticClosedReasonMembership,
) as SecuritySemanticClosedReason[];

/**
 * Exact arm census for `serverExpressionProvenance`.
 *
 * The five core arms are compositional over child provenance values. Identifier lookup is a leaf,
 * the object-literal protocol check inspects syntax, and the two fallthrough containment walks are
 * deliberately represented by one nondeterministic oracle edge. The relation therefore decides
 * the compositional/member-projection fragment only; it does not claim to decide general JavaScript.
 */
export const serverExpressionProvenanceArmCensus = {
  compositionalCore: [
    'new-expression',
    'call-expression',
    'binary-expression',
    'conditional-expression',
    'static-member',
  ],
  leaf: ['identifier-environment-lookup'],
  nondeterministicOracle: {
    id: 'fallthrough-containment-oracle',
    implementationWalks: ['foreign-executable-containment', 'authority-containment'],
    outcomes: ['local', 'foreign-executable', 'unknown-authority'],
  },
  syntaxDependent: ['object-literal-implicit-protocol-shape'],
} as const;

export const provenanceDomainHonesty = {
  decidedDomain:
    'finite server member projection plus the five compositional expression arms over declared provenance values',
  excludedJavaScriptSemantics: [
    'general heap aliasing and mutation',
    'dynamic property names and Proxy traps',
    'imported or otherwise opaque executable behavior',
    'implicit object protocols outside the explicit shape check',
  ],
  extractionGaps: [
    'identifier leaves depend on the scanner-owned immutable alias environment',
    'object-literal implicit protocols remain a syntax predicate',
    'fallthrough subtree containment remains one named nondeterministic oracle edge',
    'browser provenance is censused here but its syntax-dependent transfer relation is not claimed decidable by this table',
  ],
  planSnapshotDrift:
    'the current compiler has 38 server states, not the earlier 37-state snapshot, because scoped-key-call is now an explicit finite state',
} as const;

/** Static names whose behavior is not represented solely by the two DB-operation predicates. */
export const serverLiteralMembers = [
  'Response',
  'actAs',
  'all',
  'append',
  'cancel',
  'count',
  'db',
  'declareSystemRead',
  'declareSystemWrite',
  'delete',
  'entries',
  'error',
  'fail',
  'fetch',
  'file',
  'findFirst',
  'findMany',
  'forwardSetCookie',
  'freeze',
  'get',
  'has',
  'header',
  'headers',
  'invalidate',
  'json',
  'keys',
  'preventExtensions',
  'put',
  'query',
  'read',
  'readonlyAppDb',
  'recordChange',
  'redirect',
  'request',
  'respond',
  'runMutation',
  'runQuery',
  'schedule',
  'seal',
  'set',
  'setCookie',
  'setSessionRevocationClearSiteData',
  'signUrl',
  'stateKey',
  'stat',
  'storage',
  'storedFile',
  'stream',
  'systemStateKey',
  'tx',
  'values',
  'write',
] as const;

export type ServerLiteralMember = (typeof serverLiteralMembers)[number];
export type ServerMemberClass =
  | `literal:${ServerLiteralMember}`
  | 'database-read-operation'
  | 'database-write-operation'
  | 'raw-database-capability'
  | 'other';

const databaseReadOperationMembers = [
  'count',
  'findFirst',
  'findMany',
  'read',
  'select',
  'get',
  'all',
  'values',
  'rawRead',
] as const;
const databaseWriteOperationMembers = [
  'batch',
  'delete',
  'execute',
  'insert',
  'put',
  'run',
  'transaction',
  'update',
  'write',
] as const;
const rawDatabaseCapabilityMembers = ['$client', 'client', 'pglite', 'session', 'sqlite'] as const;

const serverLiteralMemberSet = new Set<string>(serverLiteralMembers);
const databaseReadOperationMemberSet = new Set<string>(databaseReadOperationMembers);
const databaseWriteOperationMemberSet = new Set<string>(databaseWriteOperationMembers);
const rawDatabaseCapabilityMemberSet = new Set<string>(rawDatabaseCapabilityMembers);

export interface ServerMemberClassDefinition {
  readonly effectiveMembers?: readonly string[];
  readonly id: ServerMemberClass;
  readonly kind: 'literal' | 'other' | 'predicate-domain';
  readonly predicateMembers?: readonly string[];
  readonly representative: string;
}

export const serverMemberClassDefinitions: readonly ServerMemberClassDefinition[] = [
  ...serverLiteralMembers.map(
    (member): ServerMemberClassDefinition => ({
      id: `literal:${member}`,
      kind: 'literal',
      representative: member,
    }),
  ),
  {
    effectiveMembers: databaseReadOperationMembers.filter(
      (member) => !serverLiteralMemberSet.has(member),
    ),
    id: 'database-read-operation',
    kind: 'predicate-domain',
    predicateMembers: databaseReadOperationMembers,
    representative: 'select',
  },
  {
    effectiveMembers: databaseWriteOperationMembers.filter(
      (member) => !serverLiteralMemberSet.has(member),
    ),
    id: 'database-write-operation',
    kind: 'predicate-domain',
    predicateMembers: databaseWriteOperationMembers,
    representative: 'execute',
  },
  {
    effectiveMembers: rawDatabaseCapabilityMembers,
    id: 'raw-database-capability',
    kind: 'predicate-domain',
    predicateMembers: rawDatabaseCapabilityMembers,
    representative: '$client',
  },
  { id: 'other', kind: 'other', representative: '__kovo_other_member__' },
];

export const serverMemberClasses: readonly ServerMemberClass[] = serverMemberClassDefinitions.map(
  ({ id }) => id,
);

export function classifyServerMember(member: string): ServerMemberClass {
  if (serverLiteralMemberSet.has(member)) return `literal:${member as ServerLiteralMember}`;
  if (databaseReadOperationMemberSet.has(member)) return 'database-read-operation';
  if (databaseWriteOperationMemberSet.has(member)) return 'database-write-operation';
  if (rawDatabaseCapabilityMemberSet.has(member)) return 'raw-database-capability';
  return 'other';
}

type ServerMemberRule = Readonly<{
  default: ServerValueProvenance;
  overrides?: Readonly<Partial<Record<ServerMemberClass, ServerValueProvenance>>>;
}>;

const literal = (member: ServerLiteralMember): `literal:${ServerLiteralMember}` =>
  `literal:${member}`;
const operation = (kind: ServerSecurityOperationKind): `operation:${ServerSecurityOperationKind}` =>
  `operation:${kind}`;

/** C9 owner relation for every server operation sink/control edge in this finite domain. */
export const serverOperationDoorRelation = {
  'server.authority.scope': 'principal-scope',
  'server.database.read': 'managed-db',
  'server.database.trusted-sql': 'trustedSql',
  'server.database.write': 'managed-db',
  'server.egress.request': 'ctx.fetch',
  'server.handler.root': 'handler-root',
  'server.helper.call': 'local-call-edge',
  'server.output.trusted-html': 'trustedHtml',
  'server.response.cookie': 'context.setCookie',
  'server.response.header': 'structured-headers',
  'server.response.outcome': 'respond.*',
  'server.response.raw': 'Response',
  'server.response.redirect': 'redirect',
  'server.storage.read': 'framework-storage',
  'server.storage.write': 'framework-storage',
  'server.task.compose': 'task-context',
} as const satisfies Record<ServerSecurityOperationKind, SecurityOperationDoor>;

const serverBaseMemberRules = {
  context: {
    default: 'unknown-authority',
    overrides: {
      [literal('actAs')]: 'scope-call',
      [literal('db')]: 'database',
      [literal('declareSystemRead')]: 'scope-call',
      [literal('declareSystemWrite')]: 'scope-call',
      [literal('fail')]: operation('server.response.outcome'),
      [literal('fetch')]: operation('server.egress.request'),
      [literal('forwardSetCookie')]: operation('server.response.cookie'),
      [literal('header')]: 'safe-call',
      [literal('headers')]: 'headers',
      [literal('invalidate')]: operation('server.task.compose'),
      [literal('readonlyAppDb')]: 'database',
      [literal('recordChange')]: operation('server.task.compose'),
      [literal('request')]: 'request',
      [literal('respond')]: 'respond',
      [literal('runMutation')]: operation('server.task.compose'),
      [literal('runQuery')]: operation('server.task.compose'),
      [literal('schedule')]: operation('server.task.compose'),
      [literal('setCookie')]: operation('server.response.cookie'),
      [literal('setSessionRevocationClearSiteData')]: operation('server.response.cookie'),
      [literal('signUrl')]: operation('server.storage.read'),
      [literal('stateKey')]: 'scoped-key-call',
      [literal('storage')]: 'storage',
      [literal('systemStateKey')]: 'scoped-key-call',
      [literal('tx')]: 'database',
    },
  },
  database: {
    default: 'database-table-namespace',
    overrides: {
      [literal('all')]: operation('server.database.read'),
      [literal('count')]: operation('server.database.read'),
      [literal('delete')]: operation('server.database.write'),
      [literal('findFirst')]: operation('server.database.read'),
      [literal('findMany')]: operation('server.database.read'),
      [literal('get')]: operation('server.database.read'),
      [literal('put')]: operation('server.database.write'),
      [literal('query')]: 'database-relational-query-namespace',
      [literal('read')]: 'database-read-namespace',
      [literal('values')]: operation('server.database.read'),
      [literal('write')]: 'database-write-namespace',
      'database-read-operation': operation('server.database.read'),
      'database-write-operation': operation('server.database.write'),
      'raw-database-capability': 'unknown-authority',
    },
  },
  'database-read-namespace': {
    default: 'unknown-authority',
    overrides: {
      [literal('all')]: operation('server.database.read'),
      [literal('count')]: operation('server.database.read'),
      [literal('findFirst')]: operation('server.database.read'),
      [literal('findMany')]: operation('server.database.read'),
      [literal('get')]: operation('server.database.read'),
      [literal('query')]: 'database-relational-query-namespace',
      [literal('read')]: operation('server.database.read'),
      [literal('values')]: operation('server.database.read'),
      'database-read-operation': operation('server.database.read'),
    },
  },
  'database-relational-query-namespace': {
    default: 'database-relational-table-namespace',
  },
  'database-relational-table-namespace': {
    default: 'unknown-authority',
    overrides: {
      [literal('findFirst')]: operation('server.database.read'),
      [literal('findMany')]: operation('server.database.read'),
    },
  },
  'database-table-namespace': {
    default: 'unknown-authority',
    overrides: {
      [literal('all')]: operation('server.database.read'),
      [literal('count')]: operation('server.database.read'),
      [literal('get')]: operation('server.database.read'),
      [literal('values')]: operation('server.database.read'),
    },
  },
  'database-write-namespace': {
    default: 'unknown-authority',
    overrides: {
      [literal('delete')]: operation('server.database.write'),
      [literal('put')]: operation('server.database.write'),
      [literal('write')]: operation('server.database.write'),
      'database-write-operation': operation('server.database.write'),
    },
  },
  'foreign-executable': { default: 'foreign-executable' },
  'global-object': {
    default: 'unknown-authority',
    overrides: { [literal('Response')]: 'response-constructor' },
  },
  headers: {
    default: 'unknown-authority',
    overrides: {
      [literal('append')]: operation('server.response.header'),
      [literal('delete')]: operation('server.response.header'),
      [literal('entries')]: 'safe-call',
      [literal('get')]: 'safe-call',
      [literal('has')]: 'safe-call',
      [literal('keys')]: 'safe-call',
      [literal('set')]: operation('server.response.header'),
    },
  },
  'intrinsic-identity-call': { default: 'local' },
  'intrinsic-object': {
    default: 'local',
    overrides: {
      [literal('freeze')]: 'intrinsic-identity-call',
      [literal('preventExtensions')]: 'intrinsic-identity-call',
      [literal('seal')]: 'intrinsic-identity-call',
    },
  },
  local: { default: 'local' },
  request: {
    default: 'local',
    overrides: {
      [literal('cancel')]: operation('server.task.compose'),
      [literal('db')]: 'database',
      [literal('readonlyAppDb')]: 'database',
      [literal('schedule')]: operation('server.task.compose'),
      [literal('tx')]: 'database',
    },
  },
  respond: {
    default: 'unknown-authority',
    overrides: {
      [literal('file')]: operation('server.response.outcome'),
      [literal('storedFile')]: operation('server.response.outcome'),
      [literal('stream')]: operation('server.response.outcome'),
    },
  },
  'response-constructor': {
    default: 'unknown-authority',
    overrides: {
      [literal('error')]: operation('server.response.raw'),
      [literal('json')]: operation('server.response.raw'),
      [literal('redirect')]: operation('server.response.raw'),
    },
  },
  'response-outcome': { default: 'unknown-authority' },
  'safe-call': { default: 'local' },
  'scope-call': { default: 'local' },
  'scoped-key-call': { default: 'local' },
  storage: {
    default: 'unknown-authority',
    overrides: {
      [literal('delete')]: operation('server.storage.write'),
      [literal('get')]: operation('server.storage.read'),
      [literal('put')]: operation('server.storage.write'),
      [literal('stat')]: operation('server.storage.read'),
      [literal('stream')]: operation('server.storage.read'),
    },
  },
  'unknown-authority': { default: 'unknown-authority' },
} as const satisfies Record<(typeof serverBaseProvenanceStates)[number], ServerMemberRule>;

function expandServerMemberRule(
  rule: ServerMemberRule,
): Record<ServerMemberClass, ServerValueProvenance> {
  const row = {} as Record<ServerMemberClass, ServerValueProvenance>;
  for (const memberClass of serverMemberClasses) {
    row[memberClass] = rule.overrides?.[memberClass] ?? rule.default;
  }
  return row;
}

export const serverMemberProvenanceTable = Object.fromEntries(
  serverValueProvenanceStates.map((state) => {
    const rule = isServerOperationProvenance(state)
      ? ({ default: 'unknown-authority' } satisfies ServerMemberRule)
      : serverBaseMemberRules[state];
    return [state, expandServerMemberRule(rule)];
  }),
) as Readonly<
  Record<ServerValueProvenance, Readonly<Record<ServerMemberClass, ServerValueProvenance>>>
>;

export function serverMemberProvenanceFromRelation(
  receiver: ServerValueProvenance,
  member: string,
): ServerValueProvenance {
  return serverMemberProvenanceTable[receiver][classifyServerMember(member)];
}

const serverBaseAuthorityRelation = {
  context: true,
  database: true,
  'database-read-namespace': true,
  'database-relational-query-namespace': true,
  'database-relational-table-namespace': true,
  'database-table-namespace': true,
  'database-write-namespace': true,
  'foreign-executable': false,
  'global-object': true,
  headers: true,
  'intrinsic-identity-call': false,
  'intrinsic-object': false,
  local: false,
  request: true,
  respond: true,
  'response-constructor': true,
  'response-outcome': true,
  'safe-call': false,
  'scope-call': true,
  'scoped-key-call': true,
  storage: true,
  'unknown-authority': true,
} as const satisfies Record<(typeof serverBaseProvenanceStates)[number], boolean>;

export const serverAuthorityTop = 'unknown-authority' as const;

export const serverAuthorityRelation = Object.fromEntries(
  serverValueProvenanceStates.map((state) => [
    state,
    isServerOperationProvenance(state) ? true : serverBaseAuthorityRelation[state],
  ]),
) as Readonly<Record<ServerValueProvenance, boolean>>;

export const serverAuthorityStates = serverValueProvenanceStates.filter(
  (state) => serverAuthorityRelation[state],
);

export function serverProvenanceAtOrBelowAuthorityTop(provenance: string | undefined): boolean {
  if (provenance === undefined) return false;
  // Unknown future states fail closed as authority-bearing until their explicit relation row lands.
  return serverAuthorityRelation[provenance as ServerValueProvenance] ?? true;
}

const browserNonAuthorityStates = new Set<BrowserValueProvenance>(['local', 'unknown']);
export const browserAuthorityStates = browserValueProvenanceStates.filter(
  (state) => !browserNonAuthorityStates.has(state),
);

export interface ProvenanceReachabilityRow {
  readonly from: ServerValueProvenance;
  readonly path: readonly ServerMemberClass[];
  readonly to: ServerValueProvenance;
}

export function provenanceReachability(
  table: Readonly<
    Record<ServerValueProvenance, Readonly<Record<ServerMemberClass, ServerValueProvenance>>>
  > = serverMemberProvenanceTable,
): ProvenanceReachabilityRow[] {
  const rows: ProvenanceReachabilityRow[] = [];
  for (const start of serverAuthorityStates) {
    const queue: Array<{ path: ServerMemberClass[]; state: ServerValueProvenance }> = [
      { path: [], state: start },
    ];
    const visited = new Set<ServerValueProvenance>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.state)) continue;
      visited.add(current.state);
      rows.push({ from: start, path: current.path, to: current.state });
      for (const memberClass of serverMemberClasses) {
        const target = table[current.state]?.[memberClass];
        if (target !== undefined && !visited.has(target)) {
          queue.push({ path: [...current.path, memberClass], state: target });
        }
      }
    }
  }
  return rows;
}

export interface ProvenanceClosureCounterexample {
  readonly detail: string;
  readonly from: ServerValueProvenance;
  readonly path: readonly ServerMemberClass[];
  readonly to: string;
}

export function provenanceClosureCounterexamples(options?: {
  readonly doorForOperation?: (
    kind: ServerSecurityOperationKind,
  ) => SecurityOperationDoor | undefined;
  readonly table?: Readonly<
    Record<ServerValueProvenance, Readonly<Record<ServerMemberClass, ServerValueProvenance>>>
  >;
}): ProvenanceClosureCounterexample[] {
  const table = options?.table ?? serverMemberProvenanceTable;
  const doorForOperation =
    options?.doorForOperation ?? ((kind) => serverOperationDoorRelation[kind]);
  const counterexamples: ProvenanceClosureCounterexample[] = [];
  const knownStates = new Set<string>(serverValueProvenanceStates);

  for (const row of provenanceReachability(table)) {
    if (!knownStates.has(row.to)) {
      counterexamples.push({
        detail: 'member transition reached an undeclared provenance state',
        from: row.from,
        path: row.path,
        to: row.to,
      });
      continue;
    }
    if (row.to === serverAuthorityTop) {
      if (securitySemanticClosedReasons.length !== 8) {
        counterexamples.push({
          detail: 'unknown-authority does not close under exactly eight declared reasons',
          from: row.from,
          path: row.path,
          to: row.to,
        });
      }
      continue;
    }
    if (!row.to.startsWith('operation:')) continue;
    const kind = row.to.slice('operation:'.length) as ServerSecurityOperationKind;
    const door = doorForOperation(kind);
    if (door === undefined || door.length === 0) {
      counterexamples.push({
        detail: `operation ${kind} has no enrolled C9 door owner`,
        from: row.from,
        path: row.path,
        to: row.to,
      });
    }
  }

  return counterexamples;
}

export function assertProvenanceRelationIsTotal(): void {
  assertUniqueStrings(browserValueProvenanceStates, 'browser provenance states');
  assertUniqueStrings(serverValueProvenanceStates, 'server provenance states');
  assertUniqueStrings(serverMemberClasses, 'server member classes');
  for (const definition of serverMemberClassDefinitions) {
    if (definition.predicateMembers) {
      assertUniqueStrings(definition.predicateMembers, `${definition.id} predicate members`);
    }
    if (definition.effectiveMembers) {
      assertUniqueStrings(definition.effectiveMembers, `${definition.id} effective members`);
    }
  }
  for (const state of serverValueProvenanceStates) {
    const row = serverMemberProvenanceTable[state];
    if (!row) throw new Error(`provenance relation has no row for ${state}`);
    assertExactStringSet(Object.keys(row), serverMemberClasses, `member classes for ${state}`);
    for (const memberClass of serverMemberClasses) {
      if (!serverValueProvenanceStates.includes(row[memberClass])) {
        throw new Error(
          `provenance relation target is undeclared: ${state} × ${memberClass} -> ${row[memberClass]}`,
        );
      }
    }
  }
  assertExactStringSet(
    Object.keys(serverAuthorityRelation),
    serverValueProvenanceStates,
    'server authority relation states',
  );
}

function assertExactStringSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const compare = (left: string, right: string): number => left.localeCompare(right);
  const actualSorted = [...actual].sort(compare);
  const expectedSorted = [...expected].sort(compare);
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `${label} differ: actual=${JSON.stringify(actualSorted)} expected=${JSON.stringify(expectedSorted)}`,
    );
  }
}

function assertUniqueStrings(values: readonly string[], label: string): void {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`${label} contain duplicate entries`);
  }
}

function isServerOperationProvenance(
  state: ServerValueProvenance,
): state is ServerOperationProvenance {
  return state.startsWith('operation:');
}
