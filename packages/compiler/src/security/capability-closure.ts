import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
} from '@kovojs/core/internal/diagnostics';

import type { CompilerDiagnostic } from '../diagnostics.js';
import { scanCapabilityClosureModules } from '../scan/capability-closure.js';
import type {
  AppDependencyCapability,
  AppDependencyCapabilityImport,
  AppDependencyCapabilityManifest,
  CapabilityClosureSourceFile,
  CapabilityPackageRequest,
  CapabilityRootKind,
  CompilerGeneratedCapabilityDependency,
  PackageCapabilitySummary,
  PackageCapabilitySummaryExport,
  RawCapabilityKind,
  ResolvedCapabilityPackage,
  ScannedBindingCandidate,
  ScannedCapabilityModule,
  ScannedCompilerDependencyFact,
  ScannedExportBindingFact,
  ScannedImportFact,
} from './capability-closure-model.js';
import {
  appDependencyCapabilityManifestSchema,
  classifyRawCapabilityModuleSpecifier,
  packageCapabilitySummarySchema,
} from './capability-closure-model.js';
import {
  frameworkExportPosturePackages,
  frameworkExportPostureGroups,
  frameworkExportPostureSummaryVersion,
  frameworkZeroPublicRequestClosedPackages,
  type FrameworkExportPostureDisposition,
} from './framework-public-runtime-export-posture.generated.js';
import {
  canonicalFrameworkImplementationDigest,
  frameworkImplementationDigestMatches,
} from './framework-implementation-digest.js';

export type {
  AppDependencyCapability,
  AppDependencyCapabilityEntry,
  AppDependencyCapabilityImport,
  AppDependencyCapabilityManifest,
  CapabilityClosureSourceFile,
  CapabilityPackageRequest,
  CapabilityRootKind,
  CompilerGeneratedCapabilityDependency,
  PackageCapabilitySummary,
  PackageCapabilitySummaryEntry,
  PackageCapabilitySummaryExport,
  RawCapabilityKind,
  ResolvedCapabilityPackage,
} from './capability-closure-model.js';
export {
  appDependencyCapabilityManifestSchema,
  packageCapabilitySummarySchema,
} from './capability-closure-model.js';
export { compilerGeneratedCapabilityDependencies } from '../scan/capability-closure.js';

/** @internal */
export interface AnalyzeCapabilityClosureOptions {
  readonly compilerDependencies?: readonly CompilerGeneratedCapabilityDependency[];
  readonly files: readonly CapabilityClosureSourceFile[];
  readonly packages?: readonly ResolvedCapabilityPackage[];
  readonly packageSummaries?: readonly PackageCapabilitySummary[];
}

/** @internal */
export interface AnalyzeCapabilityClosureResult {
  readonly dependencyManifest: AppDependencyCapabilityManifest;
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly facts: readonly CoreGraph.CapabilityClosureExplainFact[];
  readonly packageRequests: readonly CapabilityPackageRequest[];
}

interface CapabilityRoot {
  readonly adapterEntryModule?: string;
  readonly kind: CapabilityRootKind;
  readonly lexicalProvenanceClosed?: boolean;
  readonly module: string;
  readonly name: string;
  readonly site: string;
}

interface ModuleEdge {
  readonly from: string;
  readonly kind: ScannedImportFact['kind'] | 'callback-transfer';
  readonly site: string;
  readonly specifier: string;
  readonly to: string;
}

type BindingOrigin =
  | {
      readonly exportName: string;
      readonly kind: 'local';
      readonly module: string;
      readonly namespace?: boolean;
    }
  | {
      readonly exportName: string;
      readonly kind: 'package';
      readonly namespace?: boolean;
      readonly specifier: string;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

interface ReachablePackageUse {
  readonly compilerDerived?: ScannedCompilerDependencyFact['kind'];
  readonly separatedCustomAdapterEntry: boolean;
  readonly importedNames: readonly string[];
  readonly importFact: ScannedImportFact;
  readonly module: string;
}

interface TraversalNode {
  readonly module: string;
  readonly path: readonly string[];
}

interface PackageVerdict {
  readonly closed: readonly { capability?: RawCapabilityKind; reason: string }[];
  readonly dependency: {
    readonly imports: readonly AppDependencyCapabilityImport[];
    readonly metadata?: ResolvedCapabilityPackage;
    readonly summaryVersion?: string;
    readonly verdict: 'closed' | 'open';
  };
  readonly doors: readonly { capability: RawCapabilityKind; reason: string }[];
  readonly summaryFact: CoreGraph.CapabilityClosureExplainFact;
}

interface DependencyManifestUse {
  readonly dependency: PackageVerdict['dependency'];
  readonly importer: string;
  readonly rootKind?: CapabilityRootKind;
  readonly site: string;
  readonly specifier: string;
}

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;
interface CompilerGeneratedAbiPosture {
  readonly initializer: FrameworkPermission;
  readonly members: ReadonlyMap<string, FrameworkPermission>;
}

const generatedAuthorityFree: FrameworkPermission = {
  capabilities: [],
  disposition: 'authority-free',
};
const generatedCryptoDoor: FrameworkPermission = {
  capabilities: ['crypto-acquisition'],
  disposition: 'framework-door',
};

// Exact compiler-emitted private ABI posture. The enclosing first-party verdict binds this table to
// the installed package fingerprint and implementation digest before it is consulted (SPEC §6.6).
const compilerGeneratedInternalAbi = new Map<string, CompilerGeneratedAbiPosture>([
  [
    '@kovojs/browser/internal/output',
    {
      initializer: generatedAuthorityFree,
      members: new Map([
        ['derive', generatedAuthorityFree],
        ['kovoStyleProperty', generatedAuthorityFree],
      ]),
    },
  ],
  [
    '@kovojs/server/internal/csrf',
    {
      initializer: generatedAuthorityFree,
      members: new Map([['renderGeneratedMutationFormFields', generatedCryptoDoor]]),
    },
  ],
  [
    '@kovojs/server/internal/escape',
    {
      initializer: generatedAuthorityFree,
      members: new Map([
        ['escapeText', generatedAuthorityFree],
        ['kovoSafeJsxSpread', generatedAuthorityFree],
      ]),
    },
  ],
  [
    '@kovojs/server/internal/route',
    {
      initializer: generatedAuthorityFree,
      members: new Map([['defineCompiledRoutePage', generatedAuthorityFree]]),
    },
  ],
  [
    '@kovojs/server/internal/wire',
    {
      // mutation-wire.ts acquires the development attestation secret at module initialization.
      initializer: generatedCryptoDoor,
      members: new Map(
        [
          'assignDerivedComponentName',
          'assignDerivedDomainKey',
          'assignDerivedMutationKey',
          'assignDerivedQueryKey',
          'assignDerivedTaskKey',
          'assignDerivedWebhookName',
          'componentLiveTargetRenderer',
          'encodeGeneratedDependencyIdentity',
          'registerGeneratedLiveTargetRenderer',
        ].map((name) => [name, generatedAuthorityFree]),
      ),
    },
  ],
]);

const compilerDerivedJsxRuntimeAbi = new Map<string, CompilerGeneratedAbiPosture>([
  [
    './jsx-runtime',
    {
      initializer: generatedAuthorityFree,
      members: new Map(['Fragment', 'jsx', 'jsxs'].map((name) => [name, generatedAuthorityFree])),
    },
  ],
  [
    './jsx-dev-runtime',
    {
      initializer: generatedAuthorityFree,
      members: new Map(['Fragment', 'jsxDEV'].map((name) => [name, generatedAuthorityFree])),
    },
  ],
]);

const drizzleSummaryVersion = 'kovo-reviewed-drizzle/1.0.0-rc.4.1';

interface FrameworkPackageVariantPosture {
  readonly conditionsBySubpath: ReadonlyMap<string, readonly string[]>;
  readonly implementationDigests: readonly string[];
}

interface FrameworkPackagePosture {
  readonly implementationBinding: FrameworkImplementationBinding;
  readonly variantsByFingerprint: ReadonlyMap<string, FrameworkPackageVariantPosture>;
  readonly packageVersion: string;
}

type FrameworkImplementationBinding = 'exact-implementation' | 'unconditional-request-closure';

interface FrameworkPermission {
  readonly capabilities: readonly RawCapabilityKind[];
  readonly disposition: FrameworkExportPostureDisposition;
  readonly reason?: string;
}

interface FrameworkPostureRegistry {
  readonly invalidReasons: readonly string[];
  readonly packages: ReadonlyMap<string, FrameworkPackagePosture>;
  readonly permissions: ReadonlyMap<string, FrameworkPermission>;
  readonly rootFactories: ReadonlyMap<string, CapabilityRootKind>;
  readonly zeroPublicRequestClosedPackages: ReadonlySet<string>;
}

const frameworkDispositions = new Set<FrameworkExportPostureDisposition>([
  'authority-free',
  'framework-door',
  'request-closed',
]);
const frameworkImplementationBindings = new Set<FrameworkImplementationBinding>([
  'exact-implementation',
  'unconditional-request-closure',
]);
const frameworkRawCapabilities = new Set<RawCapabilityKind>([
  'crypto-acquisition',
  'database-driver',
  'declassification',
  'digest',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);

const requestClosedDeclassificationExports = new Set([
  'DeclassifyPolicy',
  'revealSecret',
  'revealUntrusted',
  'trustedReveal',
]);
const requestClosedDeclassificationPermission: FrameworkPermission = {
  capabilities: ['declassification'],
  disposition: 'request-closed',
  reason:
    '@kovojs/core/security declassification policy and reveal doors are unavailable to untrusted-data-reachable modules',
};
const frameworkRootKinds = new Set<CapabilityRootKind | 'none'>([
  'agent-tool-callback',
  'application',
  'durable-task',
  'endpoint',
  'layout',
  'mutation',
  'none',
  'query',
  'route',
  'serialized-browser-handler',
  'webhook',
]);
const lexicalOverflowRootCandidateBudget = 32;

const frameworkPostureRegistry = createFrameworkPostureRegistry();

/** Compiler-registry membership used by the pre-evaluation installed-package resolver. @internal */
export function isCompilerOwnedCapabilityPackage(packageName: string): boolean {
  return (
    frameworkPostureRegistry.packages.has(packageName) ||
    frameworkPostureRegistry.zeroPublicRequestClosedPackages.has(packageName)
  );
}

/** Packages closed by exact name before installed identity must never be implementation-hashed. */
export function isZeroPublicRequestClosedCapabilityPackage(packageName: string): boolean {
  return frameworkPostureRegistry.zeroPublicRequestClosedPackages.has(packageName);
}

function createFrameworkPostureRegistry(): FrameworkPostureRegistry {
  const invalidReasons: string[] = [];
  const packages = new Map<string, FrameworkPackagePosture>();
  const permissions = new Map<string, FrameworkPermission>();
  const rootFactories = new Map<string, CapabilityRootKind>();
  const zeroPublicRequestClosedPackages = new Set<string>();

  for (const packageName of frameworkZeroPublicRequestClosedPackages) {
    if (packageName.trim() === '') {
      invalidReasons.push('zero-public request-closed package name is blank');
      continue;
    }
    if (zeroPublicRequestClosedPackages.has(packageName)) {
      invalidReasons.push(`duplicate zero-public request-closed package ${packageName}`);
      continue;
    }
    zeroPublicRequestClosedPackages.add(packageName);
  }

  for (const [
    packageName,
    packageVersion,
    variants,
    implementationBinding,
  ] of frameworkExportPosturePackages) {
    if (packages.has(packageName)) {
      invalidReasons.push(`duplicate package ${packageName}`);
      continue;
    }
    if (!frameworkImplementationBindings.has(implementationBinding)) {
      invalidReasons.push(
        `${packageName} has unknown implementation binding ${String(implementationBinding)}`,
      );
    }
    const variantsByFingerprint = new Map<string, FrameworkPackageVariantPosture>();
    for (const [fingerprint, subpaths, implementationDigests] of variants) {
      if (variantsByFingerprint.has(fingerprint)) {
        invalidReasons.push(`${packageName} has duplicate manifest fingerprint ${fingerprint}`);
        continue;
      }
      const conditionsBySubpath = new Map<string, readonly string[]>();
      for (const [subpath, conditions] of subpaths) {
        if (conditionsBySubpath.has(subpath)) {
          invalidReasons.push(`${packageName}/${fingerprint} has duplicate subpath ${subpath}`);
          continue;
        }
        if (new Set(conditions).size !== conditions.length || conditions.length === 0) {
          invalidReasons.push(`${packageName}${subpath} has duplicate or empty conditions`);
        }
        conditionsBySubpath.set(subpath, conditions);
      }
      const canonicalImplementationDigests = implementationDigests.flatMap((digest) => {
        const canonical = canonicalFrameworkImplementationDigest(digest);
        if (canonical === undefined) {
          invalidReasons.push(
            `${packageName}/${fingerprint} has invalid implementation digest ${digest}`,
          );
          return [];
        }
        return [canonical];
      });
      if (new Set(canonicalImplementationDigests).size !== canonicalImplementationDigests.length) {
        invalidReasons.push(`${packageName}/${fingerprint} has duplicate implementation digests`);
      }
      if (
        implementationBinding === 'exact-implementation' &&
        canonicalImplementationDigests.length === 0
      ) {
        invalidReasons.push(`${packageName}/${fingerprint} has no exact implementation digest`);
      }
      if (
        implementationBinding === 'unconditional-request-closure' &&
        canonicalImplementationDigests.length !== 0
      ) {
        invalidReasons.push(
          `${packageName}/${fingerprint} unconditional request closure carries implementation digests`,
        );
      }
      variantsByFingerprint.set(fingerprint, {
        conditionsBySubpath,
        implementationDigests: canonicalImplementationDigests,
      });
    }
    if (variantsByFingerprint.size === 0)
      invalidReasons.push(`${packageName} has no manifest variant`);
    packages.set(packageName, {
      implementationBinding,
      packageVersion,
      variantsByFingerprint,
    });
  }

  for (const [
    packageName,
    disposition,
    capabilities,
    rootKind,
    reason,
    members,
  ] of frameworkExportPostureGroups) {
    const pkg = packages.get(packageName);
    for (const [subpath, names] of members) {
      if (
        pkg === undefined ||
        ![...pkg.variantsByFingerprint.values()].some((variant) =>
          variant.conditionsBySubpath.has(subpath),
        )
      ) {
        invalidReasons.push(
          `permission group references unknown package/subpath ${packageName}${subpath}`,
        );
      }
      for (const name of names) {
        const id = frameworkMemberId(packageName, subpath, name);
        if (permissions.has(id)) {
          invalidReasons.push(`duplicate permission ${id}`);
          continue;
        }
        if (new Set(capabilities).size !== capabilities.length) {
          invalidReasons.push(`permission has duplicate capabilities ${id}`);
        }
        if (!frameworkDispositions.has(disposition)) {
          invalidReasons.push(`permission has unknown disposition ${id}`);
        }
        for (const capability of capabilities) {
          if (!frameworkRawCapabilities.has(capability)) {
            invalidReasons.push(`permission has unknown raw capability ${id}`);
          }
        }
        if (!frameworkRootKinds.has(rootKind)) {
          invalidReasons.push(`permission has unknown root kind ${id}`);
        }
        if (disposition === 'authority-free' && capabilities.length > 0) {
          invalidReasons.push(`authority-free permission carries capabilities ${id}`);
        }
        if (disposition === 'framework-door' && capabilities.length === 0) {
          invalidReasons.push(`framework door has no capability ${id}`);
        }
        if (disposition === 'request-closed' && (reason === null || reason.trim() === '')) {
          invalidReasons.push(`request-closed permission has no reason ${id}`);
        }
        if (disposition === 'request-closed' && rootKind !== 'none') {
          invalidReasons.push(`request-closed permission is a root factory ${id}`);
        }
        permissions.set(id, {
          capabilities,
          disposition,
          ...(reason === null ? {} : { reason }),
        });
        if (rootKind !== 'none') {
          if (name === '<module>')
            invalidReasons.push(`module init cannot be a root factory ${id}`);
          if (rootFactories.has(id)) invalidReasons.push(`duplicate root factory ${id}`);
          rootFactories.set(id, rootKind);
        }
      }
    }
  }

  for (const [packageName, pkg] of packages) {
    if (zeroPublicRequestClosedPackages.has(packageName)) {
      invalidReasons.push(
        `${packageName} cannot have both a reviewed runtime surface and zero-public request closure`,
      );
    }
    const packagePermissions = [...permissions.entries()].filter(([id]) =>
      id.startsWith(`${packageName}\0`),
    );
    if (
      pkg.implementationBinding === 'unconditional-request-closure' &&
      (packagePermissions.length === 0 ||
        packagePermissions.some(([, permission]) => permission.disposition !== 'request-closed'))
    ) {
      invalidReasons.push(
        `${packageName} unconditional request closure does not cover an entirely request-closed public runtime surface`,
      );
    }
    const subpaths = new Set(
      [...pkg.variantsByFingerprint.values()].flatMap((variant) => [
        ...variant.conditionsBySubpath.keys(),
      ]),
    );
    for (const subpath of subpaths) {
      if (!permissions.has(frameworkMemberId(packageName, subpath, '<module>'))) {
        invalidReasons.push(`${packageName}${subpath} has no explicit <module> permission`);
      }
    }
  }
  if (rootFactories.size > lexicalOverflowRootCandidateBudget) {
    invalidReasons.push(
      `root factory count ${rootFactories.size} exceeds lexical overflow candidate budget ${lexicalOverflowRootCandidateBudget}`,
    );
  }
  return {
    invalidReasons,
    packages,
    permissions,
    rootFactories,
    zeroPublicRequestClosedPackages,
  };
}

/**
 * Derive the complete capability closure for all declared untrusted-data roots.
 *
 * The pass is deliberately module-granular: once a root reaches a module, eager imports, re-exports,
 * local wrapper dependencies, literal dynamic loading, globals, and callbacks supplied through a
 * wrapper/container all participate. Unsupported resolution and package facts become KV448 rather
 * than an allow-by-omission verdict (SPEC §6.6; C13).
 */
export function analyzeCapabilityClosure(
  options: AnalyzeCapabilityClosureOptions,
): AnalyzeCapabilityClosureResult {
  const modules = mergeCompilerGeneratedDependencies(
    scanCapabilityClosureModules(options.files),
    options.compilerDependencies ?? [],
  );
  const modulesByName = new Map(
    modules.map((module) => [normalizeModuleName(module.fileName), module]),
  );
  const normalizedModules = modules.map((module) => ({
    ...module,
    fileName: normalizeModuleName(module.fileName),
  }));
  modulesByName.clear();
  for (const module of normalizedModules) modulesByName.set(module.fileName, module);

  const resolver = new BindingResolver(modulesByName);
  const roots = discoverRoots(normalizedModules, resolver);
  const edges = deriveModuleEdges(normalizedModules, modulesByName, resolver);
  const edgesByModule = groupEdges(edges);
  const packageUsesByModule = packageUses(normalizedModules, resolver);
  const packageRequests = collectCapabilityPackageRequestsFromModules(normalizedModules);
  const packageMetadata = indexPackageMetadata(options.packages ?? []);
  const packageSummaries = indexPackageSummaries(options.packageSummaries ?? []);
  const facts: CoreGraph.CapabilityClosureExplainFact[] = roots.flatMap((root) => [
    rootFact(root),
    ...rootFrameworkDoorFacts(root),
  ]);
  const diagnostics: CompilerDiagnostic[] = [];
  const dependencyUses: DependencyManifestUse[] = [];
  const factKeys = new Set(facts.map(capabilityFactKey));

  for (const root of roots) {
    if (!root.lexicalProvenanceClosed) continue;
    appendClosed(
      root,
      root.site,
      undefined,
      'framework root is reached through mutable or ambiguous lexical provenance',
      [`root:${root.kind}:${root.name}@${root.module}`, 'lexical-provenance:mutable-or-ambiguous'],
      facts,
      factKeys,
      diagnostics,
    );
  }

  for (const root of roots) {
    const rootPath = [`root:${root.kind}:${root.name}@${root.module}`];
    if (root.adapterEntryModule !== undefined) {
      const adapterEntry = modulesByName.get(root.adapterEntryModule);
      const bootstrap = adapterEntry?.imports.filter(
        (imported) => imported.specifier === '@kovojs/server/runtime-bootstrap',
      );
      const validBootstrap =
        bootstrap?.length === 1 &&
        bootstrap[0]!.kind === 'import' &&
        bootstrap[0]!.firstImport === true &&
        sameStrings(bootstrap[0]!.importedNames, ['<module>']);
      if (!validBootstrap) {
        appendClosed(
          root,
          bootstrap?.[0]?.site ?? root.site,
          'process',
          'a separated custom Node adapter must import @kovojs/server/runtime-bootstrap as its exact literal first side-effect import before loading its handler module',
          [
            ...rootPath,
            `adapter-entry:${root.adapterEntryModule}`,
            'bootstrap-order:<missing-or-reordered>',
          ],
          facts,
          factKeys,
          diagnostics,
        );
      } else {
        appendFact(facts, factKeys, {
          capability: 'process',
          kind: 'door',
          module: root.adapterEntryModule,
          name: root.name,
          path: [
            ...rootPath,
            `adapter-entry:${root.adapterEntryModule}`,
            `import:@kovojs/server/runtime-bootstrap@${root.adapterEntryModule}`,
          ],
          reason:
            'the exact literal-first runtime bootstrap locks classifier-reviewed globals before the separated handler graph evaluates',
          rootKind: root.kind,
          site: bootstrap[0]!.site,
        });
      }
    }
    const queue: TraversalNode[] = [{ module: root.module, path: rootPath }];
    const visited = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      if (visited.has(current.module)) continue;
      visited.add(current.module);
      const module = modulesByName.get(current.module);
      if (module === undefined) continue;

      for (const global of module.globals) {
        const terminal = `${global.evidence}@${module.fileName}`;
        appendClosed(
          root,
          global.site,
          global.capability,
          `raw ${global.capability} authority (${global.evidence}) is unavailable from untrusted-data-reachable code`,
          [...current.path, terminal],
          facts,
          factKeys,
          diagnostics,
        );
      }

      const reachablePackageUses: ReachablePackageUse[] = [
        ...(packageUsesByModule.get(current.module) ?? []),
        ...module.compilerDependencies.map((dependency) => ({
          compilerDerived: dependency.kind,
          importedNames: dependency.importedNames,
          importFact: {
            importedNames: dependency.importedNames,
            kind: 'import' as const,
            site: dependency.site,
            specifier: dependency.specifier,
          },
          module: module.fileName,
          separatedCustomAdapterEntry: false,
        })),
      ];
      for (const use of reachablePackageUses) {
        const verdict = packageVerdict(use, packageMetadata, packageSummaries);
        dependencyUses.push({
          dependency: verdict.dependency,
          importer: use.module,
          rootKind: root.kind,
          site: use.importFact.site,
          specifier: use.importFact.specifier!,
        });
        appendFact(facts, factKeys, verdict.summaryFact);
        const packagePath = [
          ...current.path,
          `${use.importFact.kind}:${use.importFact.specifier ?? '<dynamic>'}@${current.module}`,
        ];
        for (const closed of verdict.closed) {
          appendClosed(
            root,
            use.importFact.site,
            closed.capability,
            closed.reason,
            packagePath,
            facts,
            factKeys,
            diagnostics,
          );
        }
        for (const door of verdict.doors) {
          appendFact(facts, factKeys, {
            capability: door.capability,
            kind: 'door',
            module: current.module,
            name: root.name,
            path: packagePath,
            reason: door.reason,
            rootKind: root.kind,
            site: use.importFact.site,
          });
        }
      }

      for (const imported of module.imports) {
        if (
          imported.specifier !== undefined ||
          imported.kind === 'import' ||
          imported.kind === 're-export'
        ) {
          continue;
        }
        appendClosed(
          root,
          imported.site,
          'dynamic-loader',
          `${imported.kind} target is not a compile-visible string literal`,
          [...current.path, `${imported.kind}:<unresolved>@${current.module}`],
          facts,
          factKeys,
          diagnostics,
        );
      }

      for (const edge of edgesByModule.get(current.module) ?? []) {
        queue.push({
          module: edge.to,
          path: [...current.path, `${edge.kind}:${edge.specifier}@${edge.from}`, edge.to],
        });
      }

      for (const imported of module.imports) {
        const specifier = imported.specifier;
        if (specifier === undefined || !isRelativeSpecifier(specifier)) continue;
        if (resolveRelativeModule(module.fileName, specifier, modulesByName) !== undefined)
          continue;
        appendClosed(
          root,
          imported.site,
          'dynamic-loader',
          `relative ${imported.kind} ${specifier} did not resolve inside the immutable app source snapshot`,
          [...current.path, `${imported.kind}:${specifier}@${current.module}`, '<unresolved>'],
          facts,
          factKeys,
          diagnostics,
        );
      }
    }
  }

  // The supported loader must account for every package edge before evaluating the app, including
  // modules that turn out not to be reachable from a valid framework root. Root reachability owns
  // the security diagnostics and explain facts above; this census-only pass owns the exact loader
  // admission set. A malformed aggregate or currently unreachable helper therefore cannot create an
  // allow-by-omission edge during module initialization (SPEC §6.6; C13).
  for (const module of normalizedModules) {
    const modulePackageUses: ReachablePackageUse[] = [
      ...(packageUsesByModule.get(module.fileName) ?? []),
      ...module.compilerDependencies.map((dependency) => ({
        compilerDerived: dependency.kind,
        importedNames: dependency.importedNames,
        importFact: {
          importedNames: dependency.importedNames,
          kind: 'import' as const,
          site: dependency.site,
          specifier: dependency.specifier,
        },
        module: module.fileName,
        separatedCustomAdapterEntry: false,
      })),
    ];
    for (const use of modulePackageUses) {
      const verdict = packageVerdict(use, packageMetadata, packageSummaries);
      dependencyUses.push({
        dependency: verdict.dependency,
        importer: use.module,
        site: use.importFact.site,
        specifier: use.importFact.specifier!,
      });
    }
  }

  return {
    dependencyManifest: dependencyCapabilityManifest(dependencyUses),
    diagnostics: stableDiagnostics(diagnostics),
    facts: stableFacts(facts),
    packageRequests,
  };
}

function dependencyCapabilityManifest(
  uses: readonly DependencyManifestUse[],
): AppDependencyCapabilityManifest {
  interface MutableEntry {
    conditions: readonly string[];
    importers: Set<string>;
    imports: Map<string, AppDependencyCapabilityImport>;
    rootKinds: Set<CapabilityRootKind>;
    sites: Set<string>;
    specifier: string;
  }
  interface MutableDependency {
    entries: Map<string, MutableEntry>;
    implementationDigest?: string;
    manifestFingerprint?: string;
    packageName: string;
    packageVersion: string;
    summaryVersion?: string;
    verdict: 'closed' | 'open';
  }

  const byIdentity = new Map<string, MutableDependency>();
  for (const use of uses) {
    const metadata = use.dependency.metadata;
    const packageName = metadata?.packageName ?? packageNameForSpecifier(use.specifier);
    const packageVersion = metadata?.packageVersion ?? '<unresolved>';
    const manifestFingerprint = metadata?.manifestFingerprint;
    const implementationDigest = metadata?.implementationDigest;
    const identity = [
      packageName,
      packageVersion,
      manifestFingerprint ?? '',
      implementationDigest ?? '',
      use.dependency.summaryVersion ?? '',
    ].join('\0');
    let dependency = byIdentity.get(identity);
    if (dependency === undefined) {
      dependency = {
        entries: new Map(),
        ...(implementationDigest === undefined ? {} : { implementationDigest }),
        ...(manifestFingerprint === undefined ? {} : { manifestFingerprint }),
        packageName,
        packageVersion,
        ...(use.dependency.summaryVersion === undefined
          ? {}
          : { summaryVersion: use.dependency.summaryVersion }),
        verdict: use.dependency.verdict,
      };
      byIdentity.set(identity, dependency);
    } else if (use.dependency.verdict === 'closed') {
      dependency.verdict = 'closed';
    }

    const conditions = metadata?.conditions ?? [];
    const entryKey = `${use.specifier}\0${conditions.join('\0')}`;
    let entry = dependency.entries.get(entryKey);
    if (entry === undefined) {
      entry = {
        conditions,
        importers: new Set(),
        imports: new Map(),
        rootKinds: new Set(),
        sites: new Set(),
        specifier: use.specifier,
      };
      dependency.entries.set(entryKey, entry);
    }
    entry.importers.add(use.importer);
    if (use.rootKind !== undefined) entry.rootKinds.add(use.rootKind);
    entry.sites.add(use.site);
    for (const imported of use.dependency.imports) {
      const importKey = `${imported.name}\0${imported.disposition}\0${imported.capabilities.join('\0')}`;
      entry.imports.set(importKey, imported);
    }
  }

  const dependencies: AppDependencyCapability[] = [...byIdentity.values()]
    .map((dependency) => ({
      entries: [...dependency.entries.values()]
        .map((entry) => ({
          conditions: entry.conditions,
          importers: [...entry.importers].sort(),
          imports: [...entry.imports.values()].sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.disposition.localeCompare(right.disposition),
          ),
          rootKinds: [...entry.rootKinds].sort(),
          sites: [...entry.sites].sort(),
          specifier: entry.specifier,
        }))
        .sort((left, right) => left.specifier.localeCompare(right.specifier)),
      ...(dependency.implementationDigest === undefined
        ? {}
        : { implementationDigest: dependency.implementationDigest }),
      ...(dependency.manifestFingerprint === undefined
        ? {}
        : { manifestFingerprint: dependency.manifestFingerprint }),
      packageName: dependency.packageName,
      packageVersion: dependency.packageVersion,
      ...(dependency.summaryVersion === undefined
        ? {}
        : { summaryVersion: dependency.summaryVersion }),
      verdict: dependency.verdict,
    }))
    .sort(
      (left, right) =>
        left.packageName.localeCompare(right.packageName) ||
        left.packageVersion.localeCompare(right.packageVersion),
    );
  return { dependencies, schema: appDependencyCapabilityManifestSchema };
}

/** Parse once to tell the pre-evaluation resolver exactly which installed package facts are needed. */
export function collectCapabilityPackageRequests(
  files: readonly CapabilityClosureSourceFile[],
  compilerDependencies: readonly CompilerGeneratedCapabilityDependency[] = [],
): CapabilityPackageRequest[] {
  return collectCapabilityPackageRequestsFromModules(
    mergeCompilerGeneratedDependencies(scanCapabilityClosureModules(files), compilerDependencies),
  );
}

function mergeCompilerGeneratedDependencies(
  modules: readonly ScannedCapabilityModule[],
  dependencies: readonly CompilerGeneratedCapabilityDependency[],
): ScannedCapabilityModule[] {
  const byImporter = new Map<string, ScannedCompilerDependencyFact[]>();
  const moduleNames = new Set(modules.map((module) => normalizeModuleName(module.fileName)));
  for (const dependency of dependencies) {
    const importer = normalizeModuleName(dependency.importer);
    if (!moduleNames.has(importer)) {
      throw new TypeError(
        `Compiler-generated dependency importer ${dependency.importer} is absent from the authored source snapshot.`,
      );
    }
    const values = byImporter.get(importer) ?? [];
    values.push({
      importedNames: [...dependency.importedNames],
      kind: dependency.kind,
      site: dependency.site,
      specifier: dependency.specifier,
    });
    byImporter.set(importer, values);
  }
  return modules.map((module) => ({
    ...module,
    compilerDependencies: [
      ...module.compilerDependencies,
      ...(byImporter.get(normalizeModuleName(module.fileName)) ?? []),
    ],
  }));
}

function collectCapabilityPackageRequestsFromModules(
  modules: readonly ScannedCapabilityModule[],
): CapabilityPackageRequest[] {
  const requests = new Map<
    string,
    { importedNames: Set<string>; importer: string; specifier: string }
  >();
  for (const module of modules) {
    for (const imported of [...module.imports, ...module.compilerDependencies]) {
      const specifier = imported.specifier;
      if (
        specifier === undefined ||
        isRelativeSpecifier(specifier) ||
        classifyRawCapabilityModuleSpecifier(specifier) !== undefined
      ) {
        continue;
      }
      const key = `${module.fileName}\0${specifier}`;
      const request = requests.get(key) ?? {
        importedNames: new Set<string>(),
        importer: module.fileName,
        specifier,
      };
      for (const name of imported.importedNames) request.importedNames.add(name);
      requests.set(key, request);
    }
  }
  return [...requests.values()]
    .map(({ importedNames, importer, specifier }) => ({
      importer,
      importedNames: [...importedNames].sort(),
      specifier,
    }))
    .sort(
      (left, right) =>
        left.importer.localeCompare(right.importer) ||
        left.specifier.localeCompare(right.specifier),
    );
}

function resolveCallUse(
  resolver: BindingResolver,
  moduleName: string,
  call: ScannedCapabilityModule['calls'][number],
  first = false,
): { origins: readonly BindingOrigin[]; rootWideningRequired: boolean; uncertain: boolean } {
  const candidates = first ? call.firstArgumentCandidates : call.calleeCandidates;
  const legacy = first ? call.firstArgumentBinding : call.callee;
  if (candidates === undefined) {
    return {
      origins: legacy ? [resolver.resolveBinding(moduleName, legacy)] : [],
      rootWideningRequired: false,
      uncertain: false,
    };
  }
  const origins = [
    ...new Map(
      candidates
        .map((candidate) => resolver.resolveCandidate(moduleName, candidate))
        .map((origin) => [bindingOriginKey(origin), origin]),
    ).values(),
  ];
  return {
    origins,
    rootWideningRequired: first ? false : call.calleeRootWideningRequired === true,
    uncertain:
      (first ? call.firstArgumentUncertain : call.calleeUncertain) === true ||
      candidates.some((candidate) => candidate.kind === 'unknown') ||
      origins.length !== 1,
  };
}

function lexicalRootSupplyByModule(
  modules: readonly ScannedCapabilityModule[],
): ReadonlyMap<string, readonly BindingOrigin[]> {
  const indexed = new Map(modules.map((module) => [module.fileName, module]));
  const supply = new Map(
    modules.map((module) => [module.fileName, new Map<string, BindingOrigin>()]),
  );
  const dependents = new Map<string, Set<string>>();
  const collectRegistry = (
    moduleName: string,
    specifier?: string,
    importedNames: readonly string[] = ['*'],
  ): void => {
    const roots = supply.get(moduleName)!;
    for (const id of frameworkPostureRegistry.rootFactories.keys()) {
      const [candidatePackage, subpath, exportName] = id.split('\0');
      if (
        specifier !== undefined &&
        (candidatePackage !== packageNameForSpecifier(specifier) ||
          subpath !== packageSubpath(specifier) ||
          (!importedNames.includes('*') && !importedNames.includes(exportName!)))
      ) {
        continue;
      }
      const origin: BindingOrigin = {
        exportName: exportName!,
        kind: 'package',
        specifier: subpath === '.' ? candidatePackage! : `${candidatePackage}${subpath!.slice(1)}`,
      };
      roots.set(bindingOriginKey(origin), origin);
    }
  };
  for (const module of modules) {
    for (const imported of module.imports) {
      if (imported.specifier === undefined) {
        collectRegistry(module.fileName);
        continue;
      }
      if (!isRelativeSpecifier(imported.specifier)) {
        const packageName = packageNameForSpecifier(imported.specifier);
        if (frameworkPostureRegistry.packages.has(packageName)) {
          collectRegistry(module.fileName, imported.specifier, imported.importedNames);
        }
        continue;
      }
      const target = resolveRelativeModule(module.fileName, imported.specifier, indexed);
      if (target === undefined) continue;
      const importers = dependents.get(target) ?? new Set<string>();
      importers.add(module.fileName);
      dependents.set(target, importers);
    }
  }
  const queued = new Set(
    [...supply].filter(([, roots]) => roots.size > 0).map(([moduleName]) => moduleName),
  );
  const pending = [...queued];
  while (pending.length > 0) {
    const target = pending.shift()!;
    queued.delete(target);
    for (const importer of dependents.get(target) ?? []) {
      const importerRoots = supply.get(importer)!;
      const before = importerRoots.size;
      for (const [key, origin] of supply.get(target)!) importerRoots.set(key, origin);
      if (importerRoots.size > before && !queued.has(importer)) {
        queued.add(importer);
        pending.push(importer);
      }
    }
  }
  return new Map(
    [...supply].map(([moduleName, roots]) => [
      moduleName,
      [...roots.values()].slice(0, lexicalOverflowRootCandidateBudget),
    ]),
  );
}

function discoverRoots(
  modules: readonly ScannedCapabilityModule[],
  resolver: BindingResolver,
): CapabilityRoot[] {
  const roots: CapabilityRoot[] = [];
  const keys = new Set<string>();
  const rootSupply = lexicalRootSupplyByModule(modules);
  for (const module of modules) {
    const conservativeOrigins = rootSupply.get(module.fileName) ?? [];
    for (const handler of module.browserHandlers) {
      appendRoot(roots, keys, {
        kind: 'serialized-browser-handler',
        module: module.fileName,
        name: handler.name,
        site: handler.site,
      });
    }
    for (const call of module.calls) {
      const use = resolveCallUse(resolver, module.fileName, call);
      const widenedOrigins =
        module.lexicalProvenanceBudgetExhausted || use.rootWideningRequired
          ? conservativeOrigins
          : [];
      const origins = [
        ...new Map(
          [...use.origins, ...widenedOrigins].map((origin) => [bindingOriginKey(origin), origin]),
        ).values(),
      ];
      for (const origin of origins) {
        if (origin.kind !== 'package') continue;
        const factoryId = frameworkMemberId(
          packageNameForSpecifier(origin.specifier),
          packageSubpath(origin.specifier),
          origin.exportName,
        );
        let kind = frameworkPostureRegistry.rootFactories.get(factoryId);
        if (kind === undefined) continue;
        if (kind === 'durable-task' && call.hasCron) kind = 'scheduled-task';
        const callbackOrigins =
          factoryId === frameworkMemberId('@kovojs/server', '.', 'toNodeHandler')
            ? resolveCallUse(resolver, module.fileName, call, true).origins
            : [];
        const callbackOrigin = callbackOrigins.find(
          (candidate) => candidate.kind === 'local' && candidate.module !== module.fileName,
        );
        const separatedAdapter = callbackOrigin?.kind === 'local';
        appendRoot(roots, keys, {
          ...(separatedAdapter ? { adapterEntryModule: module.fileName } : {}),
          kind,
          ...(use.uncertain || use.rootWideningRequired || module.lexicalProvenanceBudgetExhausted
            ? { lexicalProvenanceClosed: true }
            : {}),
          module: separatedAdapter ? callbackOrigin.module : module.fileName,
          name: call.firstLiteral ?? call.assignedName ?? origin.exportName,
          site: call.site,
        });
      }
    }
  }
  return roots.sort(compareRoots);
}

function appendRoot(roots: CapabilityRoot[], keys: Set<string>, root: CapabilityRoot): void {
  const key = `${root.kind}\0${root.module}\0${root.site}\0${root.name}`;
  if (keys.has(key)) return;
  keys.add(key);
  roots.push(root);
}

function deriveModuleEdges(
  modules: readonly ScannedCapabilityModule[],
  modulesByName: ReadonlyMap<string, ScannedCapabilityModule>,
  resolver: BindingResolver,
): ModuleEdge[] {
  const edges: ModuleEdge[] = [];
  const keys = new Set<string>();
  for (const module of modules) {
    for (const imported of module.imports) {
      if (imported.specifier === undefined || !isRelativeSpecifier(imported.specifier)) continue;
      const target = resolveRelativeModule(module.fileName, imported.specifier, modulesByName);
      if (target === undefined) continue;
      appendEdge(edges, keys, {
        from: module.fileName,
        kind: imported.kind,
        site: imported.site,
        specifier: imported.specifier,
        to: target,
      });
    }
    for (const call of module.calls) {
      if (!call.carriesCallback) continue;
      const origin = resolveCallUse(resolver, module.fileName, call).origins.find(
        (candidate) => candidate.kind === 'local' && candidate.module !== module.fileName,
      );
      if (origin?.kind !== 'local') continue;
      appendEdge(edges, keys, {
        from: origin.module,
        kind: 'callback-transfer',
        site: call.site,
        specifier: `${origin.exportName}(${module.fileName} callback/container)`,
        to: module.fileName,
      });
    }
  }
  return edges;
}

function appendEdge(edges: ModuleEdge[], keys: Set<string>, edge: ModuleEdge): void {
  const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.specifier}`;
  if (keys.has(key)) return;
  keys.add(key);
  edges.push(edge);
}

function groupEdges(edges: readonly ModuleEdge[]): Map<string, ModuleEdge[]> {
  const grouped = new Map<string, ModuleEdge[]>();
  for (const edge of edges) {
    const values = grouped.get(edge.from) ?? [];
    values.push(edge);
    grouped.set(edge.from, values);
  }
  for (const values of grouped.values()) {
    values.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.specifier.localeCompare(right.specifier) ||
        left.to.localeCompare(right.to),
    );
  }
  return grouped;
}

function packageUses(
  modules: readonly ScannedCapabilityModule[],
  resolver: BindingResolver,
): Map<string, ReachablePackageUse[]> {
  const uses = new Map<string, ReachablePackageUse[]>();
  for (const module of modules) {
    const separatedCustomAdapterEntry = module.calls.some((call) => {
      const origin = resolveCallUse(resolver, module.fileName, call).origins.find(
        (candidate) => candidate.kind === 'package',
      );
      if (
        origin?.kind !== 'package' ||
        origin.specifier !== '@kovojs/server' ||
        origin.exportName !== 'toNodeHandler' ||
        (call.firstArgumentBinding === undefined && call.firstArgumentCandidates === undefined)
      ) {
        return false;
      }
      return resolveCallUse(resolver, module.fileName, call, true).origins.some(
        (candidate) => candidate.kind === 'local' && candidate.module !== module.fileName,
      );
    });
    for (const imported of module.imports) {
      const specifier = imported.specifier;
      if (
        specifier === undefined ||
        isRelativeSpecifier(specifier) ||
        classifyRawCapabilityModuleSpecifier(specifier) !== undefined
      ) {
        continue;
      }
      const moduleUses = uses.get(module.fileName) ?? [];
      moduleUses.push({
        separatedCustomAdapterEntry,
        importedNames: imported.importedNames,
        importFact: imported,
        module: module.fileName,
      });
      uses.set(module.fileName, moduleUses);
    }
  }
  return uses;
}

function packageVerdict(
  use: ReachablePackageUse,
  metadataBySpecifier: ReadonlyMap<string, readonly ResolvedCapabilityPackage[]>,
  summariesByPackage: ReadonlyMap<string, readonly PackageCapabilitySummary[]>,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  const packageName = packageNameForSpecifier(specifier);
  const frameworkPosture = frameworkPostureRegistry.packages.get(packageName);
  const zeroPublicRequestClosure =
    frameworkPostureRegistry.zeroPublicRequestClosedPackages.has(packageName);
  if (zeroPublicRequestClosure) {
    if (frameworkPostureRegistry.invalidReasons.length > 0) {
      return closedPackageVerdict(
        use,
        'contradictory',
        `compiler-owned framework posture registry is invalid: ${frameworkPostureRegistry.invalidReasons.join('; ')}`,
        undefined,
        frameworkExportPostureSummaryVersion,
      );
    }
    // SPEC §6.6/C13: exact package-name closure precedes package resolution and every installed
    // identity field. In particular, the running analyzer cannot authenticate its own bytes.
    return closedPackageVerdict(
      use,
      'contradictory',
      `compiler-owned ${packageName} is unconditionally request-closed because it exposes no app-public runtime subpaths`,
      undefined,
      frameworkExportPostureSummaryVersion,
    );
  }
  const metadataCandidates =
    metadataBySpecifier.get(packageMetadataKey(use.module, specifier)) ??
    metadataBySpecifier.get(packageMetadataKey(undefined, specifier)) ??
    [];
  if (metadataCandidates.length !== 1) {
    const status = metadataCandidates.length === 0 ? 'unresolved' : 'contradictory';
    return closedPackageVerdict(
      use,
      status,
      metadataCandidates.length === 0
        ? `package ${specifier} could not be resolved to one exact installed manifest before app evaluation`
        : `package ${specifier} resolved to contradictory installed-manifest facts`,
    );
  }
  const metadata = metadataCandidates[0]!;
  if (metadata.packageName !== packageName || metadata.specifier !== specifier) {
    return closedPackageVerdict(
      use,
      'contradictory',
      `package resolution for ${specifier} reports ${metadata.packageName}/${metadata.specifier}`,
      metadata,
    );
  }
  if (metadata.exportStatus !== 'resolved') {
    return closedPackageVerdict(
      use,
      'unresolved',
      `package ${specifier} has no unambiguous conditional export target in the installed manifest`,
      metadata,
    );
  }

  if (frameworkPosture !== undefined) {
    if (frameworkPostureRegistry.invalidReasons.length > 0) {
      return closedPackageVerdict(
        use,
        'contradictory',
        `compiler-owned framework posture registry is invalid: ${frameworkPostureRegistry.invalidReasons.join('; ')}`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    if (metadata.packageVersion !== frameworkPosture.packageVersion) {
      return closedPackageVerdict(
        use,
        'stale',
        `compiler-owned ${packageName} posture covers ${frameworkPosture.packageVersion}, installed ${metadata.packageVersion}; review the upgraded package before retaining authority`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    const installedVariant = frameworkPosture.variantsByFingerprint.get(
      metadata.manifestFingerprint,
    );
    if (installedVariant === undefined) {
      return closedPackageVerdict(
        use,
        'stale',
        `compiler-owned ${packageName} posture does not cover installed manifest fingerprint ${metadata.manifestFingerprint}`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    if (frameworkPosture.implementationBinding === 'unconditional-request-closure') {
      return closedPackageVerdict(
        use,
        'contradictory',
        `compiler-owned ${packageName} is unconditionally request-closed; its reviewed public runtime surface cannot contribute request-handler authority`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    if (
      !frameworkImplementationDigestMatches(
        installedVariant.implementationDigests,
        metadata.implementationDigest,
      )
    ) {
      return closedPackageVerdict(
        use,
        metadata.implementationDigest === undefined ? 'unresolved' : 'stale',
        metadata.implementationDigest === undefined
          ? `compiler-owned ${packageName} posture has no compiler-derived installed implementation digest`
          : `compiler-owned ${packageName} posture installed implementation digest does not match the reviewed source or packed implementation`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    // Automatic JSX runtime edges are compiler-emitted, not authored public API. The reviewed
    // package fingerprint and implementation digest above bind the complete export map/bytes;
    // only this exact compiler-owned vocabulary may bypass public-subpath membership.
    if (use.compilerDerived === 'jsx-runtime') {
      return compilerDerivedJsxRuntimeVerdict(
        use,
        metadata,
        packageName,
        packageSubpath(specifier),
      );
    }
    if (use.compilerDerived === 'generated-internal-abi') {
      return compilerGeneratedInternalAbiVerdict(use, metadata);
    }
    const subpath = packageSubpath(specifier);
    const conditions = installedVariant.conditionsBySubpath.get(subpath);
    if (conditions === undefined) {
      return closedPackageVerdict(
        use,
        'absent',
        `compiler-owned ${packageName} posture does not classify public subpath ${subpath}`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    if (!sameStrings(conditions, metadata.conditions)) {
      return closedPackageVerdict(
        use,
        'stale',
        `compiler-owned ${packageName} posture does not cover installed conditional exports ${formatList(metadata.conditions)} for ${subpath}`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    return frameworkPackageVerdict(use, metadata);
  }

  if (packageName === 'drizzle-orm') {
    return drizzlePackageVerdict(use, metadata);
  }

  const summaries = summariesByPackage.get(packageName) ?? [];
  if (summaries.length !== 1) {
    return closedPackageVerdict(
      use,
      summaries.length === 0 ? 'absent' : 'contradictory',
      summaries.length === 0
        ? `reachable third-party package ${packageName} has no reviewed exact-version capability summary`
        : `reachable package ${packageName} has ${summaries.length} contradictory summaries`,
      metadata,
    );
  }
  return reviewedPackageVerdict(use, metadata, summaries[0]!);
}

function frameworkPackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
): PackageVerdict {
  const packageName = metadata.packageName;
  const subpath = packageSubpath(use.importFact.specifier!);
  if (use.compilerDerived === 'jsx-runtime') {
    return compilerDerivedJsxRuntimeVerdict(use, metadata, packageName, subpath);
  }
  if (use.compilerDerived === 'generated-internal-abi') {
    return compilerGeneratedInternalAbiVerdict(use, metadata);
  }
  const permissions = new Map<string, FrameworkPermission>();
  const closed: { capability?: RawCapabilityKind; reason: string }[] = [];
  const doors = new Map<RawCapabilityKind, string>();

  const appendPermission = (name: string): void => {
    const id = frameworkMemberId(packageName, subpath, name);
    if (
      packageName === '@kovojs/core' &&
      subpath === './security' &&
      requestClosedDeclassificationExports.has(name)
    ) {
      // SPEC §6.6: construction and use of a declassification door are both transitively closed
      // from request-reachable code. This compiler-owned rule is independent of generated API
      // posture so a newly exported constructor cannot briefly become authority-free.
      permissions.set(id, requestClosedDeclassificationPermission);
      return;
    }
    const permission = frameworkPostureRegistry.permissions.get(id);
    if (permission === undefined) {
      closed.push({
        reason: `compiler-owned ${packageName} posture ${frameworkExportPostureSummaryVersion} does not classify runtime export ${name} on ${subpath}`,
      });
      return;
    }
    permissions.set(id, permission);
  };

  // Every import evaluates the exact package subpath before exposing a member (SPEC §6.6).
  appendPermission('<module>');
  for (const importedName of use.importedNames) {
    if (importedName === '<module>') continue;
    if (importedName === '*') {
      const prefix = `${packageName}\0${subpath}\0`;
      const namespaceMembers = [...frameworkPostureRegistry.permissions.entries()].filter(
        ([id]) => id.startsWith(prefix) && id !== `${prefix}<module>`,
      );
      if (namespaceMembers.length === 0) {
        // A reviewed value-empty module still has an explicit <module> posture.
        continue;
      }
      for (const [id, permission] of namespaceMembers) permissions.set(id, permission);
      if (packageName === '@kovojs/core' && subpath === '.') {
        for (const name of requestClosedDeclassificationExports) appendPermission(name);
      }
      continue;
    }
    appendPermission(importedName);
  }

  for (const [id, permission] of permissions) {
    const name = id.slice(id.lastIndexOf('\0') + 1);
    if (permission.disposition === 'request-closed') {
      const reason =
        permission.reason ?? `${packageName} export ${name} is not available to request roots`;
      if (permission.capabilities.length === 0) closed.push({ reason });
      for (const capability of permission.capabilities) closed.push({ capability, reason });
      continue;
    }
    if (permission.disposition !== 'framework-door') continue;
    if (
      id === frameworkMemberId('@kovojs/server', './runtime-bootstrap', '<module>') &&
      (!use.separatedCustomAdapterEntry ||
        use.importFact.kind !== 'import' ||
        use.importFact.firstImport !== true ||
        !sameStrings(use.importedNames, ['<module>']))
    ) {
      closed.push({
        capability: 'process',
        reason:
          '@kovojs/server/runtime-bootstrap is a reviewed door only as the exact literal first side-effect import in a separated custom adapter entry',
      });
      continue;
    }
    for (const capability of permission.capabilities) {
      doors.set(
        capability,
        `${packageName}${subpath === '.' ? '' : subpath.slice(1)} supplies reviewed ${capability} operations through ${name}`,
      );
    }
  }
  return {
    closed,
    dependency: {
      imports: [...permissions.entries()]
        .map(([id, permission]) => ({
          capabilities: permission.capabilities,
          disposition: permission.disposition,
          name: id.slice(id.lastIndexOf('\0') + 1),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      metadata,
      summaryVersion: frameworkExportPostureSummaryVersion,
      verdict: closed.length === 0 ? 'open' : 'closed',
    },
    doors: [...doors.entries()].map(([capability, reason]) => ({ capability, reason })),
    summaryFact: summaryFact(
      metadata,
      frameworkExportPostureSummaryVersion,
      closed.length === 0 ? 'valid' : 'contradictory',
      use.importFact.site,
    ),
  };
}

function compilerDerivedJsxRuntimeVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
  packageName: string,
  subpath: string,
): PackageVerdict {
  const posture = compilerDerivedJsxRuntimeAbi.get(subpath);
  const expectedNames = posture === undefined ? undefined : [...posture.members.keys()];
  if (
    packageName !== '@kovojs/server' ||
    posture === undefined ||
    expectedNames === undefined ||
    !sameStrings(use.importedNames, expectedNames)
  ) {
    return closedPackageVerdict(
      use,
      'contradictory',
      'compiler-derived JSX dependency is outside the exact @kovojs/server automatic-runtime vocabulary',
      metadata,
      frameworkExportPostureSummaryVersion,
    );
  }
  return compilerGeneratedAbiPostureVerdict(use, metadata, posture);
}

function compilerGeneratedInternalAbiVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  const posture = compilerGeneratedInternalAbi.get(specifier);
  const names = [...use.importedNames].sort((left, right) => left.localeCompare(right));
  const seen = new Set<string>();
  const exactVocabulary =
    posture !== undefined &&
    names.length > 0 &&
    names.every((name) => {
      if (!posture.members.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  if (!exactVocabulary) {
    return closedPackageVerdict(
      use,
      'contradictory',
      `compiler-derived internal dependency is outside the exact compiler-generated ${specifier} ABI vocabulary`,
      metadata,
      frameworkExportPostureSummaryVersion,
    );
  }
  return compilerGeneratedAbiPostureVerdict(use, metadata, posture!);
}

function compilerGeneratedAbiPostureVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
  posture: CompilerGeneratedAbiPosture,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  const permissions: Array<{ name: string; permission: FrameworkPermission }> = [
    { name: '<module>', permission: posture.initializer },
  ];
  for (const name of use.importedNames) {
    if (name === '<module>') continue;
    const permission = posture.members.get(name);
    if (permission === undefined) {
      return closedPackageVerdict(
        use,
        'contradictory',
        `compiler-derived internal dependency is outside the exact compiler-generated ${specifier} ABI posture`,
        metadata,
        frameworkExportPostureSummaryVersion,
      );
    }
    permissions.push({ name, permission });
  }

  const closed: { capability?: RawCapabilityKind; reason: string }[] = [];
  const doors = new Map<RawCapabilityKind, string>();
  for (const { name, permission } of permissions) {
    if (permission.disposition === 'request-closed') {
      const reason =
        permission.reason ?? `${specifier} compiler-generated ABI member ${name} is request-closed`;
      if (permission.capabilities.length === 0) closed.push({ reason });
      for (const capability of permission.capabilities) closed.push({ capability, reason });
      continue;
    }
    if (permission.disposition !== 'framework-door') continue;
    for (const capability of permission.capabilities) {
      doors.set(
        capability,
        `${specifier} compiler-generated ABI member ${name} supplies reviewed ${capability} operations`,
      );
    }
  }

  return {
    closed,
    dependency: {
      imports: permissions.map(({ name, permission }) => ({
        capabilities: permission.capabilities,
        disposition: permission.disposition,
        name,
      })),
      metadata,
      summaryVersion: frameworkExportPostureSummaryVersion,
      verdict: closed.length === 0 ? 'open' : 'closed',
    },
    doors: [...doors].map(([capability, reason]) => ({ capability, reason })),
    summaryFact: summaryFact(
      metadata,
      frameworkExportPostureSummaryVersion,
      closed.length === 0 ? 'valid' : 'contradictory',
      use.importFact.site,
    ),
  };
}

function drizzlePackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
): PackageVerdict {
  if (metadata.packageVersion !== '1.0.0-rc.4') {
    return closedPackageVerdict(
      use,
      'stale',
      `reviewed drizzle-orm summary covers 1.0.0-rc.4, installed ${metadata.packageVersion}`,
      metadata,
    );
  }
  const subpath = packageSubpath(use.importFact.specifier!);
  const pureSubpaths = new Set(['.', './pg-core', './relations', './sqlite-core']);
  if (!pureSubpaths.has(subpath)) {
    return closedPackageVerdict(
      use,
      'absent',
      `drizzle-orm subpath ${subpath} is not in the reviewed schema/query-construction summary; driver subpaths require the Kovo database door`,
      metadata,
    );
  }
  return {
    closed: [],
    dependency: {
      imports: ['<module>', ...use.importedNames.filter((name) => name !== '<module>')].map(
        (name) => ({
          capabilities: [],
          disposition: 'pure' as const,
          name,
        }),
      ),
      metadata,
      summaryVersion: drizzleSummaryVersion,
      verdict: 'open',
    },
    doors: [],
    summaryFact: summaryFact(metadata, drizzleSummaryVersion, 'valid', use.importFact.site),
  };
}

function reviewedPackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
  summary: PackageCapabilitySummary,
): PackageVerdict {
  const staleReason = packageSummaryStaleReason(metadata, summary);
  if (staleReason !== undefined) {
    return closedPackageVerdict(use, 'stale', staleReason, metadata, summary.summaryVersion);
  }
  const subpath = packageSubpath(use.importFact.specifier!);
  const entries = summary.entries.filter((entry) => entry.subpath === subpath);
  if (entries.length !== 1) {
    return closedPackageVerdict(
      use,
      entries.length === 0 ? 'absent' : 'contradictory',
      entries.length === 0
        ? `summary ${summary.summaryVersion} has no entry for ${use.importFact.specifier}`
        : `summary ${summary.summaryVersion} has duplicate ${subpath} entries`,
      metadata,
      summary.summaryVersion,
    );
  }
  const entry = entries[0]!;
  if (!sameStrings(entry.conditions, metadata.conditions)) {
    return closedPackageVerdict(
      use,
      'stale',
      `summary conditions ${formatList(entry.conditions)} do not cover installed conditional exports ${formatList(metadata.conditions)}`,
      metadata,
      summary.summaryVersion,
    );
  }

  const permissions: PackageCapabilitySummaryExport[] = [];
  const importedNames = ['<module>', ...use.importedNames.filter((name) => name !== '<module>')];
  for (const importedName of importedNames) {
    const matches = entry.exports.filter(
      (candidate) =>
        candidate.name === importedName || (importedName !== '<module>' && candidate.name === '*'),
    );
    if (matches.length !== 1) {
      return closedPackageVerdict(
        use,
        matches.length === 0 ? 'absent' : 'contradictory',
        matches.length === 0
          ? `summary ${summary.summaryVersion} does not classify export ${importedName}`
          : `summary ${summary.summaryVersion} gives export ${importedName} contradictory permissions`,
        metadata,
        summary.summaryVersion,
      );
    }
    permissions.push(matches[0]!);
  }

  const closed: { capability?: RawCapabilityKind; reason: string }[] = [];
  for (const permission of permissions) {
    if (permission.disposition === 'framework-door') {
      closed.push({
        reason: `project/package summary ${summary.summaryVersion} attempts to mint framework-door authority; only the compiler-owned Kovo registry may do so`,
      });
      continue;
    }
    if (permission.disposition === 'raw' || permission.capabilities.length > 0) {
      const capabilities =
        permission.capabilities.length > 0 ? permission.capabilities : [undefined];
      for (const capability of capabilities) {
        closed.push({
          ...(capability === undefined ? {} : { capability }),
          reason: `package ${metadata.packageName} export ${permission.name} exposes raw ${capability ?? 'unclassified'} authority`,
        });
      }
    }
  }
  return {
    closed,
    dependency: {
      imports: permissions.map((permission) => ({
        capabilities: permission.capabilities,
        disposition: permission.disposition,
        name: permission.name,
      })),
      metadata,
      summaryVersion: summary.summaryVersion,
      verdict: closed.length === 0 ? 'open' : 'closed',
    },
    doors: [],
    summaryFact: summaryFact(
      metadata,
      summary.summaryVersion,
      closed.length === 0 ? 'valid' : 'contradictory',
      use.importFact.site,
    ),
  };
}

function packageSummaryStaleReason(
  metadata: ResolvedCapabilityPackage,
  summary: PackageCapabilitySummary,
): string | undefined {
  if (summary.schema !== packageCapabilitySummarySchema) {
    return `summary ${summary.summaryVersion} uses unsupported schema ${String(summary.schema)}`;
  }
  if (summary.packageName !== metadata.packageName) {
    return `summary names ${summary.packageName}, installed package is ${metadata.packageName}`;
  }
  if (summary.packageVersion !== metadata.packageVersion) {
    return `summary covers ${summary.packageVersion}, installed package is ${metadata.packageVersion}`;
  }
  if (summary.manifestFingerprint !== metadata.manifestFingerprint) {
    return `summary manifest fingerprint ${summary.manifestFingerprint} is stale for installed ${metadata.manifestFingerprint}`;
  }
  if (summary.summaryVersion.trim() === '')
    return 'package capability summary has no version token';
  return undefined;
}

function closedPackageVerdict(
  use: ReachablePackageUse,
  status: 'absent' | 'contradictory' | 'stale' | 'unresolved',
  reason: string,
  metadata?: ResolvedCapabilityPackage,
  summaryVersion?: string,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  return {
    closed: [{ reason }],
    dependency: {
      imports: [],
      ...(metadata === undefined ? {} : { metadata }),
      ...(summaryVersion === undefined ? {} : { summaryVersion }),
      verdict: 'closed',
    },
    doors: [],
    summaryFact: {
      conditions: metadata?.conditions ?? [],
      kind: 'summary',
      ...(metadata === undefined ? {} : { manifestFingerprint: metadata.manifestFingerprint }),
      packageName: metadata?.packageName ?? packageNameForSpecifier(specifier),
      packageVersion: metadata?.packageVersion ?? '<unresolved>',
      reason,
      site: use.importFact.site,
      status,
      ...(summaryVersion === undefined ? {} : { summaryVersion }),
    },
  };
}

function summaryFact(
  metadata: ResolvedCapabilityPackage,
  summaryVersion: string,
  status: NonNullable<CoreGraph.CapabilityClosureExplainFact['status']>,
  site: string,
): CoreGraph.CapabilityClosureExplainFact {
  return {
    conditions: metadata.conditions,
    kind: 'summary',
    manifestFingerprint: metadata.manifestFingerprint,
    packageName: metadata.packageName,
    packageVersion: metadata.packageVersion,
    site,
    status,
    summaryVersion,
  };
}

function appendClosed(
  root: CapabilityRoot,
  site: string,
  capability: RawCapabilityKind | undefined,
  reason: string,
  path: readonly string[],
  facts: CoreGraph.CapabilityClosureExplainFact[],
  factKeys: Set<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const fact: CoreGraph.CapabilityClosureExplainFact = {
    ...(capability === undefined ? {} : { capability }),
    kind: 'closed',
    module: root.module,
    name: root.name,
    path,
    reason,
    rootKind: root.kind,
    site,
    status: 'unresolved',
  };
  const key = capabilityFactKey(fact);
  if (factKeys.has(key)) return;
  appendFact(facts, factKeys, fact);
  diagnostics.push(capabilityDiagnostic(root, site, reason, path));
}

function appendFact(
  facts: CoreGraph.CapabilityClosureExplainFact[],
  keys: Set<string>,
  fact: CoreGraph.CapabilityClosureExplainFact,
): void {
  const key = capabilityFactKey(fact);
  if (keys.has(key)) return;
  keys.add(key);
  facts.push(fact);
}

function capabilityDiagnostic(
  root: CapabilityRoot,
  site: string,
  reason: string,
  path: readonly string[],
): CompilerDiagnostic {
  const parsedSite = parseSite(site);
  return createRegisteredDiagnostic(
    'KV448',
    {
      fileName: parsedSite.fileName,
      start: { column: parsedSite.column, line: parsedSite.line },
    },
    {
      detail: `root=${root.kind}:${root.name}; reason=${reason}; provenance=${path.join(' -> ')}`,
      includeHelp: true,
    },
  );
}

function rootFact(root: CapabilityRoot): CoreGraph.CapabilityClosureExplainFact {
  return {
    kind: 'root',
    module: root.module,
    name: root.name,
    rootKind: root.kind,
    site: root.site,
  };
}

function rootFrameworkDoorFacts(root: CapabilityRoot): CoreGraph.CapabilityClosureExplainFact[] {
  if (
    root.kind !== 'durable-task' &&
    root.kind !== 'scheduled-task' &&
    root.kind !== 'webhook' &&
    root.kind !== 'agent-tool-callback'
  ) {
    return [];
  }
  return [
    {
      capability: 'network',
      kind: 'door',
      module: root.module,
      name: root.name,
      path: [`root:${root.kind}:${root.name}@${root.module}`, 'framework-door:ctx.fetch'],
      reason:
        'ctx.fetch is the framework-owned positive egress capability: exact declared origin ' +
        'before DNS, then resolved-IP classification and dial pinning on every hop',
      rootKind: root.kind,
      site: root.site,
    },
  ];
}

function indexPackageMetadata(
  packages: readonly ResolvedCapabilityPackage[],
): Map<string, readonly ResolvedCapabilityPackage[]> {
  const indexed = new Map<string, ResolvedCapabilityPackage[]>();
  for (const packageFact of packages) {
    const key = packageMetadataKey(packageFact.importer, packageFact.specifier);
    const values = indexed.get(key) ?? [];
    values.push(packageFact);
    indexed.set(key, values);
  }
  return indexed;
}

function packageMetadataKey(importer: string | undefined, specifier: string): string {
  return `${importer ?? ''}\0${specifier}`;
}

function indexPackageSummaries(
  summaries: readonly PackageCapabilitySummary[],
): Map<string, readonly PackageCapabilitySummary[]> {
  const indexed = new Map<string, PackageCapabilitySummary[]>();
  for (const summary of summaries) {
    const values = indexed.get(summary.packageName) ?? [];
    values.push(summary);
    indexed.set(summary.packageName, values);
  }
  return indexed;
}

class BindingResolver {
  readonly #modules: ReadonlyMap<string, ScannedCapabilityModule>;

  constructor(modules: ReadonlyMap<string, ScannedCapabilityModule>) {
    this.#modules = modules;
  }

  resolveBinding(moduleName: string, binding: string): BindingOrigin {
    return this.#resolveBinding(moduleName, binding, new Set());
  }

  resolveCandidate(moduleName: string, candidate: ScannedBindingCandidate): BindingOrigin {
    if (candidate.kind === 'unknown') return { kind: 'unknown', reason: candidate.reason };
    let origin: BindingOrigin =
      candidate.kind === 'local'
        ? { exportName: candidate.exportName, kind: 'local', module: moduleName }
        : candidate.namespace
          ? this.#resolveNamespaceImport(moduleName, candidate.specifier)
          : this.#resolveImport(moduleName, candidate.specifier, candidate.exportName, new Set());
    for (const member of candidate.members ?? []) {
      origin = this.#resolveNamespaceMember(origin, member, new Set());
    }
    return origin;
  }

  #resolveBinding(moduleName: string, binding: string, seen: Set<string>): BindingOrigin {
    const visitKey = `binding\0${moduleName}\0${binding}`;
    if (seen.has(visitKey)) return { kind: 'unknown', reason: 'binding cycle' };
    seen.add(visitKey);
    const module = this.#modules.get(moduleName);
    if (module === undefined) return { kind: 'unknown', reason: `missing module ${moduleName}` };

    const aliases = module.aliases.filter(
      (alias) => alias.local === binding || binding.startsWith(`${alias.local}.`),
    );
    const rewrittenAliases = aliases.map((alias) =>
      alias.local === binding
        ? alias.source
        : `${alias.source}${binding.slice(alias.local.length)}`,
    );
    if (rewrittenAliases.length === 1) {
      return this.#resolveBinding(moduleName, rewrittenAliases[0]!, seen);
    }
    if (aliases.length > 1) {
      const origins = rewrittenAliases.map((alias) =>
        this.#resolveBinding(moduleName, alias, new Set(seen)),
      );
      return sameOrigin(origins) ?? { kind: 'unknown', reason: `contradictory alias ${binding}` };
    }

    for (const imported of module.importBindings) {
      if (binding === imported.local) {
        if (imported.namespace) {
          return this.#resolveNamespaceImport(moduleName, imported.specifier);
        }
        return this.#resolveImport(moduleName, imported.specifier, imported.imported, seen);
      }
      if (binding.startsWith(`${imported.local}.`)) {
        const member = binding.slice(imported.local.length + 1);
        if (imported.namespace) {
          return this.#resolveImport(moduleName, imported.specifier, member, seen);
        }
        const origin = this.#resolveImport(moduleName, imported.specifier, imported.imported, seen);
        return this.#resolveNamespaceMember(origin, member, seen);
      }
    }
    return { exportName: binding, kind: 'local', module: moduleName };
  }

  #resolveImport(
    importer: string,
    specifier: string,
    imported: string,
    seen: Set<string>,
  ): BindingOrigin {
    if (!isRelativeSpecifier(specifier)) {
      return { exportName: imported, kind: 'package', specifier };
    }
    const target = resolveRelativeModule(importer, specifier, this.#modules);
    if (target === undefined) return { kind: 'unknown', reason: `unresolved ${specifier}` };
    return this.#resolveExport(target, imported, seen);
  }

  #resolveNamespaceImport(importer: string, specifier: string): BindingOrigin {
    if (!isRelativeSpecifier(specifier)) {
      return { exportName: '*', kind: 'package', namespace: true, specifier };
    }
    const target = resolveRelativeModule(importer, specifier, this.#modules);
    if (target === undefined) return { kind: 'unknown', reason: `unresolved ${specifier}` };
    return { exportName: '*', kind: 'local', module: target, namespace: true };
  }

  #resolveExport(moduleName: string, exportName: string, seen: Set<string>): BindingOrigin {
    const visitKey = `export\0${moduleName}\0${exportName}`;
    if (seen.has(visitKey)) return { kind: 'unknown', reason: 're-export cycle' };
    seen.add(visitKey);
    const module = this.#modules.get(moduleName);
    if (module === undefined) return { kind: 'unknown', reason: `missing module ${moduleName}` };
    const explicit = module.exports.filter((entry) => entry.exported === exportName);
    if (explicit.length > 0) {
      const origins = explicit.map((entry) => this.#resolveExportEntry(moduleName, entry, seen));
      return (
        sameOrigin(origins) ?? { kind: 'unknown', reason: `contradictory export ${exportName}` }
      );
    }
    const separator = exportName.indexOf('.');
    if (separator > 0) {
      const namespace = this.#resolveExport(moduleName, exportName.slice(0, separator), seen);
      return this.#resolveNamespaceMember(namespace, exportName.slice(separator + 1), seen);
    }
    const wildcard = module.exports.filter(
      (entry) => entry.wildcard && entry.specifier !== undefined,
    );
    if (wildcard.length > 0) {
      const origins = wildcard.map((entry) =>
        this.#resolveImport(moduleName, entry.specifier!, exportName, new Set(seen)),
      );
      return sameOrigin(origins) ?? { kind: 'unknown', reason: `ambiguous wildcard ${exportName}` };
    }
    return { exportName, kind: 'local', module: moduleName };
  }

  #resolveExportEntry(
    moduleName: string,
    entry: ScannedExportBindingFact,
    seen: Set<string>,
  ): BindingOrigin {
    if (entry.specifier !== undefined) {
      if (entry.imported === '*' && entry.exported !== undefined) {
        return this.#resolveNamespaceImport(moduleName, entry.specifier);
      }
      return this.#resolveImport(
        moduleName,
        entry.specifier,
        entry.imported ?? entry.exported ?? '*',
        seen,
      );
    }
    if (entry.local !== undefined) return this.#resolveBinding(moduleName, entry.local, seen);
    return { kind: 'unknown', reason: 'malformed export' };
  }

  #resolveNamespaceMember(origin: BindingOrigin, member: string, seen: Set<string>): BindingOrigin {
    if (origin.kind === 'unknown') return origin;
    if (origin.namespace !== true) {
      return { kind: 'unknown', reason: `${member} is not a namespace member` };
    }
    if (origin.kind === 'package') {
      return { exportName: member, kind: 'package', specifier: origin.specifier };
    }
    return this.#resolveExport(origin.module, member, seen);
  }
}

function sameOrigin(origins: readonly BindingOrigin[]): BindingOrigin | undefined {
  const known = origins.filter((origin) => origin.kind !== 'unknown');
  if (known.length === 0) return origins[0];
  const first = known[0]!;
  const key = bindingOriginKey(first);
  return known.every((origin) => bindingOriginKey(origin) === key) ? first : undefined;
}

function bindingOriginKey(origin: BindingOrigin): string {
  if (origin.kind === 'unknown') return `unknown:${origin.reason}`;
  return origin.kind === 'local'
    ? `local:${origin.module}:${origin.exportName}:${origin.namespace === true ? 'namespace' : 'value'}`
    : `package:${origin.specifier}:${origin.exportName}:${origin.namespace === true ? 'namespace' : 'value'}`;
}

function resolveRelativeModule(
  importer: string,
  specifier: string,
  modules: ReadonlyMap<string, unknown>,
): string | undefined {
  const cleanSpecifier = stripModuleSuffix(specifier);
  const base = normalizeModuleName(`${moduleDirname(importer)}/${cleanSpecifier}`);
  const candidates: string[] = [];
  if (sourceExtensions.some((extension) => base.endsWith(extension))) {
    if (base.endsWith('.js')) {
      candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
    } else if (base.endsWith('.mjs')) {
      candidates.push(`${base.slice(0, -4)}.mts`);
    } else if (base.endsWith('.cjs')) {
      candidates.push(`${base.slice(0, -4)}.cts`);
    } else if (base.endsWith('.jsx')) {
      candidates.push(`${base.slice(0, -4)}.tsx`);
    }
    candidates.push(base);
  } else {
    candidates.push(base);
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(`${base}/index${extension}`);
  }
  return candidates.find((candidate) => modules.has(candidate));
}

function normalizeModuleName(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..' && normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join('/') || '.';
}

function moduleDirname(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? '.' : value.slice(0, index);
}

function stripModuleSuffix(value: string): string {
  const query = value.indexOf('?');
  const fragment = value.indexOf('#');
  const end = query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment);
  return end < 0 ? value : value.slice(0, end);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function packageNameForSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const parts = specifier.split('/');
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : specifier;
}

function packageSubpath(specifier: string): string {
  const packageName = packageNameForSpecifier(specifier);
  return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

function frameworkMemberId(packageName: string, subpath: string, name: string): string {
  return `${packageName}\0${subpath}\0${name}`;
}

function parseSite(site: string): { column: number; fileName: string; line: number } {
  const match = /^(.*):(\d+):(\d+)$/u.exec(site);
  return match
    ? { column: Number(match[3]), fileName: match[1]!, line: Number(match[2]) }
    : { column: 1, fileName: site, line: 1 };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '<none>' : [...values].sort().join(',');
}

function compareRoots(left: CapabilityRoot, right: CapabilityRoot): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.module.localeCompare(right.module) ||
    left.site.localeCompare(right.site)
  );
}

function capabilityFactKey(fact: CoreGraph.CapabilityClosureExplainFact): string {
  return [
    fact.kind,
    fact.rootKind ?? '',
    fact.name ?? '',
    fact.module ?? '',
    fact.manifestFingerprint ?? '',
    fact.capability ?? '',
    fact.packageName ?? '',
    fact.packageVersion ?? '',
    fact.summaryVersion ?? '',
    fact.status ?? '',
    fact.site,
    fact.reason ?? '',
    fact.path?.join('\0') ?? '',
  ].join('\u0001');
}

function stableFacts(
  facts: readonly CoreGraph.CapabilityClosureExplainFact[],
): CoreGraph.CapabilityClosureExplainFact[] {
  return [...facts].sort((left, right) =>
    capabilityFactKey(left).localeCompare(capabilityFactKey(right)),
  );
}

function stableDiagnostics(diagnostics: readonly CompilerDiagnostic[]): CompilerDiagnostic[] {
  for (let index = 0; index < diagnostics.length; index += 1) {
    assertRegisteredDiagnostic(diagnostics[index], `Capability diagnostics[${index}]`);
  }
  return [...diagnostics].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      (left.start?.line ?? 0) - (right.start?.line ?? 0) ||
      (left.start?.column ?? 0) - (right.start?.column ?? 0) ||
      left.message.localeCompare(right.message),
  );
}
