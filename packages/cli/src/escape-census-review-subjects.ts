import {
  ESCAPE_CENSUS_DOORS,
  type KovoCheckInput,
  type TrustEscapeExplain,
} from '@kovojs/core/internal/graph';
import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import {
  snapshotEscapeCensusReviewSubject,
  type EscapeCensusReviewSite,
  type EscapeCensusReviewSubject,
} from '@kovojs/server/internal/execution';

const trustKindToDoor = {
  allowControlChars: 'allowControlChars',
  csrfFalse: 'csrf:false',
  kovoAnalyzerSummary: 'kovoAnalyzerSummary',
  trustedHtml: 'trustedHtml',
  trustedSql: 'trustedSql',
} as const;

const knownTrustEscapeKinds = {
  allowControlChars: true,
  csrfFalse: true,
  customVerifier: true,
  kovoAnalyzerSummary: true,
  rawEndpoint: true,
  staticExportPathOverride: true,
  trustedHtml: true,
  trustedSql: true,
  trustedUrl: true,
  webhookVerifyNone: true,
} satisfies Readonly<Record<TrustEscapeExplain['kind'], true>>;

const expectedSources = {
  allowControlChars: 'trustEscapes',
  'csrf:false': 'trustEscapes',
  'ctx.fetch': 'securitySemanticGraph',
  kovoAnalyzerSummary: 'trustEscapes',
  trustedHtml: 'trustEscapes',
  trustedSql: 'trustEscapes',
} as const;

const knownSemanticDoors = new Set([
  'Response',
  'compiler-dom-focus',
  'compiler-form',
  'compiler-state',
  'context.setCookie',
  'ctx.fetch',
  'delegated-event',
  'framework-storage',
  'framework-timer',
  'handler-root',
  'local-call-edge',
  'managed-db',
  'platform-invoker',
  'principal-scope',
  'redirect',
  'respond.*',
  'reviewed-client-export',
  'structured-headers',
  'task-context',
  'trustedHtml',
  'trustedSql',
]);
const semanticBudgetKeys = ['callDepth', 'nodes', 'operations', 'summaries'] as const;
const semanticClosedReasons = new Set([
  'budget-call-depth',
  'budget-node-count',
  'budget-operation-count',
  'budget-summary-count',
  'helper-cycle',
  'opaque-transfer',
  'unknown-operation',
  'unsupported-authority-use',
]);

/** @internal Unsigned, artifact-bound review input emitted for every root counted by Metric E. */
export interface EscapeCensusReviewManifest {
  readonly artifactSubject: `sha256:${string}`;
  readonly schema: 'kovo.escape-census-review-subjects/v1';
  readonly subjects: readonly EscapeCensusReviewSubject[];
}

/** @internal Derive one unsigned review subject per exact root counted by Metric E. */
export function escapeCensusReviewManifestForBuild(
  graph: KovoCheckInput,
): EscapeCensusReviewManifest {
  const artifactSubject = graph.runtimePosture?.artifactSubject;
  if (typeof artifactSubject !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(artifactSubject)) {
    throw new TypeError('Escape-census review emission requires the build-owned artifact subject.');
  }
  const analyzedAppSources = exactAnalyzedAppSources(graph.analysisInputs);
  const executableCsrfRoots = exactExecutableCsrfRoots(graph.mutations);
  const coverage = graph.escapeCensus;
  if (
    coverage?.schema !== 'kovo.escape-census-coverage/v2' ||
    !Array.isArray(coverage.doors) ||
    coverage.doors.length !== ESCAPE_CENSUS_DOORS.length ||
    coverage.doors.some((door, index) => door !== ESCAPE_CENSUS_DOORS[index]) ||
    typeof coverage.sources !== 'object' ||
    coverage.sources === null ||
    Array.isArray(coverage.sources) ||
    Object.keys(coverage.sources).length !== ESCAPE_CENSUS_DOORS.length ||
    ESCAPE_CENSUS_DOORS.some((door) => coverage.sources[door] !== expectedSources[door])
  ) {
    throw new TypeError(
      'Escape-census review emission requires the exact closed producer-coverage witness.',
    );
  }

  const roots = new Map<
    string,
    {
      door: EscapeCensusReviewSubject['door'];
      root: string;
      sites: Map<string, EscapeCensusReviewSite>;
    }
  >();
  const csrfSitesByCountedRoot = new Map<string, Map<string, EscapeCensusReviewSite>>();
  const observedTrustRoots = new Map<
    string,
    Map<string, { readonly sliceHash: string; readonly sourceHash: string }>
  >();
  const observedTrustBindings = new Map<string, string>();
  const addRoot = (
    door: EscapeCensusReviewSubject['door'],
    root: string | undefined,
    site: EscapeCensusReviewSite | undefined,
  ): void => {
    if (typeof root !== 'string' || root.trim() === '' || site === undefined) {
      throw new TypeError(`Escape-census review ${door} producer lacks an exact root or site.`);
    }
    const key = `${door}\u0000${root}`;
    let entry = roots.get(key);
    if (entry === undefined) {
      entry = { door, root, sites: new Map() };
      roots.set(key, entry);
    }
    entry.sites.set(canonicalJsonStringify(site), site);
  };

  if (!Array.isArray(graph.trustEscapes)) {
    throw new TypeError(
      'Escape-census review emission requires the authoritative trustEscapes array.',
    );
  }
  for (const [index, escape] of graph.trustEscapes.entries()) {
    if (
      typeof escape !== 'object' ||
      escape === null ||
      Array.isArray(escape) ||
      typeof escape.kind !== 'string' ||
      !Object.hasOwn(knownTrustEscapeKinds, escape.kind) ||
      typeof escape.site !== 'string' ||
      escape.site.trim() === ''
    ) {
      throw new TypeError(`Escape-census review trustEscapes[${index}] is malformed.`);
    }
    const door = trustKindToDoor[escape.kind as keyof typeof trustKindToDoor];
    const boundSite = exactTrustEscapeSite(escape, index, analyzedAppSources);
    const bindingKey = `${escape.kind}\u0000${boundSite.file}\u0000${boundSite.span.start}\u0000${boundSite.span.end}`;
    const bindingIdentity = `${escape.sourceBinding.sourceHash}\u0000${escape.sourceBinding.sliceHash}\u0000${escape.site}\u0000${escape.root ?? ''}`;
    const previousBinding = observedTrustBindings.get(bindingKey);
    if (previousBinding !== undefined && previousBinding !== bindingIdentity) {
      throw new TypeError(
        `Escape-census review trustEscapes[${index}] conflicts with an existing exact source binding.`,
      );
    }
    observedTrustBindings.set(bindingKey, bindingIdentity);
    if (
      (escape.kind === 'trustedHtml' || escape.kind === 'trustedSql') &&
      typeof escape.root === 'string'
    ) {
      const roots = observedTrustRoots.get(escape.kind) ?? new Map();
      const previous = roots.get(escape.root);
      const exactBinding = {
        sliceHash: escape.sourceBinding.sliceHash,
        sourceHash: escape.sourceBinding.sourceHash,
      };
      if (
        previous !== undefined &&
        (previous.sliceHash !== exactBinding.sliceHash ||
          previous.sourceHash !== exactBinding.sourceHash)
      ) {
        throw new TypeError(
          `Escape-census review trustEscapes[${index}] conflicts with the exact binding for ${escape.root}.`,
        );
      }
      roots.set(escape.root, exactBinding);
      observedTrustRoots.set(escape.kind, roots);
    }
    if (door === 'csrf:false') {
      if (
        typeof escape.root !== 'string' ||
        escape.root.trim() === '' ||
        typeof escape.site !== 'string' ||
        escape.site.trim() === ''
      ) {
        throw new TypeError(
          'Escape-census review csrf:false producer lacks an exact root or site.',
        );
      }
      const expectedCountedRoot = exactCountedCsrfRoot(escape, executableCsrfRoots);
      if (escape.countedRootDisposition === 'linked') {
        if (expectedCountedRoot === undefined || escape.countedRoot !== expectedCountedRoot) {
          throw new TypeError(
            'Escape-census review linked csrf:false producer has the wrong exact counted root.',
          );
        }
        const sites =
          csrfSitesByCountedRoot.get(escape.countedRoot) ??
          new Map<string, EscapeCensusReviewSite>();
        sites.set(canonicalJsonStringify(boundSite), boundSite);
        csrfSitesByCountedRoot.set(escape.countedRoot, sites);
      } else if (escape.countedRootDisposition === 'proven-unreachable') {
        if (escape.countedRoot !== undefined || expectedCountedRoot !== undefined) {
          throw new TypeError(
            'Escape-census review unreachable csrf:false producer carries a counted root.',
          );
        }
      } else {
        throw new TypeError(
          'Escape-census review csrf:false producer lacks a closed counted-root disposition.',
        );
      }
    } else if (door !== undefined) {
      addRoot(door, escape.root, boundSite);
    }
  }
  if (!Array.isArray(graph.components)) {
    throw new TypeError(
      'Escape-census review emission requires the authoritative components array.',
    );
  }
  for (const [componentIndex, component] of graph.components.entries()) {
    if (
      typeof component !== 'object' ||
      component === null ||
      Array.isArray(component) ||
      typeof component.name !== 'string' ||
      component.name.trim() === ''
    ) {
      throw new TypeError(`Escape-census review components[${componentIndex}] is malformed.`);
    }
    const handlerRoots = new Set<string>();
    if (
      component.securityOperations !== undefined &&
      !Array.isArray(component.securityOperations)
    ) {
      throw new TypeError(
        `Escape-census review components[${componentIndex}].securityOperations is malformed.`,
      );
    }
    for (const [operationIndex, operation] of (component.securityOperations ?? []).entries()) {
      if (!record(operation) || operation.kind !== 'server.handler.root') continue;
      const handlerRoot = exactAuditText(
        operation.target,
        `Escape-census review components[${componentIndex}].securityOperations[${operationIndex}].target`,
      );
      if (handlerRoots.has(handlerRoot)) {
        throw new TypeError(
          `Escape-census review components[${componentIndex}] has duplicate handler root ${handlerRoot}.`,
        );
      }
      handlerRoots.add(handlerRoot);
    }
    const semantic = component.securitySemanticGraph;
    if (semantic === undefined) {
      if (handlerRoots.size > 0) {
        throw new TypeError(
          `Escape-census review components[${componentIndex}] has handler roots without a semantic graph.`,
        );
      }
      continue;
    }
    if (
      typeof semantic !== 'object' ||
      semantic === null ||
      Array.isArray(semantic) ||
      semantic.schema !== 'kovo-security-semantic-graph/v3' ||
      typeof semantic.sourceFile !== 'string' ||
      !exactRelativeAnalysisPath(semantic.sourceFile) ||
      !Array.isArray(semantic.roots) ||
      !record(semantic.budgets) ||
      Object.keys(semantic.budgets).length !== semanticBudgetKeys.length ||
      semanticBudgetKeys.some(
        (key) =>
          !Number.isSafeInteger(semantic.budgets[key]) || (semantic.budgets[key] as number) < 0,
      )
    ) {
      throw new TypeError(
        `Escape-census review components[${componentIndex}].securitySemanticGraph is malformed.`,
      );
    }
    const semanticRoots = new Set<string>();
    for (const [rootIndex, root] of semantic.roots.entries()) {
      if (
        typeof root !== 'object' ||
        root === null ||
        Array.isArray(root) ||
        typeof root.root !== 'string' ||
        root.root.trim() === '' ||
        !Array.isArray(root.traces) ||
        typeof root.binding !== 'object' ||
        root.binding === null ||
        Array.isArray(root.binding) ||
        typeof root.binding.factory !== 'string' ||
        root.binding.root !== root.root ||
        typeof root.binding.factoryCallSpan !== 'object' ||
        root.binding.factoryCallSpan === null ||
        typeof root.binding.factoryCallSpan.start !== 'number' ||
        typeof root.binding.factoryCallSpan.end !== 'number'
      ) {
        throw new TypeError(
          `Escape-census review components[${componentIndex}].roots[${rootIndex}] is malformed.`,
        );
      }
      if (semanticRoots.has(root.root)) {
        throw new TypeError(
          `Escape-census review components[${componentIndex}] has duplicate semantic root ${root.root}.`,
        );
      }
      semanticRoots.add(root.root);
      const ctxFetchSites = new Set<string>();
      for (const [traceIndex, trace] of (root.traces as readonly unknown[]).entries()) {
        if (
          !record(trace) ||
          (trace.verdict !== 'proved' && trace.verdict !== 'closed') ||
          trace.root !== root.root ||
          !Array.isArray(trace.transfers) ||
          trace.transfers.some((transfer) => typeof transfer !== 'string' || transfer.trim() === '')
        ) {
          throw new TypeError(
            `Escape-census review components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] is malformed.`,
          );
        }
        if (trace.verdict === 'proved') {
          if (
            !record(trace.sink) ||
            typeof trace.sink.door !== 'string' ||
            !knownSemanticDoors.has(trace.sink.door) ||
            !exactSha256Digest(trace.sink.sliceHash) ||
            !record(trace.sink.span) ||
            !Number.isSafeInteger(trace.sink.span.start) ||
            !Number.isSafeInteger(trace.sink.span.end) ||
            (trace.sink.span.start as number) < 0 ||
            (trace.sink.span.end as number) <= (trace.sink.span.start as number)
          ) {
            throw new TypeError(
              `Escape-census review components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] lacks a proved sink.`,
            );
          }
          if (trace.sink.door === 'ctx.fetch') {
            const sourceFile = semantic.sourceFile;
            const source =
              typeof sourceFile === 'string' ? analyzedAppSources.get(sourceFile) : undefined;
            if (
              typeof sourceFile !== 'string' ||
              !exactRelativeAnalysisPath(sourceFile) ||
              source === undefined ||
              (trace.sink.span.end as number) > source.codeUnitLength
            ) {
              throw new TypeError(
                `Escape-census review components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] lacks its exact analyzed source.`,
              );
            }
            ctxFetchSites.add(
              canonicalJsonStringify({
                encoding: 'utf16le',
                file: sourceFile,
                sliceHash: trace.sink.sliceHash,
                sourceHash: source.contentHash,
                sourceLength: source.codeUnitLength,
                span: {
                  end: trace.sink.span.end as number,
                  start: trace.sink.span.start as number,
                },
              } satisfies EscapeCensusReviewSite),
            );
          }
          if (trace.sink.door === 'trustedHtml' || trace.sink.door === 'trustedSql') {
            const sourceFile = semantic.sourceFile;
            const source =
              typeof sourceFile === 'string' ? analyzedAppSources.get(sourceFile) : undefined;
            const exactRoot =
              typeof sourceFile === 'string'
                ? `${sourceFile}:${String(trace.sink.span.start)}:${String(trace.sink.span.end)}`
                : undefined;
            const exactBinding =
              exactRoot === undefined
                ? undefined
                : observedTrustRoots.get(trace.sink.door)?.get(exactRoot);
            if (
              !exactRelativeAnalysisPath(sourceFile ?? '') ||
              source === undefined ||
              (trace.sink.span.end as number) > source.codeUnitLength ||
              exactRoot === undefined ||
              exactBinding === undefined ||
              exactBinding.sourceHash !== source.contentHash ||
              exactBinding.sliceHash !== trace.sink.sliceHash
            ) {
              throw new TypeError(
                `Escape-census review semantic ${trace.sink.door} reachability lacks its exact trust-escape fact.`,
              );
            }
          }
        } else if (
          typeof trace.reason !== 'string' ||
          !semanticClosedReasons.has(trace.reason) ||
          typeof trace.detail !== 'string' ||
          trace.detail.trim() === ''
        ) {
          throw new TypeError(
            `Escape-census review components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] has an unsupported closed verdict.`,
          );
        }
      }
      for (const site of ctxFetchSites) {
        addRoot('ctx.fetch', root.root, JSON.parse(site) as EscapeCensusReviewSite);
      }
    }
    for (const handlerRoot of handlerRoots) {
      if (!semanticRoots.has(handlerRoot)) {
        throw new TypeError(
          `Escape-census review component ${component.name} handler root ${handlerRoot} lacks a semantic root.`,
        );
      }
    }
    for (const semanticRoot of semanticRoots) {
      if (!handlerRoots.has(semanticRoot)) {
        throw new TypeError(
          `Escape-census review component ${component.name} semantic root ${semanticRoot} lacks a handler-root operation.`,
        );
      }
    }
  }

  if (!Array.isArray(graph.mutations)) {
    throw new TypeError(
      'Escape-census review emission requires the authoritative mutations array.',
    );
  }
  for (const [mutationIndex, mutation] of graph.mutations.entries()) {
    if (!record(mutation)) {
      throw new TypeError(`Escape-census review mutations[${mutationIndex}] is malformed.`);
    }
    if (mutation.csrf !== 'exempt') continue;
    if (typeof mutation.key !== 'string' || mutation.key.trim() === '') {
      throw new TypeError(
        `Escape-census review mutations[${mutationIndex}] lacks an exact registry key.`,
      );
    }
    const countedRoot = `mutation:${mutation.key}`;
    const exactSites = csrfSitesByCountedRoot.get(countedRoot);
    if (exactSites === undefined || exactSites.size === 0) {
      throw new TypeError(
        `Escape-census review csrf-exempt mutation ${mutation.key} lacks its runtime trust root.`,
      );
    }
    // The build analyzer joins source facts to this exact executable root through `countedRoot`.
    // Grouping only that explicit relation preserves complete producer sites without cross-root
    // unions between sibling mutations.
    for (const site of exactSites.values()) addRoot('csrf:false', countedRoot, site);
  }

  const subjects = [...roots.values()]
    .sort((left, right) =>
      left.door === right.door
        ? compareCodeUnits(left.root, right.root)
        : compareCodeUnits(left.door, right.door),
    )
    .map((entry) =>
      snapshotEscapeCensusReviewSubject({
        artifactSubject,
        door: entry.door,
        root: entry.root,
        schema: 'kovo.escape-census-review/v1',
        sites: [...entry.sites.entries()]
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([, site]) => site),
      }),
    );
  return {
    artifactSubject,
    schema: 'kovo.escape-census-review-subjects/v1',
    subjects,
  };
}

function exactExecutableCsrfRoots(value: KovoCheckInput['mutations']): ReadonlySet<string> {
  if (!Array.isArray(value)) {
    throw new TypeError(
      'Escape-census review emission requires the authoritative mutations array.',
    );
  }
  const roots = new Set<string>();
  for (const [index, mutation] of value.entries()) {
    if (!record(mutation)) {
      throw new TypeError(`Escape-census review mutations[${index}] is malformed.`);
    }
    if (mutation.csrf !== 'exempt') continue;
    if (typeof mutation.key !== 'string' || mutation.key.trim() === '') {
      throw new TypeError(`Escape-census review mutations[${index}] lacks an exact registry key.`);
    }
    roots.add(`mutation:${mutation.key}`);
  }
  return roots;
}

function exactCountedCsrfRoot(
  escape: TrustEscapeExplain,
  executableRoots: ReadonlySet<string>,
): string | undefined {
  if (typeof escape.root === 'string' && executableRoots.has(escape.root)) return escape.root;
  if (typeof escape.source !== 'string' || escape.source.trim() === '') return undefined;
  const candidate = `mutation:${derivedRegistryKey(escape.sourceBinding.file, escape.source)}`;
  return executableRoots.has(candidate) ? candidate : undefined;
}

function derivedRegistryKey(file: string, binding: string): string {
  const normalized = file.replace(/\\/gu, '/').replace(/\.[^./]+$/u, '');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  let root = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === 'src') root = index;
    if (
      index <= parts.length - 3 &&
      parts[index] === 'tests' &&
      parts[index + 1] === 'integration' &&
      parts[index + 2] === 'fixtures'
    ) {
      root = index + 2;
      break;
    }
  }
  const namespace = parts
    .slice(root + 1)
    .map(kebabRegistryPart)
    .join('/');
  const leaf = kebabRegistryPart(binding);
  return namespace.length === 0 ? leaf : `${namespace}/${leaf}`;
}

function kebabRegistryPart(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/_/gu, '-')
    .toLowerCase();
}

function exactSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function exactTrustEscapeSite(
  escape: TrustEscapeExplain,
  index: number,
  analyzedAppSources: ReadonlyMap<
    string,
    { readonly codeUnitLength: number; readonly contentHash: `sha256:${string}` }
  >,
): EscapeCensusReviewSite {
  const binding = escape.sourceBinding;
  const exactSourceRoot =
    typeof binding?.file === 'string' && record(binding.span)
      ? `${binding.file}:${String(binding.span.start)}:${String(binding.span.end)}`
      : undefined;
  if (
    !record(binding) ||
    !exactKeys(binding, ['encoding', 'file', 'sliceHash', 'sourceHash', 'span']) ||
    binding.encoding !== 'utf16le' ||
    typeof binding.file !== 'string' ||
    binding.file.trim() === '' ||
    typeof binding.sourceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.sourceHash) ||
    typeof binding.sliceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.sliceHash) ||
    !record(binding.span) ||
    !exactKeys(binding.span, ['end', 'start']) ||
    !Number.isSafeInteger(binding.span.start) ||
    !Number.isSafeInteger(binding.span.end) ||
    (binding.span.start as number) < 0 ||
    (binding.span.end as number) <= (binding.span.start as number) ||
    !exactRelativeAnalysisPath(binding.file) ||
    analyzedAppSources.get(binding.file) === undefined ||
    binding.sourceHash !== analyzedAppSources.get(binding.file)?.contentHash ||
    (binding.span.end as number) >
      (analyzedAppSources.get(binding.file) as { codeUnitLength: number }).codeUnitLength ||
    !escape.site.startsWith(`${binding.file}:`) ||
    !/^[1-9][0-9]*$/u.test(escape.site.slice(binding.file.length + 1)) ||
    (escape.kind !== 'csrfFalse' && escape.root !== exactSourceRoot)
  ) {
    throw new TypeError(
      `Escape-census review trustEscapes[${index}] lacks an exact UTF-16 source binding.`,
    );
  }
  return {
    encoding: 'utf16le',
    file: binding.file,
    sliceHash: binding.sliceHash,
    sourceHash: analyzedAppSources.get(binding.file)!.contentHash,
    sourceLength: analyzedAppSources.get(binding.file)!.codeUnitLength,
    span: { end: binding.span.end, start: binding.span.start },
  };
}

function exactAnalyzedAppSources(
  value: KovoCheckInput['analysisInputs'],
): ReadonlyMap<
  string,
  { readonly codeUnitLength: number; readonly contentHash: `sha256:${string}` }
> {
  if (
    !record(value) ||
    !exactKeys(value, ['runtimeTarget', 'schema', 'sources']) ||
    value.schema !== 'kovo.analysis.inputs/v1' ||
    (value.runtimeTarget !== 'cloudflare' &&
      value.runtimeTarget !== 'node' &&
      value.runtimeTarget !== 'vercel') ||
    !Array.isArray(value.sources)
  ) {
    throw new TypeError(
      'Escape-census review emission requires the exact analyzed-source input manifest.',
    );
  }
  const appSources = new Map<
    string,
    { readonly codeUnitLength: number; readonly contentHash: `sha256:${string}` }
  >();
  let previousKey: string | undefined;
  for (const [index, source] of value.sources.entries()) {
    if (
      !record(source) ||
      !exactKeys(source, ['codeUnitLength', 'contentHash', 'encoding', 'path', 'role']) ||
      !Number.isSafeInteger(source.codeUnitLength) ||
      (source.codeUnitLength as number) < 0 ||
      typeof source.contentHash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(source.contentHash) ||
      source.encoding !== 'utf16le' ||
      typeof source.path !== 'string' ||
      !exactRelativeAnalysisPath(source.path) ||
      (source.role !== 'app' && source.role !== 'client-entry' && source.role !== 'config')
    ) {
      throw new TypeError(`Escape-census review analysisInputs.sources[${index}] is malformed.`);
    }
    const key = `${source.role}\u0000${source.path}`;
    if (previousKey !== undefined && compareCodeUnits(previousKey, key) >= 0) {
      throw new TypeError(
        'Escape-census review analyzed-source inputs must be uniquely code-unit sorted.',
      );
    }
    previousKey = key;
    if (source.role === 'app') {
      appSources.set(source.path, {
        codeUnitLength: source.codeUnitLength as number,
        contentHash: source.contentHash as `sha256:${string}`,
      });
    }
  }
  if (appSources.size === 0) {
    throw new TypeError(
      'Escape-census review emission requires at least one exact analyzed app source.',
    );
  }
  return appSources;
}

function exactRelativeAnalysisPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function exactAuditText(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${label} must be bounded printable text.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      throw new TypeError(`${label} must be bounded printable text.`);
    }
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareCodeUnits);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
