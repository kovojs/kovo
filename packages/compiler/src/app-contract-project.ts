import { createHash } from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

import {
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from '@kovojs/core/internal/client-module-url';

import { compileComponentModule } from './compile.js';
import {
  appContractDeclarationFamilies,
  appContractMemberNames,
  type AppContractDeclarationFamily,
  type AppContractMemberName,
  type AppContractResolverDiagnostic,
  type CompilerOwnedAppContractMemberResolution,
  type CompilerOwnedAppContractResolution,
  validateCompilerOwnedAppContractMemberResolutions,
  validateCompilerOwnedAppContractResolutions,
  withCompilerOwnedAppContractResolutions,
} from './app-contract-resolver.js';
import { deriveAppGraph } from './graph.js';
import { compileRouteModule } from './scan/route-pages.js';
import { parseComponentModule } from './scan/parse.js';
import { appOptimisticProjectFacts } from './scan/app-optimistic.js';
import {
  projectMutationRegistryFactsFromFiles,
  type ProjectMutationRegistryFacts,
  type ProjectMutationSourceFile,
} from './scan/project-mutation-bindings.js';
import { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
import type { CompileResult, CompileRouteModuleResult, MutationInputFieldFact } from './types.js';

/** @internal D1 diagnostic emitted by the compiler-owned app resolver. */
export interface CompilerOwnedAppContractDiagnostic {
  readonly code:
    | 'D1A001'
    | 'D1A002'
    | 'D1A003'
    | 'D1A004'
    | 'D1A005'
    | 'D1A006'
    | 'D1A007'
    | 'D1A008'
    | 'D1A009'
    | 'D1B001'
    | 'D1B002'
    | 'D1B003'
    | 'D1B004'
    | 'D1B005'
    | 'D1B006'
    | 'D1B007'
    | 'D1B008'
    | 'D1B009'
    | 'D1X001';
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

/** @internal D1 result for one exact Program source file. */
export interface CompilerOwnedAppContractEntry {
  readonly component?: CompileResult;
  readonly diagnostics: readonly CompilerOwnedAppContractDiagnostic[];
  readonly graph: {
    readonly handlerRoots: number;
    readonly pages: number;
  };
  readonly loweredSource: string | null;
  readonly ownerKey: string | null;
  readonly parsedFactories: readonly AppContractDeclarationFamily[];
  readonly resolver: {
    readonly exactNodeCount: number;
    readonly schema: 'kovo.app-contract-d1-compiler-resolver/v2';
    readonly sourceFileName: string;
  };
  readonly route?: CompileRouteModuleResult;
  readonly semanticGraph?: unknown;
  readonly serverPackageRoots: readonly string[];
  readonly source: string;
}

/** @internal Exact, source-bound app member fact consumed by compiler-owned static analyzers. */
export interface CompilerOwnedAppContractStaticFact {
  readonly declaration?: {
    readonly end: number;
    readonly kind: 'mutation' | 'page';
    readonly name: string;
    readonly start: number;
  };
  readonly end: number;
  readonly fileName: string;
  readonly memberName: AppContractMemberName;
  readonly ownerKey: string;
  readonly source: string;
  readonly start: number;
}

/** @internal Exact filesystem project. No method accepts an identity claim. */
export interface CompilerOwnedAppContractProject {
  compileEntry(fileName: string): CompilerOwnedAppContractEntry;
  diagnosticCodesForFile(fileName: string): readonly number[];
  projectMutationRegistryFacts(
    files: readonly ProjectMutationSourceFile[],
  ): ProjectMutationRegistryFacts;
  staticFacts(
    files?: readonly ProjectMutationSourceFile[],
  ): readonly CompilerOwnedAppContractStaticFact[];
  resolverIntegrityMutations(
    fileName: string,
  ): Readonly<Record<string, readonly AppContractResolverDiagnostic[]>>;
  withEntryResolutions<Value>(fileName: string, operation: (source: string) => Value): Value;
}

/** @internal Exact root names used to construct the compiler-owned TypeScript Program. */
export interface CreateCompilerOwnedAppContractProjectOptions {
  /** Base directory for project-relative root names supplied by an authenticated build census. */
  readonly rootDirectory?: string;
  readonly rootNames: readonly string[];
}

/**
 * Run the project mutation census against exact on-disk source snapshots while retaining the
 * caller's path spelling in the returned lowering facts. Framework runners use this instead of
 * invoking the structural project scanner outside the compiler-owned app resolver (SPEC §5.2).
 */
export function compilerOwnedProjectMutationRegistryFactsFromFiles(
  files: readonly ProjectMutationSourceFile[],
  rootDirectory: string = process.cwd(),
): ProjectMutationRegistryFacts {
  // SPEC §5.2 rule 9: only JavaScript/TypeScript authoring modules enter the exact Program.
  // Build source closures also retain approved CSS bytes for artifact identity; CSS is not a
  // structural mutation-fact input and must not be misrepresented as a TypeScript root.
  const sourceFiles = files.filter((file) => /\.[cm]?[jt]sx?$/u.test(file.fileName));
  if (sourceFiles.length === 0) return projectMutationRegistryFactsFromFiles(sourceFiles);
  const originalNames = new Map<string, string>();
  const programFiles = sourceFiles.map((file) => {
    const fileName = resolve(rootDirectory, file.fileName);
    const canonical = normalizeFileName(fileName);
    if (originalNames.has(canonical)) {
      throw new TypeError(
        `App-contract project mutation census refused duplicate source identity ${file.fileName}.`,
      );
    }
    originalNames.set(canonical, file.fileName);
    return { fileName, source: file.source };
  });
  const project = createCompilerOwnedAppContractProject({
    rootNames: programFiles.map((file) => file.fileName),
  });
  const facts = project.projectMutationRegistryFacts(programFiles);
  const originalName = (fileName: string): string => {
    const mapped = originalNames.get(normalizeFileName(resolve(fileName)));
    if (mapped === undefined) {
      throw new TypeError(
        `App-contract project mutation census produced an unowned source path ${fileName}.`,
      );
    }
    return mapped;
  };
  const mutationInputs: Record<string, readonly MutationInputFieldFact[]> = {};
  for (const [key, fields] of Object.entries(facts.mutationInputs)) {
    mutationInputs[key] = fields.map((field) => ({
      ...field,
      ...(field.source === undefined
        ? {}
        : {
            source: {
              ...field.source,
              fileName: originalName(field.source.fileName),
            },
          }),
    }));
  }
  const moduleHrefAliases = new Map<string, string>();
  const optimisticModules = facts.optimisticModules?.map((module) => {
    const fileName = originalName(module.fileName);
    const href = clientModuleHrefForSourceFile(
      fileName,
      clientModuleRepresentationDigest(module.source),
    );
    const target = parseVersionedClientModuleTarget(href);
    if (!target) {
      throw new TypeError(`App-contract project emitted a non-canonical optimism module ${href}.`);
    }
    moduleHrefAliases.set(module.href, href);
    return {
      ...module,
      fileName,
      href,
      path: target.path,
    };
  });
  const mutationOptimism =
    facts.mutationOptimism === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(facts.mutationOptimism).map(([key, fact]) => {
            const moduleHref = moduleHrefAliases.get(fact.moduleHref);
            if (moduleHref === undefined) {
              throw new TypeError(
                `App-contract project emitted optimism for ${key} without an owned client module.`,
              );
            }
            return [key, { ...fact, moduleHref }];
          }),
        );
  return {
    mutationBindings: facts.mutationBindings.map((binding) => ({
      ...binding,
      fileName: originalName(binding.fileName),
      source: {
        ...binding.source,
        fileName: originalName(binding.source.fileName),
      },
    })),
    mutationInputs,
    ...(mutationOptimism === undefined ? {} : { mutationOptimism }),
    ...(optimisticModules === undefined ? {} : { optimisticModules }),
  };
}

/** Build exact app-member facts for framework-owned whole-project analyzers (SPEC §5.2). */
export function compilerOwnedAppContractStaticFactsFromFiles(
  files: readonly ProjectMutationSourceFile[],
  rootDirectory: string = process.cwd(),
): readonly CompilerOwnedAppContractStaticFact[] {
  if (files.length === 0) return [];
  const originalNames = new Map<string, string>();
  const programFiles = files.map((file) => {
    const fileName = resolve(rootDirectory, file.fileName);
    const canonical = normalizeFileName(fileName);
    if (originalNames.has(canonical)) {
      throw new TypeError(
        `App-contract static census refused duplicate source identity ${file.fileName}.`,
      );
    }
    originalNames.set(canonical, file.fileName);
    return { fileName, source: file.source };
  });
  const project = createCompilerOwnedAppContractProject({
    rootNames: programFiles.map((file) => file.fileName),
  });
  return project.staticFacts(programFiles).map((fact) => {
    const fileName = originalNames.get(normalizeFileName(resolve(fact.fileName)));
    if (fileName === undefined) {
      throw new TypeError(
        `App-contract static census produced an unowned source path ${fact.fileName}.`,
      );
    }
    return { ...fact, fileName };
  });
}

type ReceiverProof =
  | {
      readonly identity: DerivedAppContractIdentity;
      readonly kind: 'app';
      readonly ownerKey: string;
      readonly serverPackageRoot: string;
    }
  | {
      readonly diagnostic: CompilerOwnedAppContractDiagnostic;
      readonly kind: 'diagnostic';
    }
  | { readonly kind: 'none' };

type FactoryProof =
  | {
      readonly exportName: AppContractDeclarationFamily;
      readonly kind: 'factory';
      readonly ownerKey: string;
      readonly serverPackageRoot: string;
    }
  | {
      readonly diagnostic: CompilerOwnedAppContractDiagnostic;
      readonly kind: 'diagnostic';
    }
  | { readonly kind: 'none' };

interface EntryAnalysis {
  readonly diagnostics: readonly CompilerOwnedAppContractDiagnostic[];
  readonly facts: readonly CompilerOwnedAppContractResolution[];
  readonly memberFacts: readonly CompilerOwnedAppContractMemberResolution[];
  readonly ownerKey: string | null;
  readonly serverPackageRoots: readonly string[];
}

interface ProvenanceContext {
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly program: ts.Program;
}

interface DerivedAppContractIdentity {
  readonly appId: string;
  readonly ownerKey: string;
  readonly providerAppExportName: string;
  readonly providerAppFileName: string;
  readonly providerDefinitionFileName: string;
  readonly providerExportBinding: string;
  readonly providerImportSpecifier: string;
  readonly providerKey: string;
}

type AnalyzableFunctionLike =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration;

/**
 * Build the Arm A project from filesystem roots. Identity is derived from compiler-owned AST and
 * package facts, then consumed only while lowering the exact source snapshot (SPEC.md §5.2).
 */
export function createCompilerOwnedAppContractProject(
  rawOptions: CreateCompilerOwnedAppContractProjectOptions,
): CompilerOwnedAppContractProject {
  const rootDirectory = snapshotRootDirectory(rawOptions);
  const rootNames = snapshotRootNames(rawOptions, rootDirectory);
  const consumerRootNames = Object.freeze([...new Set(rawOptions.rootNames)].sort());
  const options = appContractCompilerOptions();
  const program = ts.createProgram({ options, rootNames });
  const checker = program.getTypeChecker();
  const context: ProvenanceContext = { checker, options, program };
  let semanticDiagnostics: readonly ts.Diagnostic[] | undefined;
  const semanticDiagnosticsForProject = (): readonly ts.Diagnostic[] => {
    // Most build/check consumers need exact receiver/type identity but never ask this project to
    // reproduce TypeScript's ordinary diagnostic census. Computing that census eagerly retains a
    // second whole-project diagnostic graph throughout the Vite build. Keep the same immutable
    // Program and compute its diagnostics once, on the sole method that exposes them.
    semanticDiagnostics ??= ts.getPreEmitDiagnostics(program);
    return semanticDiagnostics;
  };

  const sourceFileFor = (fileName: string): ts.SourceFile => {
    const exact = programSourceFile(program, resolve(rootDirectory, fileName));
    if (!exact) throw new TypeError(`App-contract project does not contain ${fileName}.`);
    return exact;
  };

  const analyzeEntry = (fileName: string): EntryAnalysis => {
    const sourceFile = sourceFileFor(fileName);
    const diagnostics: CompilerOwnedAppContractDiagnostic[] = [];
    const facts: CompilerOwnedAppContractResolution[] = [];
    const memberFacts: CompilerOwnedAppContractMemberResolution[] = [];
    const dynamicImport = firstAppProviderDynamicImport(sourceFile, context);
    if (dynamicImport) {
      diagnostics.push(
        appContractExperimentDiagnostic(
          sourceFile,
          dynamicImport,
          'D1A009',
          'D1A009 receiver provenance refuses dynamically imported app contracts.',
        ),
      );
    }
    const visit = (node: ts.Node): void => {
      if (diagnostics.length > 0) return;
      if (
        node !== sourceFile &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }
      if (ts.isCallExpression(node)) {
        const proof = proveFactoryCall(sourceFile, node, context);
        if (proof.kind === 'diagnostic') {
          diagnostics.push(proof.diagnostic);
        } else if (proof.kind === 'factory') {
          const expression = node.expression;
          facts.push({
            end: expression.getEnd(),
            exportName: proof.exportName,
            node: expression,
            ownerKey: proof.ownerKey,
            serverPackageRoot: proof.serverPackageRoot,
            sourceFile,
            sourceSnapshot: sourceFile.text,
            start: expression.getStart(sourceFile),
          });
        }
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        isAppContractMemberName(node.name.text) &&
        receiverTypeCouldBeAppContract(node.expression, context.checker)
      ) {
        const receiver = proveReceiver(sourceFile, node.expression, context, new Set(), 0);
        if (receiver.kind === 'diagnostic') {
          diagnostics.push(receiver.diagnostic);
        } else if (receiver.kind === 'app') {
          memberFacts.push({
            end: node.getEnd(),
            memberName: node.name.text,
            node,
            ownerKey: receiver.ownerKey,
            serverPackageRoot: receiver.serverPackageRoot,
            sourceFile,
            sourceSnapshot: sourceFile.text,
            start: node.getStart(sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (diagnostics.length === 0) {
      const hidden = firstHiddenAppContractCall(sourceFile, context);
      if (hidden?.proof.kind === 'diagnostic') {
        diagnostics.push(hidden.proof.diagnostic);
      } else if (hidden?.proof.kind === 'factory') {
        const generated = ts.isIdentifier(unwrapExpression(hidden.call.expression));
        const code = generated ? 'D1B007' : 'D1A007';
        diagnostics.push(
          appContractExperimentDiagnostic(
            sourceFile,
            hidden.call.expression,
            code,
            generated
              ? 'D1B007 generated app provenance refuses declaration calls hidden in an uninvoked function or method body.'
              : 'D1A007 receiver provenance refuses declaration calls hidden in an uninvoked function or method body.',
          ),
        );
      }
    }

    const integrity = [
      ...validateCompilerOwnedAppContractResolutions(facts),
      ...validateCompilerOwnedAppContractMemberResolutions(memberFacts),
    ];
    if (integrity.length > 0) {
      throw new TypeError(integrity.map((entry) => entry.message).join('\n'));
    }

    // Both channels are required. Reachability catches unused/bridged copies; retained fact roots
    // catch two exact app facts even when their owner strings happen to be identical.
    const serverPackageRoots = unique([
      ...reachableServerPackageRoots(sourceFile, context),
      ...facts.map((fact) => fact.serverPackageRoot),
      ...memberFacts.map((fact) => fact.serverPackageRoot),
    ]);
    if (serverPackageRoots.length > 1) {
      const target =
        facts[0]?.node ??
        memberFacts[0]?.node ??
        firstTopLevelCall(sourceFile)?.expression ??
        sourceFile;
      return {
        diagnostics: [
          appContractExperimentDiagnostic(
            sourceFile,
            target,
            'D1X001',
            `D1X001 app contract mixes physical @kovojs/server packages before evaluation: ${serverPackageRoots.join(
              ' and ',
            )}.`,
          ),
        ],
        facts: [],
        memberFacts: [],
        ownerKey: null,
        serverPackageRoots,
      };
    }

    const ownerKeys = unique([
      ...facts.map((fact) => fact.ownerKey),
      ...memberFacts.map((fact) => fact.ownerKey),
    ]);
    if (ownerKeys.length > 1) {
      diagnostics.push(
        appContractExperimentDiagnostic(
          sourceFile,
          facts[0]?.node ?? sourceFile,
          'D1A006',
          'D1A006 receiver provenance refuses joined app owners in one declaration module.',
        ),
      );
    }
    const finalDiagnostics = dedupeDiagnostics(diagnostics);
    return {
      diagnostics: finalDiagnostics,
      facts: finalDiagnostics.length === 0 ? facts : [],
      memberFacts: finalDiagnostics.length === 0 ? memberFacts : [],
      ownerKey: finalDiagnostics.length === 0 ? (ownerKeys[0] ?? null) : null,
      serverPackageRoots,
    };
  };

  return Object.freeze({
    compileEntry(fileName: string): CompilerOwnedAppContractEntry {
      const sourceFile = sourceFileFor(fileName);
      const analysis = analyzeEntry(fileName);
      if (analysis.diagnostics.length > 0) {
        return rejectedEntry(sourceFile, analysis);
      }
      return withCompilerOwnedAppContractResolutions(
        analysis.facts,
        () => {
          const component = compileComponentModule({
            fileName: sourceFile.fileName,
            source: sourceFile.text,
          });
          const route = compileRouteModule({
            fileName: sourceFile.fileName,
            source: sourceFile.text,
          });
          const parsed = parseComponentModule(sourceFile.fileName, sourceFile.text);
          const loweredSource = lowerStandaloneSourceDerivedRegistryDeclarations({
            fileName: sourceFile.fileName,
            source: sourceFile.text,
          });
          const graphResult = deriveAppGraph({ components: [component], routePages: [route] });
          return {
            component,
            diagnostics: [],
            graph: {
              handlerRoots: countHandlerRoots(graphResult.graph),
              pages: graphResult.graph.pages?.length ?? 0,
            },
            loweredSource,
            ownerKey: analysis.ownerKey,
            parsedFactories: unique(
              parsed.calls.flatMap((call) =>
                isDeclarationFamily(call.frameworkFactory) ? [call.frameworkFactory] : [],
              ),
            ),
            resolver: {
              exactNodeCount: analysis.facts.length,
              schema: 'kovo.app-contract-d1-compiler-resolver/v2',
              sourceFileName: normalizeFileName(sourceFile.fileName),
            },
            route,
            semanticGraph: graphResult.graph,
            serverPackageRoots: analysis.serverPackageRoots,
            source: sourceFile.text,
          };
        },
        analysis.memberFacts,
      );
    },

    diagnosticCodesForFile(fileName: string): readonly number[] {
      const normalized = normalizeFileName(sourceFileFor(fileName).fileName);
      return uniqueNumbers(
        semanticDiagnosticsForProject().flatMap((diagnostic) =>
          diagnostic.file && normalizeFileName(diagnostic.file.fileName) === normalized
            ? [diagnostic.code]
            : [],
        ),
      );
    },

    projectMutationRegistryFacts(
      files: readonly ProjectMutationSourceFile[],
    ): ProjectMutationRegistryFacts {
      const facts: CompilerOwnedAppContractResolution[] = [];
      const members: CompilerOwnedAppContractMemberResolution[] = [];
      const inputs: ProjectMutationSourceFile[] = [];
      for (const file of files) {
        if (
          !file ||
          typeof file !== 'object' ||
          typeof file.fileName !== 'string' ||
          typeof file.source !== 'string'
        ) {
          throw new TypeError(
            'App-contract project mutation census requires exact fileName/source records.',
          );
        }
        const sourceFile = sourceFileFor(file.fileName);
        if (sourceFile.text !== file.source) {
          throw new TypeError(
            `App-contract project mutation census refused a stale source snapshot for ${file.fileName}.`,
          );
        }
        const analysis = analyzeEntry(file.fileName);
        if (analysis.diagnostics.length > 0) {
          throw new TypeError(
            analysis.diagnostics
              .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
              .join('\n'),
          );
        }
        facts.push(
          ...analysis.facts.map((fact) => ({
            ...fact,
            consumerFileName: file.fileName,
          })),
        );
        members.push(
          ...analysis.memberFacts.map((fact) => ({
            ...fact,
            consumerFileName: file.fileName,
          })),
        );
        inputs.push({ fileName: file.fileName, source: sourceFile.text });
      }
      return withCompilerOwnedAppContractResolutions(
        facts,
        () => {
          const registryFacts = projectMutationRegistryFactsFromFiles(inputs);
          return {
            ...registryFacts,
            ...appOptimisticProjectFacts({
              checker,
              files: inputs,
              members,
              mutationInputs: registryFacts.mutationInputs,
              program,
            }),
          };
        },
        members,
      );
    },

    staticFacts(
      files?: readonly ProjectMutationSourceFile[],
    ): readonly CompilerOwnedAppContractStaticFact[] {
      const facts: CompilerOwnedAppContractStaticFact[] = [];
      const fileNames =
        files === undefined
          ? consumerRootNames
          : files.map((file) => {
              if (
                !file ||
                typeof file !== 'object' ||
                typeof file.fileName !== 'string' ||
                typeof file.source !== 'string'
              ) {
                throw new TypeError(
                  'App-contract static census requires exact fileName/source records.',
                );
              }
              const sourceFile = sourceFileFor(file.fileName);
              if (sourceFile.text !== file.source) {
                throw new TypeError(
                  `App-contract static census refused a stale source snapshot for ${file.fileName}.`,
                );
              }
              return file.fileName;
            });
      if (
        new Set(fileNames.map((fileName) => normalizeFileName(resolve(rootDirectory, fileName))))
          .size !== fileNames.length
      ) {
        throw new TypeError('App-contract static census refused duplicate source identities.');
      }
      for (const fileName of fileNames) {
        const sourceFile = sourceFileFor(fileName);
        const analysis = analyzeEntry(fileName);
        if (analysis.diagnostics.length > 0) {
          throw new TypeError(
            analysis.diagnostics
              .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
              .join('\n'),
          );
        }
        for (const member of analysis.memberFacts) {
          const declaration = appContractMemberDeclaration(member, checker);
          facts.push({
            ...(declaration === undefined ? {} : { declaration }),
            end: member.end,
            fileName,
            memberName: member.memberName,
            ownerKey: member.ownerKey,
            source: sourceFile.text,
            start: member.start,
          });
        }
      }
      return Object.freeze(
        facts.sort(
          (left, right) =>
            left.fileName.localeCompare(right.fileName) ||
            left.start - right.start ||
            left.end - right.end,
        ),
      );
    },

    resolverIntegrityMutations(
      fileName: string,
    ): Readonly<Record<string, readonly AppContractResolverDiagnostic[]>> {
      const analysis = analyzeEntry(fileName);
      const fact = analysis.facts[0];
      if (!fact || analysis.diagnostics.length > 0) {
        throw new TypeError('Resolver-integrity probe requires one accepted Arm A declaration.');
      }
      return Object.freeze({
        'blank-consumer-file-name': validateCompilerOwnedAppContractResolutions([
          { ...fact, consumerFileName: '' },
        ]),
        'blank-owner-key': validateCompilerOwnedAppContractResolutions([{ ...fact, ownerKey: '' }]),
        'blank-server-package-root': validateCompilerOwnedAppContractResolutions([
          { ...fact, serverPackageRoot: '' },
        ]),
        'duplicate-span': validateCompilerOwnedAppContractResolutions([fact, fact]),
        'overlapping-span': validateCompilerOwnedAppContractResolutions([
          fact,
          { ...fact, start: fact.start + 1 },
        ]),
        'stale-source-reparse': validateCompilerOwnedAppContractResolutions([
          { ...fact, sourceSnapshot: `${fact.sourceSnapshot}\n// stale` },
        ]),
        'wrong-node-span': validateCompilerOwnedAppContractResolutions([
          {
            ...fact,
            node: ts.isPropertyAccessExpression(fact.node) ? fact.node.expression : fact.sourceFile,
          },
        ]),
      });
    },

    withEntryResolutions<Value>(fileName: string, operation: (source: string) => Value): Value {
      const sourceFile = sourceFileFor(fileName);
      const analysis = analyzeEntry(fileName);
      if (analysis.diagnostics.length > 0) {
        throw new TypeError(
          analysis.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join('\n'),
        );
      }
      // `sourceFileFor()` above proves this caller spelling resolves to the exact Program
      // SourceFile. Carry only that authenticated alias into the invocation-local resolver so
      // project-relative build censuses and absolute Program roots share identity without any
      // ambient suffix/path guessing.
      const facts = analysis.facts.map((fact) => ({
        ...fact,
        consumerFileName: fileName,
      }));
      const members = analysis.memberFacts.map((fact) => ({
        ...fact,
        consumerFileName: fileName,
      }));
      return withCompilerOwnedAppContractResolutions(
        facts,
        () => operation(sourceFile.text),
        members,
      );
    },
  });
}

function appContractMemberDeclaration(
  member: CompilerOwnedAppContractMemberResolution,
  checker: ts.TypeChecker,
): CompilerOwnedAppContractStaticFact['declaration'] {
  const call = member.node.parent;
  if (!ts.isCallExpression(call) || call.expression !== member.node) return undefined;
  const firstArgument = call.arguments[0];
  let kind: 'mutation' | 'page';
  let name: string | undefined;
  if (member.memberName === 'route') {
    kind = 'page';
    name =
      firstArgument !== undefined && ts.isStringLiteralLike(firstArgument)
        ? firstArgument.text
        : undefined;
  } else if (member.memberName === 'integrateMutation') {
    kind = 'mutation';
    name =
      firstArgument === undefined
        ? undefined
        : exactStringLiteralTypeValue(checker.getTypeAtLocation(firstArgument), checker, 'key');
  } else {
    return undefined;
  }
  if (name === undefined) return undefined;
  return Object.freeze({
    end: call.getEnd(),
    kind,
    name,
    start: call.getStart(member.sourceFile),
  });
}

function exactStringLiteralTypeValue(
  value: ts.Type,
  checker: ts.TypeChecker,
  propertyName: string,
): string | undefined {
  const property = checker.getPropertyOfType(value, propertyName);
  if (property === undefined) return undefined;
  const declaration = property.valueDeclaration ?? property.declarations?.[0];
  if (declaration === undefined) return undefined;
  const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
  const variants = propertyType.isUnion() ? propertyType.types : [propertyType];
  let result: string | undefined;
  for (const variant of variants) {
    if (!variant.isStringLiteral()) return undefined;
    if (result !== undefined && result !== variant.value) return undefined;
    result = variant.value;
  }
  return result;
}

function rejectedEntry(
  sourceFile: ts.SourceFile,
  analysis: EntryAnalysis,
): CompilerOwnedAppContractEntry {
  return {
    diagnostics: analysis.diagnostics,
    graph: { handlerRoots: 0, pages: 0 },
    loweredSource: null,
    ownerKey: null,
    parsedFactories: [],
    resolver: {
      exactNodeCount: 0,
      schema: 'kovo.app-contract-d1-compiler-resolver/v2',
      sourceFileName: normalizeFileName(sourceFile.fileName),
    },
    serverPackageRoots: analysis.serverPackageRoots,
    source: sourceFile.text,
  };
}

function proveFactoryCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  context: ProvenanceContext,
): FactoryProof {
  const expression = call.expression;
  if (ts.isPropertyAccessExpression(expression) && isDeclarationFamily(expression.name.text)) {
    if (!receiverTypeCouldBeAppContract(expression.expression, context.checker)) {
      const namespace = unwrapExpression(expression.expression);
      if (ts.isIdentifier(namespace) && namespaceResolvesToGeneratedApp(namespace, context)) {
        return generatedDiagnostic(
          sourceFile,
          expression,
          'D1B008',
          'generated app factories require a static named import',
        );
      }
      return { kind: 'none' };
    }
    const receiver = proveReceiver(sourceFile, expression.expression, context, new Set(), 0);
    if (receiver.kind === 'diagnostic') return receiver;
    if (receiver.kind !== 'app') {
      const namespace = unwrapExpression(expression.expression);
      if (ts.isIdentifier(namespace) && namespaceResolvesToGeneratedApp(namespace, context)) {
        return generatedDiagnostic(
          sourceFile,
          expression,
          'D1B008',
          'generated app factories require a static named import',
        );
      }
      return receiver;
    }
    return {
      exportName: expression.name.text,
      kind: 'factory',
      ownerKey: receiver.ownerKey,
      serverPackageRoot: receiver.serverPackageRoot,
    };
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    staticMemberName(expression.argumentExpression) !== undefined &&
    isDeclarationFamily(staticMemberName(expression.argumentExpression))
  ) {
    const receiver = proveReceiver(sourceFile, expression.expression, context, new Set(), 0);
    if (
      receiver.kind === 'app' ||
      receiver.kind === 'diagnostic' ||
      expressionDerivesFromApp(expression.expression, context, new Set(), 0)
    ) {
      return {
        diagnostic: appContractExperimentDiagnostic(
          sourceFile,
          expression,
          'D1A008',
          'D1A008 receiver provenance refuses computed declaration-factory access.',
        ),
        kind: 'diagnostic',
      };
    }
  }

  if (ts.isIdentifier(expression)) {
    const generated = proveGeneratedAppFactory(sourceFile, expression, context);
    if (generated) return generated;
  }
  const unsafeGenerated = proveUnsafeGeneratedFactoryCall(sourceFile, call, context);
  if (unsafeGenerated) return unsafeGenerated;

  if (isTransferredAppFactoryInvocation(expression, call.arguments, context)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        sourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses declaration factories invoked through Function.call, Function.apply, or Reflect.apply.',
      ),
      kind: 'diagnostic',
    };
  }

  const callbackCandidates = call.arguments
    .map((argument) => functionLikeForExpression(argument, context.checker))
    .filter((candidate): candidate is AnalyzableFunctionLike => candidate !== undefined);
  const callback = callbackCandidates.find(
    (candidate) =>
      (functionContainsDeclarationFactoryAccess(candidate) ||
        functionInvokesParameter(candidate, context.checker)) &&
      (functionContainsAppDeclarationFactory(candidate, context) ||
        expressionDerivesFromApp(expression, context, new Set(), 0) ||
        call.arguments.some((argument) =>
          expressionDerivesFromApp(argument, context, new Set(), 0),
        )),
  );
  if (callback) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        sourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app contract transferred through a callback.',
      ),
      kind: 'diagnostic',
    };
  }
  const generatedCallback = callbackCandidates.find((candidate) => {
    if (functionContainsGeneratedFactoryCall(candidate, context)) return true;
    return (
      functionInvokesParameter(candidate, context.checker) &&
      (expressionDerivesFromGeneratedFactory(expression, context, new Set(), 0) ||
        call.arguments.some((argument) =>
          expressionDerivesFromGeneratedFactory(argument, context, new Set(), 0),
        ))
    );
  });
  if (generatedCallback) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B007',
      'generated app factory provenance refuses a transfer through a callback',
    );
  }

  const functionLike = functionLikeForExpression(expression, context.checker);
  if (functionLike && functionContainsAppDeclarationFactory(functionLike, context)) {
    const code = functionLike.parameters.length === 0 ? 'D1A007' : 'D1A001';
    return {
      diagnostic: appContractExperimentDiagnostic(
        sourceFile,
        expression,
        code,
        code === 'D1A001'
          ? 'D1A001 receiver provenance refuses wrapper results because the declaration call-site owner cannot be proved exactly.'
          : 'D1A007 receiver provenance refuses declaration calls hidden in a function body.',
      ),
      kind: 'diagnostic',
    };
  }
  if (
    functionLike &&
    (functionContainsGeneratedFactoryCall(functionLike, context) ||
      ((functionContainsDeclarationFactoryAccess(functionLike) ||
        functionInvokesParameter(functionLike, context.checker)) &&
        (call.arguments.some((argument) =>
          expressionDerivesFromGeneratedFactory(argument, context, new Set(), 0),
        ) ||
          functionHasGeneratedFactoryDerivedParameterInitializer(functionLike, context))))
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B007',
      'generated app factory provenance refuses a transfer through a function parameter or body',
    );
  }
  if (
    functionLike &&
    (functionContainsDeclarationFactoryAccess(functionLike) ||
      functionInvokesParameter(functionLike, context.checker)) &&
    (call.arguments.some((argument) => expressionDerivesFromApp(argument, context, new Set(), 0)) ||
      functionHasAppDerivedParameterInitializer(functionLike, context))
  ) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        sourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app contract or declaration factory transferred through a function parameter.',
      ),
      kind: 'diagnostic',
    };
  }

  if (!ts.isIdentifier(expression)) return { kind: 'none' };
  const localDeclaration = localSymbolDeclaration(context.checker, expression);
  if (localDeclaration && ts.isBindingElement(localDeclaration)) {
    const member = bindingMemberName(localDeclaration);
    const variable = enclosingVariableDeclaration(localDeclaration);
    if (
      member &&
      isDeclarationFamily(member) &&
      variable?.initializer &&
      expressionDerivesFromApp(variable.initializer, context, new Set(), 0)
    ) {
      return {
        diagnostic: appContractExperimentDiagnostic(
          sourceFile,
          expression,
          'D1A003',
          'D1A003 receiver provenance refuses destructured declaration factories; call the immutable app receiver directly.',
        ),
        kind: 'diagnostic',
      };
    }
  }

  if (localDeclaration && ts.isVariableDeclaration(localDeclaration)) {
    const assignment = firstAppDerivedAssignment(localDeclaration, context);
    if (assignment) {
      const code = assignment.destructured ? 'D1A003' : 'D1A007';
      return {
        diagnostic: appContractExperimentDiagnostic(
          sourceFile,
          expression,
          code,
          code === 'D1A003'
            ? 'D1A003 receiver provenance refuses destructuring assignments from an app contract.'
            : 'D1A007 receiver provenance refuses declaration factories transferred through a later assignment.',
        ),
        kind: 'diagnostic',
      };
    }
  }

  if (
    localDeclaration &&
    ts.isVariableDeclaration(localDeclaration) &&
    localDeclaration.initializer &&
    expressionContainsDeclarationFactoryAccess(localDeclaration.initializer) &&
    expressionDerivesFromApp(localDeclaration.initializer, context, new Set(), 0)
  ) {
    const bound = expressionIsBoundAppFactory(localDeclaration.initializer, context);
    return {
      diagnostic: appContractExperimentDiagnostic(
        sourceFile,
        expression,
        bound ? 'D1A007' : 'D1A002',
        bound
          ? 'D1A007 receiver provenance refuses declaration factories transferred through Function.bind.'
          : 'D1A002 receiver provenance refuses dynamic declaration-factory selection.',
      ),
      kind: 'diagnostic',
    };
  }
  return { kind: 'none' };
}

function proveReceiver(
  diagnosticSourceFile: ts.SourceFile,
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): ReceiverProof {
  if (depth > 48) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        rawExpression,
        'D1A007',
        'D1A007 app-derived receiver provenance exceeded the bounded proof depth.',
      ),
      kind: 'diagnostic',
    };
  }
  const expression = unwrapExpression(rawExpression);
  if (ts.isConditionalExpression(expression) || isJoiningBinaryExpression(expression)) {
    if (expressionDerivesFromApp(expression, context, new Set(), depth + 1)) {
      return {
        diagnostic: appContractExperimentDiagnostic(
          diagnosticSourceFile,
          expression,
          'D1A006',
          'D1A006 receiver provenance refuses joined receiver aliases.',
        ),
        kind: 'diagnostic',
      };
    }
    return { kind: 'none' };
  }

  if (ts.isIdentifier(expression)) {
    const localDeclaration = localSymbolDeclaration(context.checker, expression);
    if (
      localDeclaration &&
      ts.isBindingElement(localDeclaration) &&
      declarationDerivesFromApp(localDeclaration, context, new Set(), depth + 1)
    ) {
      return {
        diagnostic: appContractExperimentDiagnostic(
          diagnosticSourceFile,
          expression,
          'D1A007',
          'D1A007 receiver provenance refuses app contracts transferred through binding elements.',
        ),
        kind: 'diagnostic',
      };
    }
    if (localDeclaration && ts.isVariableDeclaration(localDeclaration)) {
      const proof = proveVariableReceiver(
        diagnosticSourceFile,
        expression,
        localDeclaration,
        context,
        seen,
        depth,
      );
      if (proof.kind !== 'none') return proof;
    }

    const declaration = symbolDeclaration(context.checker, expression);
    if (declaration && declaration !== localDeclaration && ts.isVariableDeclaration(declaration)) {
      const proof = proveVariableReceiver(
        diagnosticSourceFile,
        expression,
        declaration,
        context,
        seen,
        depth,
      );
      if (proof.kind !== 'none') return proof;
    }
    return { kind: 'none' };
  }

  if (expressionDerivesFromApp(expression, context, new Set(), depth + 1)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app-derived receiver whose exact binding cannot be proved.',
      ),
      kind: 'diagnostic',
    };
  }
  return { kind: 'none' };
}

function proveVariableReceiver(
  diagnosticSourceFile: ts.SourceFile,
  expression: ts.Identifier,
  declaration: ts.VariableDeclaration,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): ReceiverProof {
  if (seen.has(declaration)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A006',
        'D1A006 receiver provenance refuses cyclic or joined receiver aliases.',
      ),
      kind: 'diagnostic',
    };
  }
  const nextSeen = new Set(seen);
  nextSeen.add(declaration);
  const declaredInitializer = declaration.initializer;
  const assignment = firstAppDerivedAssignment(declaration, context);
  const derives =
    declaredInitializer !== undefined &&
    expressionDerivesFromApp(declaredInitializer, context, new Set(), depth + 1);
  if (!derives && !assignment) return { kind: 'none' };
  if (!derives && assignment) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A007',
        assignment.destructured
          ? 'D1A007 receiver provenance refuses app contracts transferred through a destructuring assignment.'
          : 'D1A007 receiver provenance refuses app contracts transferred through a later assignment.',
      ),
      kind: 'diagnostic',
    };
  }
  if (!variableDeclarationIsConst(declaration)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A004',
        'D1A004 app receivers must be declared with const.',
      ),
      kind: 'diagnostic',
    };
  }
  if (variableIsReassigned(declaration, context.checker, context.program)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A005',
        'D1A005 app receiver provenance refuses a reassigned binding.',
      ),
      kind: 'diagnostic',
    };
  }

  if (!declaredInitializer) return { kind: 'none' };
  const initializer = unwrapExpression(declaredInitializer);
  if (ts.isConditionalExpression(initializer) || isJoiningBinaryExpression(initializer)) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        diagnosticSourceFile,
        expression,
        'D1A006',
        'D1A006 receiver provenance refuses joined receiver aliases.',
      ),
      kind: 'diagnostic',
    };
  }
  const direct = proveDirectDefineKovo(declaration, initializer, context);
  if (direct) return direct;
  if (ts.isIdentifier(initializer)) {
    return proveReceiver(diagnosticSourceFile, initializer, context, nextSeen, depth + 1);
  }
  return {
    diagnostic: appContractExperimentDiagnostic(
      diagnosticSourceFile,
      expression,
      'D1A007',
      'D1A007 receiver provenance refuses an app-derived receiver whose exact binding cannot be proved.',
    ),
    kind: 'diagnostic',
  };
}

function proveDirectDefineKovo(
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression,
  context: ProvenanceContext,
): Extract<ReceiverProof, { kind: 'app' }> | undefined {
  if (
    !ts.isCallExpression(initializer) ||
    initializer.arguments.length !== 1 ||
    !ts.isIdentifier(initializer.expression)
  ) {
    return undefined;
  }
  const argument = initializer.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;
  const serverPackageRoot = serverPackageRootForDefineKovo(initializer.expression, context.checker);
  if (!serverPackageRoot) return undefined;
  const appId = stringProperty(argument, 'appId');
  const providerKey = stringProperty(argument, 'providerKey');
  const providerIdentity = importedProviderIdentity(argument, providerKey, context);
  if (!appId) return undefined;
  // Bind the proof to the declaration that owns the initializer, not merely an equivalent call.
  if (
    initializer.getSourceFile() !== declaration.getSourceFile() ||
    !ts.isIdentifier(declaration.name)
  ) {
    return undefined;
  }
  if (providerKey !== undefined || hasStaticProperty(argument, 'provider')) {
    // Preserve the authenticated D1 Arm-B fixture contract while it remains as conformance
    // evidence. A partial provider identity is never allowed to fall through to the product
    // app-contract path.
    if (!providerKey || !providerIdentity) return undefined;
    const identityFields = {
      appId,
      providerExportBinding: providerIdentity.exportBinding,
      providerImportSpecifier: providerIdentity.importSpecifier,
      providerKey,
    };
    const ownerKey = `d1v6:${createHash('sha256')
      .update(JSON.stringify(identityFields))
      .digest('hex')}`;
    return {
      identity: {
        ...identityFields,
        ownerKey,
        providerAppExportName: declaration.name.text,
        providerAppFileName: declaration.getSourceFile().fileName,
        providerDefinitionFileName: providerIdentity.definitionFileName,
      },
      kind: 'app',
      ownerKey,
      serverPackageRoot,
    };
  }

  // Product authoring uses the normative `defineKovo({ appId, db, auth, env, ... })` contract,
  // not the spike-only provider/providerKey vocabulary. The UUID is the cross-command live-target
  // identity (SPEC §9.1); the exact TypeScript declaration symbol remains the provenance proof.
  // The legacy-shaped identity fields below are private compatibility carriers for the retired
  // Arm-B manifest evaluator and are never accepted as an authored provider claim.
  const identityFields = {
    appId,
    providerExportBinding: declaration.name.text,
    providerImportSpecifier: normalizeFileName(declaration.getSourceFile().fileName),
    providerKey: `app:${appId}`,
  };
  const ownerKey = `d1v7:${createHash('sha256')
    .update(
      JSON.stringify({
        appId,
        appExportBinding: declaration.name.text,
        appSourceSha256: sha256Text(declaration.getSourceFile().text),
      }),
    )
    .digest('hex')}`;
  return {
    identity: {
      ...identityFields,
      ownerKey,
      providerAppExportName: declaration.name.text,
      providerAppFileName: declaration.getSourceFile().fileName,
      providerDefinitionFileName: declaration.getSourceFile().fileName,
    },
    kind: 'app',
    ownerKey,
    serverPackageRoot,
  };
}

function importedProviderIdentity(
  options: ts.ObjectLiteralExpression,
  providerKey: string | undefined,
  context: ProvenanceContext,
):
  | {
      readonly definitionFileName: string;
      readonly exportBinding: string;
      readonly importSpecifier: string;
    }
  | undefined {
  if (!providerKey) return undefined;
  const providerProperty = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'provider') ||
        (ts.isStringLiteralLike(property.name) && property.name.text === 'provider')),
  );
  if (!providerProperty || !ts.isIdentifier(providerProperty.initializer)) return undefined;
  const localDeclaration = localSymbolDeclaration(context.checker, providerProperty.initializer);
  if (!localDeclaration || !ts.isImportSpecifier(localDeclaration)) return undefined;
  const importDeclaration = localDeclaration.parent.parent.parent;
  if (
    !ts.isImportDeclaration(importDeclaration) ||
    !ts.isStringLiteralLike(importDeclaration.moduleSpecifier)
  ) {
    return undefined;
  }
  const resolvedDeclaration = symbolDeclaration(context.checker, providerProperty.initializer);
  if (
    !resolvedDeclaration ||
    !ts.isVariableDeclaration(resolvedDeclaration) ||
    !resolvedDeclaration.initializer ||
    !ts.isObjectLiteralExpression(unwrapExpression(resolvedDeclaration.initializer))
  ) {
    return undefined;
  }
  const providerDefinition = unwrapExpression(
    resolvedDeclaration.initializer,
  ) as ts.ObjectLiteralExpression;
  if (stringProperty(providerDefinition, 'key') !== providerKey) return undefined;
  return {
    definitionFileName: resolvedDeclaration.getSourceFile().fileName,
    exportBinding: localDeclaration.propertyName?.text ?? localDeclaration.name.text,
    importSpecifier: importDeclaration.moduleSpecifier.text,
  };
}

function expressionDerivesFromApp(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48) return true;
  const expression = unwrapExpression(rawExpression);
  if (ts.isIdentifier(expression)) {
    const local = localSymbolDeclaration(context.checker, expression);
    if (local && declarationDerivesFromApp(local, context, seen, depth + 1)) return true;
    const resolved = symbolDeclaration(context.checker, expression);
    return (
      resolved !== undefined &&
      resolved !== local &&
      declarationDerivesFromApp(resolved, context, seen, depth + 1)
    );
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isIdentifier(expression.expression) &&
      serverPackageRootForDefineKovo(expression.expression, context.checker) &&
      expression.arguments.length === 1 &&
      ts.isObjectLiteralExpression(expression.arguments[0]!)
    ) {
      return true;
    }
    const calleeDeclaration = ts.isIdentifier(expression.expression)
      ? localSymbolDeclaration(context.checker, expression.expression)
      : undefined;
    const functionLike = calleeDeclaration ? functionLikeDeclaration(calleeDeclaration) : undefined;
    if (functionLike && functionReturnsApp(functionLike, context, seen, depth + 1)) return true;
    if (
      ts.isPropertyAccessExpression(expression.expression) ||
      ts.isElementAccessExpression(expression.expression)
    ) {
      if (expressionDerivesFromApp(expression.expression.expression, context, seen, depth + 1)) {
        return true;
      }
    }
    return expression.arguments.some((argument) =>
      expressionDerivesFromApp(argument, context, seen, depth + 1),
    );
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expressionDerivesFromApp(expression.expression, context, seen, depth + 1);
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return functionReturnsApp(expression, context, seen, depth + 1);
  }

  let derives = false;
  const visitChild = (child: ts.Node): void => {
    if (derives || ts.isFunctionLike(child)) return;
    if (ts.isExpression(child) && expressionDerivesFromApp(child, context, seen, depth + 1)) {
      derives = true;
      return;
    }
    ts.forEachChild(child, visitChild);
  };
  ts.forEachChild(expression, visitChild);
  return derives;
}

function declarationDerivesFromApp(
  declaration: ts.Declaration,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48 || seen.has(declaration)) return depth > 48;
  const nextSeen = new Set(seen);
  nextSeen.add(declaration);
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = unwrapExpression(declaration.initializer);
    return (
      proveDirectDefineKovo(declaration, initializer, context) !== undefined ||
      expressionDerivesFromApp(initializer, context, nextSeen, depth + 1)
    );
  }
  if (ts.isBindingElement(declaration)) {
    const variable = enclosingVariableDeclaration(declaration);
    return (
      variable?.initializer !== undefined &&
      expressionDerivesFromApp(variable.initializer, context, nextSeen, depth + 1)
    );
  }
  const functionLike = functionLikeDeclaration(declaration);
  return functionLike ? functionReturnsApp(functionLike, context, nextSeen, depth + 1) : false;
}

function functionReturnsApp(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (!declaration.body) return false;
  if (!ts.isBlock(declaration.body)) {
    return expressionDerivesFromApp(declaration.body, context, seen, depth + 1);
  }
  let derives = false;
  const visit = (node: ts.Node): void => {
    if (derives) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      expressionDerivesFromApp(node.expression, context, seen, depth + 1)
    ) {
      derives = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return derives;
}

function functionContainsAppDeclarationFactory(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
): boolean {
  return firstAppDeclarationFactoryCall(declaration, context) !== undefined;
}

function firstAppDeclarationFactoryCall(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
): ts.CallExpression | undefined {
  if (!declaration.body) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        isDeclarationFamily(callee.name.text) &&
        expressionDerivesFromApp(callee.expression, context, new Set(), 0)
      ) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function firstHiddenAppContractCall(
  sourceFile: ts.SourceFile,
  context: ProvenanceContext,
):
  | {
      readonly call: ts.CallExpression;
      readonly proof: Exclude<FactoryProof, { kind: 'none' }>;
    }
  | undefined {
  let found:
    | {
        readonly call: ts.CallExpression;
        readonly proof: Exclude<FactoryProof, { kind: 'none' }>;
      }
    | undefined;
  const inspectBody = (declaration: AnalyzableFunctionLike): void => {
    if (!declaration.body || found) return;
    const inspect = (node: ts.Node): void => {
      if (found || (node !== declaration.body && ts.isFunctionLike(node))) return;
      if (ts.isCallExpression(node)) {
        const proof = proveFactoryCall(sourceFile, node, context);
        if (proof.kind !== 'none') {
          found = { call: node, proof };
          return;
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(declaration.body);
  };
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isAnalyzableFunctionLike(node)) {
      inspectBody(node);
      if (found) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function functionHasAppDerivedParameterInitializer(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
): boolean {
  return declaration.parameters.some(
    (parameter) =>
      parameter.initializer !== undefined &&
      expressionDerivesFromApp(parameter.initializer, context, new Set(), 0),
  );
}

function functionHasGeneratedFactoryDerivedParameterInitializer(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
): boolean {
  return declaration.parameters.some(
    (parameter) =>
      parameter.initializer !== undefined &&
      expressionDerivesFromGeneratedFactory(parameter.initializer, context, new Set(), 0),
  );
}

function functionInvokesParameter(
  declaration: AnalyzableFunctionLike,
  checker: ts.TypeChecker,
): boolean {
  if (!declaration.body) return false;
  const parameters = new Set(
    declaration.parameters.flatMap((parameter) => {
      if (!ts.isIdentifier(parameter.name)) return [];
      const symbol = checker.getSymbolAtLocation(parameter.name);
      return symbol ? [symbol] : [];
    }),
  );
  if (parameters.size === 0) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      parameters.has(checker.getSymbolAtLocation(unwrapExpression(node.expression))!)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function proveGeneratedAppFactory(
  callSourceFile: ts.SourceFile,
  expression: ts.Identifier,
  context: ProvenanceContext,
): Exclude<FactoryProof, { kind: 'none' }> | undefined {
  const declaration = symbolDeclaration(context.checker, expression);
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    !isDeclarationFamily(declaration.name.text) ||
    !declaration.initializer
  ) {
    return undefined;
  }
  const generatedSourceFile = declaration.getSourceFile();
  const normalizedGeneratedFile = normalizeFileName(generatedSourceFile.fileName);
  if (
    !normalizedGeneratedFile.includes('/.kovo/') ||
    !normalizedGeneratedFile.endsWith('/app.ts')
  ) {
    return undefined;
  }
  if (
    !generatedSourceFile.text.startsWith(
      '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
    ) ||
    !sourceReachesGeneratedModuleThroughKovoAlias(
      callSourceFile,
      generatedSourceFile,
      context,
      new Set(),
      false,
    )
  ) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory identity is not bound to an authenticated #kovo module.',
      ),
      kind: 'diagnostic',
    };
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (
    !ts.isPropertyAccessExpression(initializer) ||
    initializer.name.text !== declaration.name.text
  ) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory does not lower to its exact app receiver.',
      ),
      kind: 'diagnostic',
    };
  }
  const receiver = proveReceiver(
    generatedSourceFile,
    initializer.expression,
    context,
    new Set(),
    0,
  );
  if (receiver.kind !== 'app') {
    return {
      diagnostic: appContractExperimentDiagnostic(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory owner could not be derived from its provider.',
      ),
      kind: 'diagnostic',
    };
  }
  if (
    !generatedModuleMatchesManifest(
      generatedSourceFile,
      receiver.identity,
      receiver.serverPackageRoot,
      context,
    )
  ) {
    return {
      diagnostic: appContractExperimentDiagnostic(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory source, manifest, config, provider, or correlated artifact digest does not match the exact derived contract.',
      ),
      kind: 'diagnostic',
    };
  }
  return {
    exportName: declaration.name.text,
    kind: 'factory',
    ownerKey: receiver.ownerKey,
    serverPackageRoot: receiver.serverPackageRoot,
  };
}

function proveUnsafeGeneratedFactoryCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  context: ProvenanceContext,
): Extract<FactoryProof, { kind: 'diagnostic' }> | undefined {
  const expression = unwrapExpression(call.expression);
  if (isTransferredGeneratedFactoryInvocation(expression, call.arguments, context)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B007',
      'generated app factories may not be invoked through Function.call, Function.apply, or Reflect.apply',
    );
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    isDeclarationFamily(staticMemberName(expression.argumentExpression)) &&
    ts.isIdentifier(unwrapExpression(expression.expression)) &&
    namespaceResolvesToGeneratedApp(
      unwrapExpression(expression.expression) as ts.Identifier,
      context,
    )
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B008',
      'generated app factories require a static named import',
    );
  }
  if (
    (ts.isCallExpression(expression) ||
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    expressionDerivesFromGeneratedFactory(expression, context, new Set(), 0)
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B007',
      'generated app factory binding is indirectly derived',
    );
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = localSymbolDeclaration(context.checker, expression);
  if (declaration && ts.isBindingElement(declaration)) {
    const member = bindingMemberName(declaration);
    const variable = enclosingVariableDeclaration(declaration);
    if (
      member &&
      isDeclarationFamily(member) &&
      variable?.initializer &&
      ts.isIdentifier(unwrapExpression(variable.initializer)) &&
      namespaceResolvesToGeneratedApp(
        unwrapExpression(variable.initializer) as ts.Identifier,
        context,
      )
    ) {
      return generatedDiagnostic(
        sourceFile,
        expression,
        'D1B003',
        'generated app factories may not be destructured from a namespace',
      );
    }
  }
  const functionLike = declaration ? functionLikeDeclaration(declaration) : undefined;
  if (functionLike && functionContainsGeneratedFactoryCall(functionLike, context)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B001',
      'generated app factory wrappers are not an exact generated binding',
    );
  }
  if (!declaration || !ts.isVariableDeclaration(declaration)) return undefined;
  const assignment = firstGeneratedFactoryDerivedAssignment(declaration, context);
  if (
    !declaration.initializer ||
    !expressionDerivesFromGeneratedFactory(declaration.initializer, context, new Set(), 0)
  ) {
    if (assignment) {
      return generatedDiagnostic(
        sourceFile,
        expression,
        assignment.destructured ? 'D1B003' : 'D1B007',
        assignment.destructured
          ? 'generated app factories may not be transferred through destructuring assignments'
          : 'generated app factories may not be transferred through later assignments',
      );
    }
    return undefined;
  }
  if (!variableDeclarationIsConst(declaration)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B004',
      'generated app factory aliases must be const',
    );
  }
  if (variableIsReassigned(declaration, context.checker, context.program)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B005',
      'generated app factory aliases may not be reassigned',
    );
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (ts.isConditionalExpression(initializer) || isJoiningBinaryExpression(initializer)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B006',
      'generated app factory aliases may not join control-flow branches',
    );
  }
  if (
    ts.isElementAccessExpression(initializer) &&
    !ts.isArrayLiteralExpression(unwrapExpression(initializer.expression))
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B002',
      'generated app factories may not be dynamically selected',
    );
  }
  return generatedDiagnostic(
    sourceFile,
    expression,
    'D1B007',
    'generated app factory binding is indirectly derived',
  );
}

function generatedDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: 'D1B001' | 'D1B002' | 'D1B003' | 'D1B004' | 'D1B005' | 'D1B006' | 'D1B007' | 'D1B008',
  detail: string,
): Extract<FactoryProof, { kind: 'diagnostic' }> {
  return {
    diagnostic: appContractExperimentDiagnostic(
      sourceFile,
      node,
      code,
      `${code} ${detail}; import and call the exact #kovo named export.`,
    ),
    kind: 'diagnostic',
  };
}

function expressionDerivesFromGeneratedFactory(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48) return true;
  const expression = unwrapExpression(rawExpression);
  if (ts.isIdentifier(expression)) {
    const direct = proveGeneratedAppFactory(expression.getSourceFile(), expression, context);
    if (direct?.kind === 'factory') return true;
    const declaration = localSymbolDeclaration(context.checker, expression);
    if (!declaration || seen.has(declaration)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(declaration);
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return expressionDerivesFromGeneratedFactory(
        declaration.initializer,
        context,
        nextSeen,
        depth + 1,
      );
    }
    const functionLike = functionLikeDeclaration(declaration);
    return functionLike
      ? functionReturnsGeneratedFactory(functionLike, context, nextSeen, depth + 1)
      : false;
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isIdentifier(expression.expression) &&
      expressionDerivesFromGeneratedFactory(expression.expression, context, seen, depth + 1)
    ) {
      return true;
    }
    const declaration = ts.isIdentifier(expression.expression)
      ? localSymbolDeclaration(context.checker, expression.expression)
      : undefined;
    const functionLike = declaration ? functionLikeDeclaration(declaration) : undefined;
    if (functionLike && functionReturnsGeneratedFactory(functionLike, context, seen, depth + 1)) {
      return true;
    }
  }
  let derives = false;
  const visit = (node: ts.Node): void => {
    if (derives || ts.isFunctionLike(node)) return;
    if (
      ts.isExpression(node) &&
      node !== expression &&
      expressionDerivesFromGeneratedFactory(node, context, seen, depth + 1)
    ) {
      derives = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(expression, visit);
  return derives;
}

function functionReturnsGeneratedFactory(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (!declaration.body) return false;
  if (!ts.isBlock(declaration.body)) {
    return expressionDerivesFromGeneratedFactory(declaration.body, context, seen, depth + 1);
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      expressionDerivesFromGeneratedFactory(node.expression, context, seen, depth + 1)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function functionContainsGeneratedFactoryCall(
  declaration: AnalyzableFunctionLike,
  context: ProvenanceContext,
): boolean {
  if (!declaration.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      proveGeneratedAppFactory(node.getSourceFile(), node.expression, context)?.kind === 'factory'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function namespaceResolvesToGeneratedApp(
  expression: ts.Identifier,
  context: ProvenanceContext,
): boolean {
  const declaration = localSymbolDeclaration(context.checker, expression);
  if (!declaration || !ts.isNamespaceImport(declaration)) return false;
  const importDeclaration = declaration.parent.parent;
  if (
    !ts.isImportDeclaration(importDeclaration) ||
    !ts.isStringLiteralLike(importDeclaration.moduleSpecifier) ||
    importDeclaration.moduleSpecifier.text !== '#kovo'
  ) {
    return false;
  }
  const resolved = resolveModule(
    importDeclaration.moduleSpecifier.text,
    importDeclaration.getSourceFile().fileName,
    context.options,
  );
  if (!resolved) return false;
  const target =
    context.program.getSourceFile(resolved.resolvedFileName) ??
    context.program
      .getSourceFiles()
      .find(
        (candidate) =>
          normalizeFileName(candidate.fileName) === normalizeFileName(resolved.resolvedFileName),
      );
  return (
    target !== undefined &&
    normalizeFileName(target.fileName).includes('/.kovo/') &&
    generatedModuleHasMatchingSelfDigest(target)
  );
}

function sourceReachesGeneratedModuleThroughKovoAlias(
  sourceFile: ts.SourceFile,
  generatedSourceFile: ts.SourceFile,
  context: ProvenanceContext,
  seen: Set<string>,
  aliasObserved: boolean,
): boolean {
  const seenKey = `${normalizeFileName(sourceFile.fileName)}:${String(aliasObserved)}`;
  if (seen.has(seenKey)) return false;
  seen.add(seenKey);
  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier
        : undefined;
    if (!moduleSpecifier) continue;
    const resolved = resolveModule(moduleSpecifier.text, sourceFile.fileName, context.options);
    if (!resolved) continue;
    const nextAliasObserved = aliasObserved || moduleSpecifier.text === '#kovo';
    const normalizedResolved = normalizeFileName(resolved.resolvedFileName);
    if (
      nextAliasObserved &&
      normalizedResolved === normalizeFileName(generatedSourceFile.fileName)
    ) {
      return true;
    }
    const dependency =
      context.program.getSourceFile(resolved.resolvedFileName) ??
      context.program
        .getSourceFiles()
        .find((candidate) => normalizeFileName(candidate.fileName) === normalizedResolved);
    if (
      dependency &&
      sourceReachesGeneratedModuleThroughKovoAlias(
        dependency,
        generatedSourceFile,
        context,
        seen,
        nextAliasObserved,
      )
    ) {
      return true;
    }
  }
  return false;
}

function generatedModuleHasMatchingSelfDigest(sourceFile: ts.SourceFile): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(sourceFile.fileName), 'app.manifest.json'), 'utf8'),
    ) as {
      generatedModuleSha256?: unknown;
      schema?: unknown;
    };
    return (
      manifest.schema === 'kovo.generated-app-contract/v6' &&
      manifest.generatedModuleSha256 === createHash('sha256').update(sourceFile.text).digest('hex')
    );
  } catch {
    return false;
  }
}

function generatedModuleMatchesManifest(
  sourceFile: ts.SourceFile,
  identity: DerivedAppContractIdentity,
  serverPackageRoot: string,
  context: ProvenanceContext,
): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(sourceFile.fileName), 'app.manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const manifestKeys = [
      'appId',
      'compilerSourceSha256',
      'completed',
      'configSha256',
      'generatedModuleSha256',
      'ownerKey',
      'providerExportBinding',
      'providerImportSpecifier',
      'providerKey',
      'providerSourceSha256',
      'schema',
      'serverPackedContentsSha256',
    ] as const;
    if (
      !exactObjectKeys(manifest, manifestKeys) ||
      manifest.schema !== 'kovo.generated-app-contract/v6' ||
      manifest.completed !== 'complete' ||
      manifest.appId !== identity.appId ||
      manifest.ownerKey !== identity.ownerKey ||
      manifest.providerExportBinding !== identity.providerExportBinding ||
      manifest.providerImportSpecifier !== identity.providerImportSpecifier ||
      manifest.providerKey !== identity.providerKey ||
      !isSha256(manifest.compilerSourceSha256) ||
      !isSha256(manifest.serverPackedContentsSha256) ||
      manifest.generatedModuleSha256 !== sha256Text(sourceFile.text)
    ) {
      return false;
    }
    const providerSource = readFileSync(identity.providerDefinitionFileName, 'utf8');
    const providerSourceFile = programSourceFile(
      context.program,
      identity.providerDefinitionFileName,
    );
    if (
      !providerSourceFile ||
      providerSourceFile.text !== providerSource ||
      manifest.providerSourceSha256 !== sha256Text(providerSource)
    ) {
      return false;
    }
    // v6 carries compiler/server digests but exposes no independent production trust root for them.
    // The resolver can require their exact shape and source/manifest correlation; the sealed
    // conformance evaluator remains responsible for authenticating those two external artifacts.
    const configFileName = join(dirname(identity.providerAppFileName), 'kovo.config.ts');
    const configSource = readFileSync(configFileName, 'utf8');
    const configSourceFile = programSourceFile(context.program, configFileName);
    if (
      !configSourceFile ||
      configSourceFile.text !== configSource ||
      manifest.configSha256 !== sha256Text(configSource) ||
      !configSourceMatchesIdentity(configSourceFile, identity)
    ) {
      return false;
    }
    const packageManifest = JSON.parse(
      readFileSync(join(serverPackageRoot, 'package.json'), 'utf8'),
    ) as { readonly name?: unknown };
    if (packageManifest.name !== '@kovojs/server') return false;
    return (
      sourceFile.text ===
      expectedGeneratedModuleSource(
        sourceFile.fileName,
        identity,
        manifest.compilerSourceSha256,
        manifest.serverPackedContentsSha256,
      )
    );
  } catch {
    return false;
  }
}

function configSourceMatchesIdentity(
  sourceFile: ts.SourceFile,
  identity: DerivedAppContractIdentity,
): boolean {
  const assignment = sourceFile.statements.find(ts.isExportAssignment);
  if (!assignment) return false;
  const object = objectLiteralFromFreeze(assignment.expression);
  if (
    !object ||
    !exactPropertyNames(object, [
      'appId',
      'provider',
      'providerExportBinding',
      'providerImportSpecifier',
      'providerKey',
    ]) ||
    stringProperty(object, 'appId') !== identity.appId ||
    stringProperty(object, 'providerExportBinding') !== identity.providerExportBinding ||
    stringProperty(object, 'providerImportSpecifier') !== identity.providerImportSpecifier ||
    stringProperty(object, 'providerKey') !== identity.providerKey ||
    identifierPropertyValue(object, 'provider') !== identity.providerExportBinding
  ) {
    return false;
  }
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === identity.providerImportSpecifier &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (specifier) =>
          (specifier.propertyName?.text ?? specifier.name.text) ===
            identity.providerExportBinding &&
          specifier.name.text === identity.providerExportBinding,
      ),
  );
}

function objectLiteralFromFreeze(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (
    !ts.isCallExpression(unwrapped) ||
    unwrapped.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(unwrapped.expression) ||
    !ts.isIdentifier(unwrapped.expression.expression) ||
    unwrapped.expression.expression.text !== 'Object' ||
    unwrapped.expression.name.text !== 'freeze'
  ) {
    return undefined;
  }
  const argument = unwrapExpression(unwrapped.arguments[0]!);
  return ts.isObjectLiteralExpression(argument) ? argument : undefined;
}

function expectedGeneratedModuleSource(
  generatedFileName: string,
  identity: DerivedAppContractIdentity,
  compilerSourceSha256: string,
  serverPackedContentsSha256: string,
): string {
  const relativeProvider = relative(dirname(generatedFileName), identity.providerAppFileName)
    .replaceAll('\\', '/')
    .replace(/\.[cm]?tsx?$/u, '.js');
  const providerImport = relativeProvider.startsWith('.')
    ? relativeProvider
    : `./${relativeProvider}`;
  return [
    '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
    `import { ${identity.providerAppExportName} as app } from ${singleQuotedTypeScriptString(providerImport)};`,
    "export { publicAccess } from '@kovojs/server';",
    'export const __kovoGeneratedContract = Object.freeze({',
    `  appId: ${singleQuotedTypeScriptString(identity.appId)},`,
    `  compilerSourceSha256: ${singleQuotedTypeScriptString(compilerSourceSha256)},`,
    `  ownerKey: ${singleQuotedTypeScriptString(identity.ownerKey)},`,
    `  providerExportBinding: ${singleQuotedTypeScriptString(identity.providerExportBinding)},`,
    `  providerImportSpecifier: ${singleQuotedTypeScriptString(identity.providerImportSpecifier)},`,
    `  providerKey: ${singleQuotedTypeScriptString(identity.providerKey)},`,
    `  serverPackedContentsSha256: ${singleQuotedTypeScriptString(serverPackedContentsSha256)},`,
    '});',
    'export const endpoint: typeof app.endpoint = app.endpoint;',
    'export const layout: typeof app.layout = app.layout;',
    'export const mutation: typeof app.mutation = app.mutation;',
    'export const query: typeof app.query = app.query;',
    'export const route: typeof app.route = app.route;',
    'export const task: typeof app.task = app.task;',
    '',
  ].join('\n');
}

function singleQuotedTypeScriptString(value: string): string {
  const json = JSON.stringify(value);
  return `'${json
    .slice(1, -1)
    .replaceAll("'", "\\'")
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`;
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  return (
    actual.length === orderedExpected.length &&
    actual.every((entry, index) => entry === orderedExpected[index])
  );
}

function exactPropertyNames(
  object: ts.ObjectLiteralExpression,
  expected: readonly string[],
): boolean {
  const actual = object.properties.flatMap((property) => {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    ) {
      return [property.name.text];
    }
    return [];
  });
  return (
    actual.length === object.properties.length &&
    exactObjectKeys(Object.fromEntries(actual.map((name) => [name, true])), expected)
  );
}

function identifierPropertyValue(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name))
    ) {
      const value = unwrapExpression(property.initializer);
      return ts.isIdentifier(value) ? value.text : undefined;
    }
  }
  return undefined;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function functionContainsDeclarationFactoryAccess(declaration: AnalyzableFunctionLike): boolean {
  if (!declaration.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        isDeclarationFamily(node.expression.name.text)) ||
        (ts.isElementAccessExpression(node.expression) &&
          node.expression.argumentExpression !== undefined &&
          isDeclarationFamily(staticMemberName(node.expression.argumentExpression))))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function expressionIsBoundAppFactory(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
): boolean {
  const expression = unwrapExpression(rawExpression);
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== 'bind'
  ) {
    return false;
  }
  const target = expression.expression.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    isDeclarationFamily(target.name.text) &&
    expressionDerivesFromApp(target.expression, context, new Set(), 0)
  );
}

function isTransferredAppFactoryInvocation(
  rawExpression: ts.Expression,
  arguments_: readonly ts.Expression[],
  context: ProvenanceContext,
): boolean {
  const expression = unwrapExpression(rawExpression);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Reflect' &&
    expression.name.text === 'apply'
  ) {
    const target = arguments_[0] && unwrapExpression(arguments_[0]);
    return (
      target !== undefined &&
      ts.isPropertyAccessExpression(target) &&
      isDeclarationFamily(target.name.text) &&
      expressionDerivesFromApp(target.expression, context, new Set(), 0)
    );
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === 'call' || expression.name.text === 'apply')
  ) {
    const target = unwrapExpression(expression.expression);
    return (
      ts.isPropertyAccessExpression(target) &&
      isDeclarationFamily(target.name.text) &&
      expressionDerivesFromApp(target.expression, context, new Set(), 0)
    );
  }
  return false;
}

function isTransferredGeneratedFactoryInvocation(
  rawExpression: ts.Expression,
  arguments_: readonly ts.Expression[],
  context: ProvenanceContext,
): boolean {
  const expression = unwrapExpression(rawExpression);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Reflect' &&
    expression.name.text === 'apply'
  ) {
    const target = arguments_[0];
    return (
      target !== undefined && expressionDerivesFromGeneratedFactory(target, context, new Set(), 0)
    );
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === 'call' || expression.name.text === 'apply')
  ) {
    return expressionDerivesFromGeneratedFactory(expression.expression, context, new Set(), 0);
  }
  return false;
}

function firstAppProviderDynamicImport(
  sourceFile: ts.SourceFile,
  context: ProvenanceContext,
): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      dynamicImportTargetContainsApp(
        node.arguments[0]!.text,
        sourceFile.fileName,
        context,
        new Set(),
      )
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function dynamicImportTargetContainsApp(
  specifier: string,
  importer: string,
  context: ProvenanceContext,
  seen: Set<string>,
): boolean {
  const resolved = resolveModule(specifier, importer, context.options);
  if (!resolved) return false;
  const normalized = normalizeFileName(resolved.resolvedFileName);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const target =
    context.program.getSourceFile(resolved.resolvedFileName) ??
    context.program
      .getSourceFiles()
      .find((candidate) => normalizeFileName(candidate.fileName) === normalized);
  if (!target) return false;
  let direct = false;
  const visit = (node: ts.Node): void => {
    if (direct) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      proveDirectDefineKovo(node, unwrapExpression(node.initializer), context)
    ) {
      direct = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(target);
  if (direct) return true;
  for (const statement of target.statements) {
    if (
      ts.isExportAssignment(statement) &&
      expressionDerivesFromApp(statement.expression, context, new Set(), 0)
    ) {
      return true;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          declaration.initializer !== undefined &&
          expressionDerivesFromApp(declaration.initializer, context, new Set(), 0),
      )
    ) {
      return true;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((specifier) =>
        expressionDerivesFromApp(specifier.propertyName ?? specifier.name, context, new Set(), 0),
      )
    ) {
      return true;
    }
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    if (
      dynamicImportTargetContainsApp(statement.moduleSpecifier.text, target.fileName, context, seen)
    ) {
      return true;
    }
  }
  return false;
}

function serverPackageRootForDefineKovo(
  expression: ts.Identifier,
  checker: ts.TypeChecker,
): string | undefined {
  let symbol = checker.getSymbolAtLocation(expression);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  if (!symbol || symbol.getName() !== 'defineKovo') return undefined;
  for (const declaration of symbol.declarations ?? []) {
    const root = tryRealServerPackageRoot(declaration.getSourceFile().fileName);
    if (root) return root;
  }
  return undefined;
}

function variableIsReassigned(
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
  program: ts.Program,
): boolean {
  if (!ts.isIdentifier(declaration.name)) return true;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return true;
  const roots = new Set(program.getRootFileNames().map(normalizeFileName));
  for (const sourceFile of program.getSourceFiles()) {
    if (!roots.has(normalizeFileName(sourceFile.fileName))) continue;
    let reassigned = false;
    const visit = (node: ts.Node): void => {
      if (reassigned) return;
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        ts.isIdentifier(unwrapExpression(node.left)) &&
        checker.getSymbolAtLocation(unwrapExpression(node.left)) === symbol
      ) {
        reassigned = true;
        return;
      }
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isIdentifier(node.operand) &&
        checker.getSymbolAtLocation(node.operand) === symbol
      ) {
        reassigned = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (reassigned) return true;
  }
  return false;
}

function firstAppDerivedAssignment(
  declaration: ts.VariableDeclaration,
  context: ProvenanceContext,
): { readonly destructured: boolean; readonly node: ts.BinaryExpression } | undefined {
  if (!ts.isIdentifier(declaration.name)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return undefined;
  const roots = new Set(context.program.getRootFileNames().map(normalizeFileName));
  for (const sourceFile of context.program.getSourceFiles()) {
    if (!roots.has(normalizeFileName(sourceFile.fileName))) continue;
    let found: { readonly destructured: boolean; readonly node: ts.BinaryExpression } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        assignmentTargetContainsSymbol(node.left, symbol, context.checker) &&
        expressionDerivesFromApp(node.right, context, new Set(), 0)
      ) {
        found = {
          destructured: !ts.isIdentifier(unwrapExpression(node.left)),
          node,
        };
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (found) return found;
  }
  return undefined;
}

function firstGeneratedFactoryDerivedAssignment(
  declaration: ts.VariableDeclaration,
  context: ProvenanceContext,
): { readonly destructured: boolean; readonly node: ts.BinaryExpression } | undefined {
  if (!ts.isIdentifier(declaration.name)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return undefined;
  const roots = new Set(context.program.getRootFileNames().map(normalizeFileName));
  for (const sourceFile of context.program.getSourceFiles()) {
    if (!roots.has(normalizeFileName(sourceFile.fileName))) continue;
    let found: { readonly destructured: boolean; readonly node: ts.BinaryExpression } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        assignmentTargetContainsSymbol(node.left, symbol, context.checker) &&
        expressionDerivesFromGeneratedFactory(node.right, context, new Set(), 0)
      ) {
        found = {
          destructured: !ts.isIdentifier(unwrapExpression(node.left)),
          node,
        };
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (found) return found;
  }
  return undefined;
}

function assignmentTargetContainsSymbol(
  expression: ts.Expression,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isShorthandPropertyAssignment(node) &&
      checker.getShorthandAssignmentValueSymbol(node) === symbol
    ) {
      found = true;
      return;
    }
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function reachableServerPackageRoots(entry: ts.SourceFile, context: ProvenanceContext): string[] {
  const roots: string[] = [];
  const visited = new Set<string>();
  const visit = (sourceFile: ts.SourceFile): void => {
    const normalized = normalizeFileName(sourceFile.fileName);
    if (visited.has(normalized)) return;
    visited.add(normalized);
    for (const statement of sourceFile.statements) {
      const moduleSpecifier =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier
          : undefined;
      if (!moduleSpecifier) continue;
      const specifier = moduleSpecifier.text;
      const resolved = resolveModule(specifier, sourceFile.fileName, context.options);
      if (!resolved) continue;
      const root = tryRealServerPackageRoot(resolved.resolvedFileName);
      if (
        root &&
        (specifier === '@kovojs/server' ||
          specifier.startsWith('@kovojs/server/') ||
          resolved.packageId?.name === '@kovojs/server')
      ) {
        roots.push(root);
        continue;
      }
      const dependency =
        context.program.getSourceFile(resolved.resolvedFileName) ??
        context.program
          .getSourceFiles()
          .find(
            (candidate) =>
              normalizeFileName(candidate.fileName) ===
              normalizeFileName(resolved.resolvedFileName),
          );
      if (dependency) visit(dependency);
    }
  };
  visit(entry);
  return unique(roots);
}

function resolveModule(
  specifier: string,
  importer: string,
  options: ts.CompilerOptions,
): ts.ResolvedModuleFull | undefined {
  return ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
}

function tryRealServerPackageRoot(resolvedFileName: string): string | undefined {
  let cursor: string;
  try {
    cursor = dirname(realpathSync(resolvedFileName));
  } catch {
    return undefined;
  }
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(cursor, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      if (manifest.name === '@kovojs/server') return realpathSync(cursor);
    } catch {
      // Keep walking to the physical package root.
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

function snapshotRootDirectory(raw: CreateCompilerOwnedAppContractProjectOptions): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('App-contract project options must be an object.');
  }
  const rootDirectory = raw.rootDirectory ?? process.cwd();
  if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
    throw new TypeError('App-contract project options.rootDirectory must be a non-empty string.');
  }
  return resolve(rootDirectory);
}

function snapshotRootNames(
  raw: CreateCompilerOwnedAppContractProjectOptions,
  rootDirectory: string,
): readonly string[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.rootNames)) {
    throw new TypeError('App-contract project options.rootNames must be an own array.');
  }
  const names = raw.rootNames.map((fileName, index) => {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new TypeError(`App-contract project rootNames[${index}] must be a non-empty string.`);
    }
    return resolve(rootDirectory, fileName);
  });
  if (names.length === 0) throw new TypeError('App-contract project needs at least one root file.');
  return Object.freeze([...new Set(names)].sort());
}

function appContractCompilerOptions(): ts.CompilerOptions {
  return {
    allowJs: true,
    allowImportingTsExtensions: true,
    exactOptionalPropertyTypes: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@kovojs/server',
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    preserveSymlinks: false,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
}

function expressionContainsDeclarationFactoryAccess(expression: ts.Expression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyAccessExpression(node) && isDeclarationFamily(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        isDeclarationFamily(staticMemberName(node.argumentExpression)))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function firstTopLevelCall(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== sourceFile && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function symbolDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(identifier);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function localSymbolDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.Declaration | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function functionLikeDeclaration(declaration: ts.Declaration): AnalyzableFunctionLike | undefined {
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (ts.isMethodDeclaration(declaration)) return declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function functionLikeForExpression(
  rawExpression: ts.Expression,
  checker: ts.TypeChecker,
): AnalyzableFunctionLike | undefined {
  const expression = unwrapExpression(rawExpression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  if (ts.isIdentifier(expression)) {
    const declaration = localSymbolDeclaration(checker, expression);
    return declaration ? functionLikeDeclaration(declaration) : undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const symbol = checker.getSymbolAtLocation(expression.name);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration ? functionLikeDeclaration(declaration) : undefined;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const symbol = checker.getSymbolAtLocation(expression.argumentExpression);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration ? functionLikeDeclaration(declaration) : undefined;
  }
  return undefined;
}

function isAnalyzableFunctionLike(node: ts.Node): node is AnalyzableFunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function enclosingVariableDeclaration(node: ts.Node): ts.VariableDeclaration | undefined {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isVariableDeclaration(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

function bindingMemberName(binding: ts.BindingElement): string | undefined {
  const property = binding.propertyName ?? binding.name;
  return ts.isIdentifier(property) || ts.isStringLiteralLike(property) ? property.text : undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText(object.getSourceFile()) === name &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return undefined;
}

function hasStaticProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name)),
  );
}

function staticMemberName(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

function variableDeclarationIsConst(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isJoiningBinaryExpression(expression: ts.Expression): expression is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function appContractExperimentDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: CompilerOwnedAppContractDiagnostic['code'],
  message: string,
): CompilerOwnedAppContractDiagnostic {
  const start = node.getStart(sourceFile);
  return {
    code,
    fileName: normalizeFileName(sourceFile.fileName),
    length: Math.max(1, node.getEnd() - start),
    message,
    start,
  };
}

function dedupeDiagnostics(
  diagnostics: readonly CompilerOwnedAppContractDiagnostic[],
): CompilerOwnedAppContractDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.fileName}:${diagnostic.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDeclarationFamily(value: string | undefined): value is AppContractDeclarationFamily {
  return (
    typeof value === 'string' &&
    (appContractDeclarationFamilies as readonly string[]).includes(value)
  );
}

function isAppContractMemberName(value: string): value is AppContractMemberName {
  return (appContractMemberNames as readonly string[]).includes(value);
}

/**
 * Negative-only type filter for same-named members on values produced from an app token.
 *
 * SPEC §§5.2 rule 12, 6.2.1, and 12 require compiler-owned symbol/receiver provenance for a
 * declaration while also making `createKovoTestHarness(app).query(...)` an ordinary supported
 * testing path. Passing an app token to another API does not make every value it returns a
 * declaration owner. A definitely unrelated receiver (for example `KovoTestContext`, which has
 * `query` but not the closed declaration-owner surface) can therefore be ignored before the
 * conservative provenance walk.
 *
 * This shape test never grants authority: ambiguous types remain candidates, and a positive result
 * must still pass `proveReceiver()`'s exact defineKovo symbol, immutable binding, package, and owner
 * checks.
 */
function receiverTypeCouldBeAppContract(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return typeCouldBeAppContract(checker.getTypeAtLocation(expression), checker, new Set(), 0);
}

function typeCouldBeAppContract(
  type: ts.Type,
  checker: ts.TypeChecker,
  seen: Set<ts.Type>,
  depth: number,
): boolean {
  if (depth > 16 || seen.has(type)) return true;
  if (
    (type.flags &
      (ts.TypeFlags.Any |
        ts.TypeFlags.Unknown |
        ts.TypeFlags.TypeParameter |
        ts.TypeFlags.IndexedAccess |
        ts.TypeFlags.Conditional |
        ts.TypeFlags.Substitution)) !==
    0
  ) {
    return true;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(type);
  if (type.isUnion()) {
    return type.types.some((candidate) =>
      typeCouldBeAppContract(candidate, checker, nextSeen, depth + 1),
    );
  }
  return [...appContractDeclarationFamilies, 'assemble'].every(
    (member) => checker.getPropertyOfType(type, member) !== undefined,
  );
}

function normalizeFileName(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function programSourceFile(program: ts.Program, fileName: string): ts.SourceFile | undefined {
  const normalized = normalizeFileName(fileName);
  const absolute = normalizeFileName(resolve(fileName));
  return (
    program.getSourceFile(fileName) ??
    program.getSourceFiles().find((candidate) => {
      const candidateName = normalizeFileName(candidate.fileName);
      return candidateName === normalized || normalizeFileName(resolve(candidateName)) === absolute;
    })
  );
}

function countHandlerRoots(value: unknown): number {
  return JSON.stringify(value).split('"kind":"server.handler.root"').length - 1;
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
