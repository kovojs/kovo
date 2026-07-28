import type { ContentSubject, FileSubject, PackedCompilerEntrypoint } from './artifacts-v5.ts';
import type {
  AppContractArm,
  DeclarationFamily,
  MatrixCaseName,
  PrototypeDiagnostic,
} from './fixture-v5.ts';
import type { CanonicalSemanticSubject, FamilyEvidence, MatrixEvidence } from './project-v5.ts';
import type { RuntimeArmEvidence } from './runtime-v5.ts';
import type {
  SuccessfulTypeMeasurement,
  TypeDiagnosticEvidence,
  TypeMeasurementEvidence,
} from './type-measurement-v5.ts';

export interface D1CriteriaV5 {
  readonly artifactThresholds: {
    readonly exactPackageNames: readonly string[];
    readonly generatedManifestDigestFieldsRequired: readonly string[];
  };
  readonly declarationFamilies: readonly DeclarationFamily[];
  readonly diagnosticThresholds: {
    readonly crossAppDiagnosticCode: string;
    readonly duplicatePackageDiagnosticCode: string;
    readonly matrixDiagnosticMessageCharactersMaximum: number;
    readonly matrixDiagnosticSpanCharactersMaximum: number;
    readonly messageCharactersMaximum: number;
    readonly misspelledProperty: string;
    readonly spanLength: number;
    readonly suggestedProperty: string;
    readonly typescriptCode: number;
  };
  readonly evidenceBindingContract: {
    readonly mutations: Readonly<Record<string, string>>;
  };
  readonly immutableReceiverContract: {
    readonly unrelatedSameNamedMemberMustRemainUnrecognized: boolean;
    readonly unprovedAppDerivedCallMustDiagnose: boolean;
  };
  readonly matrix: Readonly<
    Record<MatrixCaseName, Readonly<Record<AppContractArm, 'accept' | `reject:${string}`>>>
  >;
  readonly performanceThresholds: {
    readonly coldCompletionP50DeltaPercentMaximum: number;
    readonly coldCompletionRepeats: number;
    readonly coldTscP50DeltaPercentMaximum: number;
    readonly coldTscRepeats: number;
    readonly completionCandidateCountMustEqualBaseline: boolean;
    readonly completionCandidateDigestMustEqualBaseline: boolean;
    readonly completeSixOrderBlocksRequired: boolean;
    readonly declarationBytesDeltaPercentMaximum: number;
    readonly runnerMetadataRequired: readonly string[];
    readonly warmCompletionP95DeltaPercentMaximum: number;
    readonly warmCompletionP95MillisecondsMaximum: number;
    readonly warmCompletionRepeats: number;
    readonly warmTscP50DeltaPercentMaximum: number;
    readonly warmTscRepeats: number;
  };
  readonly resolverIntegrityMutations: Readonly<Record<string, string>>;
  readonly schema: 'kovo.app-contract-d1-criteria/v5';
  readonly semanticEquivalenceContract: {
    readonly mutations: Readonly<Record<string, string>>;
  };
  readonly semanticThresholds: Readonly<Record<string, number>>;
  readonly workload: {
    readonly declarationFilesPerVariant: number;
    readonly declarationsPerFile: number;
    readonly [key: string]: number;
  };
}

export interface StablePackageArtifact {
  readonly name: string;
  readonly packedContents: ContentSubject;
  readonly sourceContents: ContentSubject;
  readonly sourceSha256: string;
}

export interface GeneratedManifestEvidence {
  readonly appId: string;
  readonly compilerSourceSha256: string;
  readonly completed: string;
  readonly configSha256: string;
  readonly generatedModuleSha256: string;
  readonly ownerKey: string;
  readonly providerKey: string;
  readonly providerSourceSha256: string;
  readonly schema: string;
  readonly serverPackedContentsSha256: string;
}

export interface GeneratedContractEvidence {
  readonly configSubject: FileSubject;
  readonly generatedModuleSubject: FileSubject;
  readonly manifest: GeneratedManifestEvidence;
  readonly providerSubject: FileSubject;
}

export interface D1RawEvidenceV5 {
  readonly schema: 'kovo.app-contract-d1-raw-evidence/v5';
  readonly provenance: {
    readonly buildCommands: readonly string[];
    readonly frameworkHeadCommit: string;
    readonly frameworkSourceCommit: string;
    readonly frameworkSourceContents: ContentSubject;
    readonly frameworkSourceTreeClean: boolean;
    readonly packages: readonly StablePackageArtifact[];
    readonly packedCompiler: {
      readonly entrypoints: readonly PackedCompilerEntrypoint[];
      readonly schema: 'kovo.app-contract-d1-packed-compiler/v1';
      readonly workspaceSourceResolutionForbidden: boolean;
    };
  };
  readonly fixture: {
    readonly counts: Readonly<Record<string, number>>;
    readonly ownerKey: string;
    readonly serverCopies: readonly {
      readonly basePackedContentsSha256: string;
      readonly physicalRoot: string;
    }[];
  };
  readonly matrix: Readonly<
    Record<MatrixCaseName, Readonly<Record<AppContractArm, MatrixEvidence>>>
  >;
  readonly compiler: {
    readonly combinedGraphs: Readonly<
      Record<AppContractArm | 'baseline', CanonicalSemanticSubject>
    >;
    readonly families: Readonly<
      Record<DeclarationFamily, Readonly<Record<AppContractArm | 'baseline', FamilyEvidence>>>
    >;
  };
  readonly receiverFlow: {
    readonly nestedAppDerived: MatrixEvidence;
    readonly unrelatedSameNamedMember: MatrixEvidence;
  };
  readonly resolverIntegrity: Readonly<Record<string, readonly PrototypeDiagnostic[]>>;
  readonly semanticEquivalence: {
    readonly mutationDiagnostics: Readonly<Record<string, readonly PrototypeDiagnostic[]>>;
  };
  readonly evidenceBindings: {
    readonly mutationDiagnostics: Readonly<Record<string, readonly PrototypeDiagnostic[]>>;
  };
  readonly generation: {
    readonly armB: {
      readonly compilerRecognitionDiagnostics: readonly PrototypeDiagnostic[];
      readonly contracts: readonly GeneratedContractEvidence[];
      readonly mutationDiagnostics: Readonly<Record<string, readonly PrototypeDiagnostic[]>>;
    };
  };
  readonly runtime: Readonly<Record<AppContractArm, RuntimeArmEvidence>>;
  readonly publicForgery: {
    readonly fakeAccessAsPublicAccess: {
      readonly componentPublicAccess: boolean;
      readonly routePublicAccess: boolean;
    };
    readonly fakeHtmlAsTrustedHtml: {
      readonly diagnosticCodes: readonly string[];
      readonly recognizedTrustedHtml: boolean;
    };
    readonly forbiddenOptionNamesPresent: readonly string[];
  };
  readonly diagnostics: Readonly<Record<AppContractArm | 'baseline', TypeDiagnosticEvidence>>;
  readonly measurements: Readonly<Record<AppContractArm | 'baseline', SuccessfulTypeMeasurement>>;
  readonly runner: TypeMeasurementEvidence['runner'];
  readonly schedules: TypeMeasurementEvidence['schedules'];
}

export interface EvaluationGate {
  readonly details: readonly string[];
  readonly pass: boolean;
}

export interface ArmEvaluation {
  readonly eligible: boolean;
  readonly gates: {
    readonly artifacts: EvaluationGate;
    readonly compilerAndGraph: EvaluationGate;
    readonly diagnostics: EvaluationGate;
    readonly matrix: EvaluationGate;
    readonly ownershipAndBindings: EvaluationGate;
    readonly performance: EvaluationGate;
    readonly publicForgery: EvaluationGate;
  };
}

export interface D1EvaluationV5 {
  readonly arms: Readonly<Record<AppContractArm, ArmEvaluation>>;
  readonly criteria: 'kovo.app-contract-d1-criteria/v5';
  readonly decision: 'arm-a' | 'arm-b' | 'fallback';
  readonly priorEvidenceDisposition: {
    readonly v1: 'invalidated';
    readonly v2: 'invalidated';
    readonly v3: 'invalidated';
    readonly v4: 'invalidated';
  };
  readonly schema: 'kovo.app-contract-d1-evaluation/v5';
}

export type { FileSubject };
