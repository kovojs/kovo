#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { checkDiagnosticsRegistryEquality } from '../site/scripts/diagnostics-ref.mjs';
import {
  diagnosticSpecPath,
  generatedDiagnosticRegistryPath,
  parseDiagnosticSpecRegistry,
  renderGeneratedDiagnosticRegistry,
} from './generate-diagnostic-registry.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const diagnosticConformanceEvidencePath = 'security/diagnostic-conformance-evidence.json';
export const diagnosticConformanceSchema = 'kovo.diagnostic-conformance-evidence/v2';

const diagnosticActualLayers = Object.freeze([
  'compile-error',
  'fail-closed-runtime',
  'audited-escape',
]);

const compilerMatrixKind = 'compiler-matrix';
const fixturesKind = 'fixtures';
const reviewedZeroEmissionKind = 'reviewed-zero-emission';
const coreDiagnosticsPath = 'packages/core/src/diagnostics.ts';
const coreInternalDiagnosticsPath = 'packages/core/src/internal/diagnostics.ts';
const generatedDiagnosticRegistryModulePath =
  'packages/core/src/internal/diagnostic-registry.generated.ts';
const compilerDiagnosticsPath = 'packages/compiler/src/diagnostics.ts';
const compilerCompilePath = 'packages/compiler/src/compile.ts';
const compilerValidatorPipelinePath = 'packages/compiler/src/validate/pipeline.ts';
const drizzleStaticPath = 'packages/drizzle/src/static.ts';
const serverBuildSecurityIntrinsicsPath = 'packages/server/src/build-security-intrinsics.ts';
const serverSecurityWitnessIntrinsicsPath = 'packages/server/src/security-witness-intrinsics.ts';
const verifierDiagnosticsPath = 'packages/test/src/verifier-diagnostics.ts';
const verifierSecurityIntrinsicsPath = 'packages/test/src/verifier-security-intrinsics.ts';
const rootDiagnosticDoor = `${coreDiagnosticsPath}#createRegisteredDiagnostic`;
const derivedDiagnosticDoor = `${coreDiagnosticsPath}#deriveRegisteredDiagnostic`;
const staticExportDiagnosticRehydrationDoor =
  'packages/server/src/static-export-diagnostics.ts#rehydrateStaticExportCompileDiagnostic';
const sqlSafetyDiagnosticRehydrationDoor =
  'packages/server/src/internal/data-plane-static-analysis.ts#rehydrateSerializedSqlSafetyDiagnostic';
const transferredSqlSafetyDiagnosticRegistrarDoor =
  'packages/server/src/internal/data-plane-static-analysis.ts#registerTransferredSqlSafetyDiagnostic';
const diagnosticFactoryDoor = `${compilerDiagnosticsPath}#diagnosticAt`;
const generatedDiagnosticConstructorDoor = `${coreDiagnosticsPath}#createDiagnosticConstructor`;
const expectedDiagnosticEmissionSiteDigest =
  'e4a3a478ce260c0f18f1d8d53c947f2aecbfcdffdf7e9cc62e8ac30f62962309';
const expectedRootDiagnosticDoorDigest =
  '1660c7877e7a533c282cf38c291a10181bc2e7484d76f479f1d1f41cd51dac77';
const expectedRegisteredDiagnosticGuardDigest =
  '5e62f57e439e251c874e93ca959395c34f039a98f2e201d4b0a12d148a2defce';
const expectedRegisteredDiagnosticAssertionDigest =
  '2d4f399c61a679f28a081902b5464a2009a92dd3b24c198ca1aee6b3a0313c26';
const expectedDerivedDiagnosticDoorDigest =
  '45d97a10f0537ad7fcdbcfc806e9ce227ba5a157e73eaab13e108717f4d7e63a';
const expectedStaticExportDiagnosticRehydrationDoorDigest =
  '38e9f176edf8a6520ec7884e2e05d0d86c6a44938fd11c2a370a789f84ce704c';
const expectedSqlSafetyDiagnosticRehydrationDoorDigest =
  'a57280e38f41d9b9de108369fc46f7ec0b25c829f8178657106d5e7446662e90';
const expectedTransferredSqlSafetyDiagnosticRegistrarDigest =
  '2cdea2713c1c594bb2a1453d69505a98bab9a45b1d5e0a9cb87b557a3482f4c1';
const expectedTransferredSqlSafetyDiagnosticRegistrarCallDigest =
  'f77774b825b0aba3838916197593b585a5ad00e0db1214a479bc0908ca0b40b5';
const expectedStaticBuildAnalysisFactsOwnerDigest =
  '17c46df8d4213641cde1a927989f3de7b869000368566032fd031e119dc5f17b';
const expectedStaticBuildAnalysisProjectExtractorDigest =
  '4126691cecf0b02b425bd79694915ae62a0534c5d4a5915cd3d71d5815b341f9';
const expectedStaticBuildDiagnosticTransferDigest =
  '0295dddea131bc81b2522d0891ee17be4847d0bd65f0b78f77a46b9ffd8813fb';
const expectedRegisteredDiagnosticDefinitionFactoryDigest =
  'e8dd153b51da2c8f22bc81bfe190d872c63bca35acf4a10ddef4db6f511f6a97';
const expectedDiagnosticFactoryConstructorDigest =
  'f6a630771e31fc07f420b1b67a62c8d9f0400b369c9d04b95f52d2172622bde6';
const expectedDiagnosticFactorySinkDigest =
  '96999736c35834ba759c757cd71ed3c17515c7246041565b4c751b8f1964dd58';
const expectedDiagnosticEvidenceWitnessDigest =
  '23014067df10912624d8419128d1362787bb212e84ef0aac772d78ad26156aa3';
const expectedDiagnosticActualLayerReviewDigest =
  'bab592c6e53f5a8b78b2f076b531a5600fe75ef4d8af1c1f39e3795fbf0a9770';
const expectedBlockingStaticExportCollectionDigest =
  '3541644c641aec62abd0743093c653abd953e634f6042b941877b699666c4fdd';
const expectedCompilerValidatorPipelineDigest =
  '5c4ea6e80d4882483133a89d4d69ece75e7488ee30547d83c7d1150970f2ab45';
const expectedCompileComponentModuleDigest =
  'a22e75b77161b32169cd2d41c0248a61baf55e2296197e6e82adbd5341e4d904';
const expectedValidateComponentPhaseDigest =
  '73844a343bcba2f074618fdba85eb9db9733214adb4cfde6d1f73ff8d34285f0';
const expectedCoreBuildDistCommand =
  'vp pack src/diagnostics-public.ts src/generated.ts src/index.ts src/internal/agent-docs.ts src/internal/cache-influence.ts src/internal/classifier-verdict.ts src/internal/client-module-url-intrinsics.ts src/internal/client-module-url.ts src/internal/component-render.ts src/internal/derivation.ts src/internal/diagnostics.ts src/internal/document-protocol.ts src/internal/emission.ts src/internal/event.ts src/internal/filesystem-intrinsics.ts src/internal/filesystem.ts src/internal/fragment-target.ts src/internal/framework-identity.ts src/internal/graph.ts src/internal/json.ts src/internal/mcp-stdio.ts src/internal/module-ref.ts src/internal/package-prefix.ts src/internal/query-delta.ts src/internal/query-shape-source.ts src/internal/render-plan-token-intrinsics.ts src/internal/render-plan-token.ts src/internal/route-pattern.ts src/internal/security-markers.ts src/internal/security-operation-ir.ts src/internal/security-url.ts src/internal/security-witness-intrinsics.ts src/internal/security.ts src/internal/semantic-attributes.ts src/internal/sink-policy.ts src/internal/source-sink-registry.ts src/internal/sql-safety.ts src/internal/storage.ts src/internal/verifier.ts src/internal/wire-input-grammar.ts src/internal/wire-json.ts src/security.ts src/storage-public.ts src/webhooks.ts --dts';
// Capability-closure summaries for the few framework-owned loaders whose target is intentionally
// runtime-selected. Each row pins both the complete source file and the acquisition expression, so
// a new loader, consumer shape, or file-level dataflow change fails closed instead of extending a hand-written
// JavaScript flow interpreter (plans/10x-better-security.md, layered-closure decision).
const reviewedUnresolvedDynamicModuleAcquisitions = new Set([
  'packages/browser/src/client-installer.ts#2c7b7a1aae697bd8d488d7459007da844cddb796d21fb790fe0fffb74ab46bcb#c7ce4597dc092d68bd9823e3434012745d9c977893566551bcdfee04cfb2a2e5',
  'packages/browser/src/inline-loader.ts#3bd68914ebc31433aa89b5c79e96e303985a5986ef2dc3645f6e66084d5992c1#c7ce4597dc092d68bd9823e3434012745d9c977893566551bcdfee04cfb2a2e5',
  'packages/cli/src/commands/db.ts#71f2e25eedf60743b28fb20ffadac69b9a2d9f342be7b5361e2133f0830fbfdf#88ff0d5b98c41aa906dd00878fccf940791c27dc1e087908d6efa85c9d56af3f',
  'packages/compiler/src/security-analyzer-soundness-oracle.ts#b20cbdba721c81ed1668a40d1f0d0d4ad96d7304e3483a8669fa4c282e07432c#4597d4868f6caa7d49aa7fd626313ad01af41164f801c7ee52a9395287151099',
  'packages/compiler/src/security-analyzer-soundness-oracle.ts#b20cbdba721c81ed1668a40d1f0d0d4ad96d7304e3483a8669fa4c282e07432c#7c8fe398cd82d5ea80560281e00f6154b09b15615233da0a8b56ac03f861e51b',
  'packages/compiler/src/vite-config-source.ts#4b88f6e8e7657d91dbaffe6d75cf4c4bf5863b455fd5cafb901a5c8a1a577d52#2d48f56da770ec53b7e31eacdafd3983b0929513b177d3acfd08d2c3db8012ca',
  'packages/server/src/vite-source.ts#d20810d8378391eeced5375aa3c41998c433b9846f2a612735e2c1d9365d6d41#2d48f56da770ec53b7e31eacdafd3983b0929513b177d3acfd08d2c3db8012ca',
  'packages/server/src/sqlite.ts#6130e055e7a0a3dddfde44acbd354cedb7693528989f72b2f87fed50772369a8#cb1f4aa1ac29147775093dc3c4411e81e956780357d25c102098893d5361a482',
  'packages/test/src/integration/optimistic-client.ts#a8729bfb3752f70cea20d0871ce5f706d8e49b976176f5c3b0622d220b8bba28#c7ce4597dc092d68bd9823e3434012745d9c977893566551bcdfee04cfb2a2e5',
  'packages/cli/src/commands/sound-subset.mjs#c4a8eb38e20db4f59cc14cafa3f5dcaa433bc39aad4208dd6a3b6234ca3772b3#0a2e825ccb996448551e9e666568a12ebc039398f5e35848d8adf5b936a5f136',
]);
const reviewedRuntimeModuleLoaderAuthorityFiles = new Map([
  [
    'packages/cli/src/add-catalog.ts',
    'e1c8065e5d518fa49694e4b6fe592f0a7a5b968bc857c6979855c859c1cf5ff9',
  ],
  [
    'packages/cli/src/artifact-provenance.ts',
    '2a14bd933c62e9544c02cd0cd525f92c95021461ee1796623e50e4ad9457d928',
  ],
  [
    'packages/cli/src/capability-closure-packages.ts',
    'e27f8372435ccd68c5ad554bfc52579bf105ab8dde2cac1101e037b3f203f978',
  ],
  ['packages/cli/src/bin.ts', 'c25df08ae63082fc227c0c8cd6e4c71cf68e44a05d238a5890cb4f17d7fcd07b'],
  [
    'packages/cli/src/commands/build-export.ts',
    '7031f99d5127f75f65a23a054a339354940b25c98efe446081a21afd0add098e',
  ],
  [
    'packages/cli/src/commands/build-static-trust-source-hook.mjs',
    '771e2c338855f3034bcc7594f8571ade71822b6883308314e385c064518de16a',
  ],
  [
    'packages/cli/src/commands/compile.ts',
    '085172bc8d7ec8f7d081a3a471ec59b611a075ac762df957d8aafd43034aa8e5',
  ],
  [
    'packages/cli/src/commands/dev.ts',
    'cb8225a71eb76d19bbc88dc7ea63fc692b72387d25266e328acda0f6da043617',
  ],
  [
    'packages/cli/src/commands/sound-subset.mjs',
    'c4a8eb38e20db4f59cc14cafa3f5dcaa433bc39aad4208dd6a3b6234ca3772b3',
  ],
  [
    'packages/cli/src/commands/vite-plus-bin.ts',
    '7ab092de3f68b337aae83eb8cbf3cc496b06c9d61cf6e15446f112595b37b269',
  ],
  [
    'packages/cli/src/dependency-capability-loader.ts',
    '8d06b534d7909d1239bdeb729f4bcd322977e267dab46f1eefe2e5768aff7db5',
  ],
  [
    'packages/compiler/src/ts-api.ts',
    'a9f6ee33ff5fd49413db4d3ea34d2bfc201f7fd36cb1b645f4da28e203c68270',
  ],
  [
    'packages/compiler/scripts/gen-primitive-reactive-attrs.mjs',
    'f74475468be27f8999000ec37f8befabccfc93122c72ec043030b0d912ef08b2',
  ],
  [
    'packages/compiler/src/vite-config-source.ts',
    '4b88f6e8e7657d91dbaffe6d75cf4c4bf5863b455fd5cafb901a5c8a1a577d52',
  ],
  [
    'packages/core/src/secret.ts',
    'a0fd7ba26b7d62959f7c94d69e3bbd1565d4e91265559a59d28fff7fc0545dbd',
  ],
  [
    'packages/drizzle/src/trust-escapes-static.ts',
    '6e8f9ae558a8434a42a1241e9b6016b39b7a2478c9bf4591036bd04cb6dfc8ae',
  ],
  [
    'packages/icons/scripts/icon-plan.mjs',
    '4eeed572e6cbc9708addbc9aa8de32cc213c79ac6f00d091ba465afd9fed781a',
  ],
  [
    'packages/server/src/egress-undici-runtime.ts',
    'ff47c870478a72733695d810b8b9cfa65fc10d7e6f8fafc342c9aef6874dfade',
  ],
  [
    'packages/server/src/sql-parser-authority.ts',
    'ad4eb1800989bd4a18b4767fcdcecf1c1cd0258190369c2964041e2a545a3a7b',
  ],
  [
    'packages/server/src/sqlite.ts',
    '6130e055e7a0a3dddfde44acbd354cedb7693528989f72b2f87fed50772369a8',
  ],
  [
    'packages/server/src/vite-source.ts',
    'd20810d8378391eeced5375aa3c41998c433b9846f2a612735e2c1d9365d6d41',
  ],
  [
    'packages/test/src/integration/boot-fixture.ts',
    '270fde09e8d965dbb3db83d5526ccdef6458bcd15461cd82c3fefcb9c8421978',
  ],
  [
    'packages/test/src/sqlite.ts',
    '15136219f7837b476bc50a68ce4b2562e2afba609905d83a3a8b16e52f7cb57c',
  ],
]);
const reviewedExcludedSourceReachability = new Set([
  'packages/browser/src/inline-loader-response-apply-fixture.ts#f74d1e121d03bd6d3d2dafa01dacaa17e6732f9cee0269a00566ae3f92717ed3#packages/conformance-fixtures/src/oracle-fixtures.ts#b5946ecdc48ef64c0ec8e9065e70d02d496f13ef346aefca4f545e435a6f209a',
]);
// Dynamic `{ code, message/severity }` projections are denied by default. The few existing
// non-diagnostic protocols and registry-derived projections are capability-closed by exact site +
// outer-owner digests; any new shape or owner edit must be reviewed explicitly.
const reviewedDynamicDiagnosticShapeSummaries = new Map([
  [
    'packages/cli/src/diagnostic.ts#literal#a63a20d87448bddbe07cfb8d25cc8cd9d3bb1477d534578e388823ea8fcc9d5d#1f9244dd7dc9751d1b029138f54482682b48d36f52d1a4f3cfff32bd9dae1c84',
    'Registry-authenticated KV projection into the module-private kovo-diagnostic/v1 constructor; exact own data is normalized before the frozen record receives realm-local registry membership.',
  ],
  [
    'packages/cli/src/diagnostic.ts#literal#8a49bc9b614be96446a262b6d627540558d1503dc68b91a7482964a8af80fcff#d70da82b82f70860880ac445ac3a1d2c1a9628aeb6e82f25f262e56ed1412291',
    'Finite CLI-registry projection into the module-private kovo-diagnostic/v1 constructor; the code selects fixed category, help, and severity while the message and optional source are validated.',
  ],
  [
    'packages/cli/src/commands/build-export.ts#literal#d8169c6f79afdcf5d64a737f37803b00a0f443020797c4eb4a6f51b1846c3086#35b6be7891ab860c16367f93cbdf096dd9fe1d72bc68ee89917d13e4b7afcce3',
    'Registry-derived compiler diagnostic projection for the build-export result protocol.',
  ],
  [
    'packages/cli/src/commands/compile.ts#literal#d6f772521c5d7f3a2068579f07b0229f2633d14d0b05ac3024033fb17c10a633#97b529171f62a2412be77517f99fa7c44ae8ac3f209dbf6519e5dd0665eee9c7',
    'Registry-derived compiler diagnostic projection for the compile command result protocol.',
  ],
  [
    'packages/cli/src/commands/compile.ts#literal#d6f772521c5d7f3a2068579f07b0229f2633d14d0b05ac3024033fb17c10a633#285e010de3a30b636431bae8b63296487e078f1aa8d94a0584bd5d2af957af63',
    'Registry-derived compiler diagnostic projection for the compile command result protocol.',
  ],
  [
    'packages/cli/src/commands/doctor.ts#literal#ffcc9326808c385bc36079618771bff30bd03ec7eecd41613e16a32d7c9fdc4a#9124fe610cba434a45139ceb733c45ee9ce1750253a7fc4605a2577b358cccc3',
    'Finite KOVO_DOCTOR_* finding projected through the private doctor registry constructor before it can enter the kovo-diagnostic/v1 envelope.',
  ],
  [
    'packages/cli/src/commands/doctor.ts#literal#a34215d7a29a5d9c46de0b9ea9ad1360ed2580300358f5c8af1b0de78895d11b#68a2becc374d3eeada3f7358b94ce4c7fd7d2a273c94ccddaf8b3e945f0fb8e6',
    'Finite KOVO_DOCTOR_* finding carrier; doctorResult authenticates every finding through doctorFindingDiagnostic before structured emission.',
  ],
  [
    'packages/cli/src/commands/mcp.ts#literal#b6188b2dc75cde7ed04e5dffc1bb8cc23ff69c7bac827d79d3963f2166cad02b#2b1864d1eea92c670f67d773404460999b0f0a1bb7d5151aa8e23a8432cd9438',
    'Non-Kovo JSON-RPC error response with protocol-defined code and message fields.',
  ],
  [
    'packages/cli/src/diagnostic.ts#literal#63f290c06aad4b33660725cb51daaf65349f9770eb18974addc1ea262fef5a2c#7bc5ddfd328eb4f63db8c65c4cea922341b77ef488ba484064ff90a1192433e7',
    'Exact finite TrustedBoundaryFailureFact projection through the private CLI diagnostic registry; surplus fields are rejected before the frozen kovo-diagnostic/v1 record is enrolled.',
  ],
  [
    'packages/core/src/internal/mcp-stdio.ts#literal#f2091906e301fb03121aa20a853418afcc31c978c1d8a82154ca6f5b7ae00d7c#cf6591b3a4ba873f14a91d88c778ffa00721f6204fd2134f6b3302370450ab8e',
    'Non-Kovo JSON-RPC error response with protocol-defined code and message fields.',
  ],
  [
    'packages/compiler/src/app-contract-project.ts#literal#49b787e5c61160df2d4f918188617ff9a0d8567690e6372a3af41f4871c890a8#3bd02af709ad98b0775169514ef4f7a9c43820d29183eb2c0a214474051799f5',
    'Pre-ratification D1 experiment diagnostic with a closed D1A/D1B/D1X code union; it is not a registry-backed Kovo diagnostic.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#4082fcd1d47e8e82a6ecbc4a725942957ca161e4f5ded5836f9f3212edc3cab6#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#561dab988dab679ae8976d07b4a89ce087927c0b4b418b7e8fddafe71010a109#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#4a21ee13172cd2e7b41b53888310c7c03561128f254015b815a0859a8333c1e9#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#3e147ce7771064f255df44e485e97f025a13042151db0769e7b5c871668d200f#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#abe8a4690d69bb06608c2e44275d0952dfa0a1aa4558a0357b725ea008d9b2f6#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#4cccb9decd32f6a59066e67ed0b5b2d358e5d894edd41192fda0b9e8c8fe6566#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#7338cf420a48c2ebb520d96455342385d608e1f26ebefda3f33affcc7ff5a274#13d76be66bcb214fed48ea36343bb345e1bf670550de3b5978b1ad962ff0a0fd',
    'Compiler-internal app-contract resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#0d625f7d6ae55458ff28ec3af7f78636ef008c6c151046e25946594e9cc1c548#f0360ce013e12a6d71798a50db5a19b38557e8f8818524884c37a9892b6ea8e4',
    'Compiler-internal app-contract member-resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#2aad634c5c8f5f07e6693ad6abfebac2ea247c2dbce51f0f7c64145478cc15c2#f0360ce013e12a6d71798a50db5a19b38557e8f8818524884c37a9892b6ea8e4',
    'Compiler-internal app-contract member-resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/app-contract-resolver.ts#literal#9024585553faa845ce441d45c6b8f7b5bb26e8161e358957d91d96b19ee161bf#f0360ce013e12a6d71798a50db5a19b38557e8f8818524884c37a9892b6ea8e4',
    'Compiler-internal app-contract member-resolution integrity record with a finite D1A10x code union; callers reject every nonempty result before lowering, and it never carries Kovo registry authority.',
  ],
  [
    'packages/compiler/src/gallery-merge-fixtures-oracle.tsx#literal#9e8369d836f76e77dbc76c7168ac5fb93c4d0f5f8a05670cfc7fb9212ee06b8f#f49042cb6512bbdb4bfa641c021afaefcfa27de91c2a54f0541c1fa1de3bb4a7',
    'Gallery oracle mismatch record; code is a non-diagnostic comparison label.',
  ],
  [
    'packages/compiler/src/gallery-merge-fixtures-oracle.tsx#literal#08ed2d5732784d88639d643d59bf9ea63ca27290067531f1e5a9b54e073b55cc#f49042cb6512bbdb4bfa641c021afaefcfa27de91c2a54f0541c1fa1de3bb4a7',
    'Gallery oracle mismatch record; code is a non-diagnostic comparison label.',
  ],
  [
    'packages/compiler/src/gallery-merge-fixtures-oracle.tsx#literal#714b9f2bfca2ad8c5f5e8bb47769dcfc8b4c17f0d2adb873d7cdb99fee2b65c3#f49042cb6512bbdb4bfa641c021afaefcfa27de91c2a54f0541c1fa1de3bb4a7',
    'Gallery oracle mismatch record; code is a non-diagnostic comparison label.',
  ],
  [
    'packages/compiler/src/hmr-impact.ts#literal#d36859e8a89c106c98eb8f0d2ce79cf1cbbdde9ebbb0c5b4a707207683282580#e620a964cb6cae4d07073c9168c847a6b869bc832f8ab7e4ce60d57dd83b2097',
    'Registry-derived compiler diagnostic projection for the HMR impact protocol.',
  ],
  [
    'packages/drizzle/src/graph.ts#literal#037a71b0f00e382d761fb4137b567a34140f2e1d5daa99e58cfcce9f396328f0#c4c830904fe3cbee13917343377519e8b93223065f206b9ebe00ab8c538892fe',
    'Touch-graph unresolved fact; downstream graph diagnostics own registered KV emission.',
  ],
  [
    'packages/devtool/src/cards.mjs#literal#67a8ee388ceca2a8b492a2f1516a9d8c8b4127868faadeba900cd155a1d6d12f#34c4bd143735637b4af4d747c0681f2bcac54c76a926bdf5073ed4705b3a1f61',
    'Bounded devtool card projection from snapshotDiagnostic-authenticated graph data; it cannot mint Kovo registry authority.',
  ],
  [
    'packages/devtool/src/diagnostics.mjs#literal#d9a6ad46dde2e57567820b62a23eef65f0a2a9b4e325e0c19ac60cd4abbda8a6#a5c60ee8cb034581664154025fea6a7955de64b477d017b9f27617ed7848527b',
    'Exact-field, bounded, frozen devtool snapshot of a kovo-diagnostic/v1 carrier after category, code, severity, source, and version validation.',
  ],
  [
    'packages/devtool/src/render-input.mjs#assignment#2ceaca7b1e1343b927faee96bd5e3ff531f4f05307a5ff35366a189252007d39#8c31e852412d9658731ca279f594f64a96a0e8e76e90c6e2c17cd495fd8b44eb',
    'Diagnostic graph-card fields copied only from the exact-field bounded snapshotDiagnostic result before the normalized data record is frozen.',
  ],
  [
    'packages/devtool/src/render-input.mjs#literal#c60e3d871912cec08700ffe126a5949077fe45e82e492c33cb9b52c370ea99f5#8c31e852412d9658731ca279f594f64a96a0e8e76e90c6e2c17cd495fd8b44eb',
    'Internal normalized graph-card data defaults; the diagnostic branch is populated only from snapshotDiagnostic and this record carries no registry authority.',
  ],
  [
    'packages/headless-ui/src/tooling/primitive-handler-lint.ts#literal#eb045c3b5aa68f693ed8518c389a8385007096b6e76a7e9e57338311ad223a5c#c0053977ff00e56c87d02854987d923395a6c2664d204f8f034760eaa4150d25',
    'Headless UI lint result protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/build.ts#literal#5c8dface0279f7588b354c61639f3cab889d7acad108fb5839b586bbba7bd0ac#ed69af239b0d2819288e64d735ec208ea9540099905c19cc043e2e731fdf0063',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/build.ts#literal#d739312c755f1f83e586dc01747bb4fdb4649a468b674a1d1be9d5a1707cb932#c0c76659b56a0a6ef8b60cf336fa459f9e9cdb8676ece400faa4c5205e869d88',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/build.ts#literal#ab24c609cef9fe5b4a19597883c7f1ab574d24cab77ae0c25588283ba672a600#03669ef0e0e0d9a5ed5f37a655ec604700526c7bbacdb95e207c39f2416c47de',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/build.ts#literal#80a9d236dcf43a899bc41808d6e404075eff17d891a66a9c0f5a2a2c11aaaadb#59573ab05f54c0e90167707b30b974ee3e5b0a64945e8d4b8466a38a996825c3',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/build.ts#literal#9eeb89631b7f064ac331275495e0e4d461facda02c1a6ce91a1a492c95944e1b#d7a6fce684dc5585d941dd55f1e70c82a94b55120ae4aac70bd96ad07949fe76',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/build.ts#literal#4146830f339f70b55a7a535e39ded816de81ccb4a2e4196245d93236d6ffddc8#d7a6fce684dc5585d941dd55f1e70c82a94b55120ae4aac70bd96ad07949fe76',
    'Registry-derived compiler diagnostic projection into server build output.',
  ],
  [
    'packages/server/src/env.ts#literal#7f9c81bbba1f66eea71152e9c08bab70561284822b43d0976ab09d44e64b9ae1#cfdba098c0b392161a80651304be42747e07f4a462cb112720d03b1f418ba6e3',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/env.ts#literal#6e9025da188ba1cb4c94a737eefe30281af97395f899fda9b9301bd5a925fc50#cfdba098c0b392161a80651304be42747e07f4a462cb112720d03b1f418ba6e3',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/verify/src/bin.ts#literal#b5d4d5e43ebbb9a25af7375d941c9479b0930fef75f15a120e1eb87d675a0646#84be75ecaca7617efc3021dd38dc85e9afd3696dd98049a5dc253bcbe8242786',
    'Runtime-independent verifier presentation evidence derived only from certificate finding records; it carries no Kovo runtime registry authority.',
  ],
  [
    'packages/verify/src/bin.ts#literal#2623ba9b03a851728df79b2ab630ec2c4f2120f8781721c697adf7a3cef74d87#f5aecfd253e45af33cd0a802b5cf1ea17ad9c582752be04d6655dcb85db10e15',
    'Runtime-independent verifier command-error evidence with the single finite KOVO_VERIFY_INDETERMINATE code; it carries no Kovo runtime registry authority.',
  ],
  [
    'packages/server/src/env.ts#literal#622aa0217340621345170650b52ee58989e8f029e6e7ae1c2cafd59bc6e1ae13#cfdba098c0b392161a80651304be42747e07f4a462cb112720d03b1f418ba6e3',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/env.ts#literal#0edf03259b5ba41b174f0e4c5ba4047418954a23892a3e74f6af5fa8d1e452fc#cfdba098c0b392161a80651304be42747e07f4a462cb112720d03b1f418ba6e3',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/env.ts#literal#7d6ec43da94ffe69deb47c003752f21a726705146a500bb05e885df0133fbeec#cfdba098c0b392161a80651304be42747e07f4a462cb112720d03b1f418ba6e3',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/env.ts#literal#99a54952ae89f14974acb0ed9ef5883512d14ea1aece370816ee25e8f1cd32f6#83e79cf6a3a119b545c1d2d2f64c8d4b53a997798cf657ca14af7a12e02c8b19',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/env.ts#literal#b6098b49f34cab5d6b35448575b0978b4d16e3d7768a9b1dc7aa23cf9c6cdff1#83e79cf6a3a119b545c1d2d2f64c8d4b53a997798cf657ca14af7a12e02c8b19',
    'Environment validation issue protocol with a non-Kovo code namespace.',
  ],
  [
    'packages/server/src/internal/data-plane-static-analysis.ts#literal#c84de7c7f12dde57b3f69b9420957a880b1a8acb66fba7e7da2cc60bc8cdb460#4660349562d6c2a6add947055587fb6cf750e43c8317af2b043df0ff7652b30b',
    'Registry-derived SQL-safety diagnostic projection for data-plane analysis.',
  ],
  [
    'packages/test/src/integration/fixture-compiler-plugin.ts#literal#6d68b0cf359673b8aaa9738ba0e6082092fc51a98d943d841017256b72d1078a#305fc1bbeefe4be138b486fa15164dd12d8bdaf6b9390faccc71188226f48cab',
    'Registry-derived compiler diagnostic projection for integration fixtures.',
  ],
  [
    'packages/verify/src/index.ts#literal#31f609b29dfa8b7824dd1bbd42fdbe901d15ad88ea04a3cd8e65c965b2242037#9573ca48da5473895cee1e9383b8557d80bbba60a5970ab83137e8663b60a07e',
    'Certificate finding projection with a non-Kovo capability-obligation code namespace.',
  ],
  [
    'packages/verify/src/translation.ts#literal#34420495135a3d428c054b502a02d1a1ecaf6c4ed10edbb63e1f2f01c761c4e8#fe5ff670befc4c811bb30c71e564a50a578ef73c70b1c810103e92d3af9da625',
    'Translation finding projection with a non-Kovo relation-specific code namespace.',
  ],
  [
    'packages/test/src/verifier-snapshots.ts#literal#9224c50f792a02912a3f2d0d36f4f011064979221208a2310cdb635a06023e82#cef07ca9ac80147617387ba25768bb9844f4e16727ce2193d75e8dda6b90fa01',
    'Registry-derived verifier diagnostic projection for snapshot output.',
  ],
  [
    'packages/vscode/src/diagnostic-adapter.cjs#literal#5d5be3bd77147cf23c9f5a05c61a82ce64f1fabdf8993226645037399d4a04b1#e64d652712e6871442417ff8180e5520320f859e9050a83d7db56661cf2f4919',
    'Editor-only frozen fact projection from snapshotDiagnostic-authenticated kovo-diagnostic/v1 data with a required producer-owned source span.',
  ],
  [
    'packages/vscode/src/diagnostic-adapter.cjs#literal#f9940d506e852b890702731b91aa013f082db9f181a92f52d39aaf6a29f34ecc#11511a131dc5b22729add704c57b3ea954b5b661d867c33cef737ee7c64dafdf',
    'Exact-field bounded frozen kovo-diagnostic/v1 snapshot after finite category, code, severity, source, and version validation.',
  ],
]);
const protectedCoreBridgeExports = new Map([
  ['createRegisteredDiagnostic', coreDiagnosticsPath],
  ['deriveRegisteredDiagnostic', coreDiagnosticsPath],
  ['diagnosticConstructors', generatedDiagnosticRegistryModulePath],
]);

// These are reviewed wrapper definitions, not spelling-based exemptions. A call is approved only
// when its lexical binding resolves to this exact file + symbol and the wrapper graph below proves
// that definition still reaches the root createRegisteredDiagnostic door.
const reviewedDiagnosticWrappers = new Map([
  [derivedDiagnosticDoor, { exported: true, name: 'deriveRegisteredDiagnostic' }],
  [
    staticExportDiagnosticRehydrationDoor,
    { exported: false, name: 'rehydrateStaticExportCompileDiagnostic' },
  ],
  [
    sqlSafetyDiagnosticRehydrationDoor,
    { exported: false, name: 'rehydrateSerializedSqlSafetyDiagnostic' },
  ],
  [
    transferredSqlSafetyDiagnosticRegistrarDoor,
    { exported: false, name: 'registerTransferredSqlSafetyDiagnostic' },
  ],
  [
    'packages/cli/src/commands/build-export.ts#rehydrateStaticExportDiagnostic',
    { exported: false, name: 'rehydrateStaticExportDiagnostic' },
  ],
  [`${compilerDiagnosticsPath}#diagnosticFor`, { exported: true, name: 'diagnosticFor' }],
  [
    'packages/compiler/src/lower/attribute-merge.ts#attributeMergeDiagnostic',
    { exported: false, name: 'attributeMergeDiagnostic' },
  ],
  [
    'packages/compiler/src/validate/event-triggers.ts#eventTriggerDiagnostic',
    { exported: false, name: 'eventTriggerDiagnostic' },
  ],
  [
    'packages/compiler/src/validate/markup.ts#attributeMergeDiagnostic',
    { exported: false, name: 'attributeMergeDiagnostic' },
  ],
  [
    'packages/drizzle/src/static/diagnostics.ts#drizzleDiagnostic',
    { exported: true, name: 'drizzleDiagnostic' },
  ],
  [
    'packages/drizzle/src/static/diagnostics.ts#drizzleDiagnosticWithoutSite',
    { exported: true, name: 'drizzleDiagnosticWithoutSite' },
  ],
  [
    'packages/server/src/static-export-diagnostics.ts#staticExportDiagnostic',
    { exported: true, name: 'staticExportDiagnostic' },
  ],
  [
    'packages/server/src/static-export-diagnostics.ts#blockingStaticExportDiagnostic',
    { exported: false, name: 'blockingStaticExportDiagnostic' },
  ],
  [`${verifierDiagnosticsPath}#diagnosticMessage`, { exported: true, name: 'diagnosticMessage' }],
]);
const reviewedDiagnosticEmitterNames = new Set([
  'attributeMergeDiagnostic',
  'createRegisteredDiagnostic',
  'deriveRegisteredDiagnostic',
  'diagnosticAt',
  'diagnosticFor',
  'diagnosticMessage',
  'drizzleDiagnostic',
  'drizzleDiagnosticWithoutSite',
  'eventTriggerDiagnostic',
  'rehydrateStaticExportDiagnostic',
  'rehydrateStaticExportCompileDiagnostic',
  'rehydrateSerializedSqlSafetyDiagnostic',
  'registerTransferredSqlSafetyDiagnostic',
  'staticExportDiagnostic',
  'blockingStaticExportDiagnostic',
]);
const diagnosticEmitterCodePositions = new Map([
  [rootDiagnosticDoor, { argument: 0 }],
  [diagnosticFactoryDoor, { argument: 1 }],
  [`${compilerDiagnosticsPath}#diagnosticFor`, { argument: 1 }],
  ['packages/compiler/src/lower/attribute-merge.ts#attributeMergeDiagnostic', { argument: 1 }],
  ['packages/compiler/src/validate/event-triggers.ts#eventTriggerDiagnostic', { argument: 1 }],
  ['packages/compiler/src/validate/markup.ts#attributeMergeDiagnostic', { argument: 1 }],
  [
    'packages/drizzle/src/static/diagnostics.ts#drizzleDiagnostic',
    { argument: 0, property: 'code' },
  ],
  [
    'packages/drizzle/src/static/diagnostics.ts#drizzleDiagnosticWithoutSite',
    { argument: 0, property: 'code' },
  ],
  [
    'packages/server/src/static-export-diagnostics.ts#blockingStaticExportDiagnostic',
    { argument: 0, property: 'code' },
  ],
  [transferredSqlSafetyDiagnosticRegistrarDoor, { argument: 0 }],
  [`${verifierDiagnosticsPath}#diagnosticMessage`, { argument: 0 }],
]);
const aliasSensitiveDiagnosticBindings = new Set([
  ...reviewedDiagnosticEmitterNames,
  'createDiagnosticFactory',
  'diagnosticConstructors',
  'DiagnosticFactory',
]);
const productionAnalysisCache = new WeakMap();
const productionScanCache = new WeakMap();
const emissionDoorBindingCache = new WeakMap();
const namedFixtureTestCache = new Map();
const diagnosticLiteralExemptions = new Map([
  [
    'packages/core/src/diagnostics.ts',
    'ff873900d582bb9bc27f04932856f4647ebb34362e853c8eea04d1aa858540f4',
  ],
  [
    'packages/core/src/internal/diagnostic-registry.generated.ts',
    'b2a2e74e73641bc3ce062528f7260240a501fadc509727e8248c0a0e626608de',
  ],
  [
    'packages/core/src/internal/security-markers.ts',
    '65f104f11ee87e77124fac889a4cc8a22a67acfd3018d1d9534c68dfe0c52bc3',
  ],
  [
    'packages/core/src/internal/source-sink-registry.ts',
    'fb6a4609d537894b1eaf7a20e183eac0aaaa618a78ad12fb320c1f387815e801',
  ],
]);

export async function loadSpecConformanceInput({ root = repoRoot } = {}) {
  const specMarkdown = readFileSync(path.join(root, diagnosticSpecPath), 'utf8');
  const generatedSource = readFileSync(path.join(root, generatedDiagnosticRegistryPath), 'utf8');
  const evidence = JSON.parse(
    readFileSync(path.join(root, diagnosticConformanceEvidencePath), 'utf8'),
  );
  const corePackageManifest = JSON.parse(
    readFileSync(path.join(root, 'packages/core/package.json'), 'utf8'),
  );
  const productionFiles = collectPackageSourceFiles(root);
  const fixtureFiles = {};
  for (const file of referencedEvidenceFiles(evidence)) {
    fixtureFiles[file] = readFileSync(path.join(root, file), 'utf8');
  }

  const diagnosticsModule = await import(
    pathToFileURL(path.join(root, 'packages/core/src/diagnostics.ts')).href
  );
  const generatedRuntimeShape = parseGeneratedRuntimeShape(
    generatedSource,
    diagnosticsModule.diagnosticDefinitions,
  );

  let diagnosticsRefResult;
  try {
    const result = await checkDiagnosticsRegistryEquality();
    diagnosticsRefResult = { codes: result.codes, findings: [], ok: true };
  } catch (error) {
    diagnosticsRefResult = {
      codes: 0,
      findings: [error instanceof Error ? error.message : String(error)],
      ok: false,
    };
  }

  return {
    corePackageManifest,
    definitions: diagnosticsModule.diagnosticDefinitions,
    diagnosticsRefResult,
    evidence,
    fixtureFiles,
    generatedSource,
    productionFiles,
    runtimeConstructorCodes: generatedRuntimeShape.constructorCodes,
    runtimeDefinitionFactory: diagnosticsModule.createRegisteredDiagnosticDefinition,
    runtimeRegistry: generatedRuntimeShape.registry,
    specMarkdown,
  };
}

function parseGeneratedRuntimeShape(source, definitions) {
  const registry = {};
  for (const match of source.matchAll(
    /^\s*(KV\d{3}): createRegisteredDiagnosticDefinition\('(KV\d{3})', '(compile-error|fail-closed-runtime|audited-escape)'\),$/gmu,
  )) {
    if (match[1] !== match[2]) continue;
    const definition = definitions[match[1]];
    if (definition === undefined) continue;
    registry[match[1]] = { ...definition, enforcementClass: match[3] };
  }
  const constructorCodes = Array.from(
    source.matchAll(/^\s*(KV\d{3}): createDiagnosticConstructor\('(KV\d{3})'\),$/gmu),
    (match) => (match[1] === match[2] ? match[1] : undefined),
  ).filter(Boolean);
  return { constructorCodes, registry };
}

export function evaluateSpecConformanceClosure(input) {
  const findings = [];
  let rows;
  try {
    rows = parseDiagnosticSpecRegistry(input.specMarkdown);
  } catch (error) {
    return conformanceResult([error instanceof Error ? error.message : String(error)], 0, 0, 0);
  }

  const expectedGenerated = renderGeneratedDiagnosticRegistry(rows);
  if (input.generatedSource !== expectedGenerated) {
    findings.push(
      `${generatedDiagnosticRegistryPath}: stale or incomplete; run node scripts/generate-diagnostic-registry.mjs --write`,
    );
  }
  findings.push(...validateCoreDiagnosticsPackageManifest(input.corePackageManifest));

  const specCodes = new Set(rows.map((row) => row.code));
  const definitionOwnKeys =
    input.definitions !== null && typeof input.definitions === 'object'
      ? Reflect.ownKeys(input.definitions)
      : [];
  const definitionCodes = new Set(definitionOwnKeys.filter((key) => typeof key === 'string'));
  const runtimeRegistryCodes = new Set(Object.keys(input.runtimeRegistry ?? {}));
  const runtimeConstructorCodes = new Set(input.runtimeConstructorCodes ?? []);
  findings.push(...exactCodeSetFindings('diagnosticDefinitions', definitionCodes, specCodes));
  findings.push(
    ...validateRuntimeDiagnosticDefinitions(input.definitions, [...specCodes], definitionOwnKeys),
  );
  findings.push(
    ...exactCodeSetFindings('generated diagnostic registry', runtimeRegistryCodes, specCodes),
  );
  findings.push(
    ...exactCodeSetFindings(
      'generated diagnostic constructors',
      runtimeConstructorCodes,
      specCodes,
    ),
  );

  for (const row of rows) {
    const definition = input.definitions?.[row.code];
    const registryRow = input.runtimeRegistry?.[row.code];
    const runtimeRow = runtimeDiagnosticDefinitionRow(input.runtimeDefinitionFactory, row);
    if (definition !== undefined && definition.severity !== row.severity) {
      findings.push(
        `${row.code}: SPEC severity ${row.severity} disagrees with diagnosticDefinitions severity ${definition.severity}`,
      );
    }
    if (registryRow !== undefined) {
      if (registryRow.severity !== row.severity) {
        findings.push(
          `${row.code}: generated registry severity ${registryRow.severity} disagrees with SPEC severity ${row.severity}`,
        );
      }
      if (registryRow.enforcementClass !== row.enforcementClass) {
        findings.push(
          `${row.code}: generated registry enforcement ${registryRow.enforcementClass} disagrees with SPEC enforcement ${row.enforcementClass}`,
        );
      }
    }
    if (runtimeRow.finding !== undefined) {
      findings.push(`${row.code}: ${runtimeRow.finding}`);
    } else if (definition !== undefined) {
      const expectedRuntimeRow = {
        ...definition,
        code: row.code,
        enforcementClass: row.enforcementClass,
      };
      if (!exactFrozenOwnDataRecord(runtimeRow.value, expectedRuntimeRow)) {
        findings.push(
          `${row.code}: runtime diagnostic registry definition disagrees with the exact frozen SPEC row`,
        );
      }
    }
  }

  findings.push(...validateEmissionDoorBindings(input.productionFiles));
  const scan = scanDiagnosticProductionSources(input.productionFiles, {
    validateSummaryCompleteness: true,
  });
  findings.push(...scan.findings);
  const siteDigest = diagnosticEmissionSiteDigest(scan.emissionSites);
  if (siteDigest !== expectedDiagnosticEmissionSiteDigest) {
    findings.push(
      `production diagnostic emission site manifest drifted: expected ${expectedDiagnosticEmissionSiteDigest}, received ${siteDigest}`,
    );
  }

  const errorCodes = rows.filter((row) => row.severity === 'error').map((row) => row.code);
  findings.push(
    ...validateDiagnosticEvidence({
      emissionSites: scan.emissionSites,
      errorCodes,
      evidence: input.evidence,
      fixtureFiles: input.fixtureFiles,
    }),
  );
  findings.push(
    ...validateDiagnosticActualLayerBindings({
      emissionSites: scan.emissionSites,
      evidence: input.evidence,
      fixtureFiles: input.fixtureFiles,
      rows,
    }),
  );
  const evidenceDigest = diagnosticEvidenceWitnessDigest(
    errorCodes,
    input.evidence,
    input.fixtureFiles,
  );
  if (evidenceDigest !== expectedDiagnosticEvidenceWitnessDigest) {
    findings.push(
      `${diagnosticConformanceEvidencePath}: exact fixture witness manifest drifted (received ${evidenceDigest})`,
    );
  }

  if (!input.diagnosticsRefResult?.ok) {
    const detail = input.diagnosticsRefResult?.findings?.join('; ') || 'unknown registry drift';
    findings.push(`diagnostics-ref registry equality failed: ${detail}`);
  } else if (input.diagnosticsRefResult.codes !== rows.length) {
    findings.push(
      `diagnostics-ref registry equality counted ${input.diagnosticsRefResult.codes} codes; SPEC registers ${rows.length}`,
    );
  }

  return conformanceResult(findings, rows.length, errorCodes.length, scan.siteCount);
}

function validateCoreDiagnosticsPackageManifest(manifest) {
  const findings = [];
  if (manifest?.exports?.['./internal/diagnostics'] !== './src/internal/diagnostics.ts') {
    findings.push(
      'packages/core/package.json: source ./internal/diagnostics export must resolve to the exact reviewed bridge',
    );
  }
  const published = manifest?.publishConfig?.exports?.['./internal/diagnostics'];
  if (
    published === null ||
    typeof published !== 'object' ||
    JSON.stringify(Reflect.ownKeys(published)) !== JSON.stringify(['types', 'default']) ||
    published?.types !== './dist/internal/diagnostics.d.mts' ||
    published?.default !== './dist/internal/diagnostics.mjs'
  ) {
    findings.push(
      'packages/core/package.json: published ./internal/diagnostics export must resolve to the exact built bridge',
    );
  }
  if (manifest?.scripts?.['build:dist'] !== expectedCoreBuildDistCommand) {
    findings.push(
      'packages/core/package.json: build:dist must compile the exact reviewed diagnostics bridge',
    );
  }
  return findings;
}

function validateRuntimeDiagnosticDefinitions(definitions, expectedCodes, ownKeys) {
  const findings = [];
  if (definitions === null || typeof definitions !== 'object') {
    return ['diagnosticDefinitions: runtime registry map is missing'];
  }
  if (
    !Object.isFrozen(definitions) ||
    ownKeys.some((key) => typeof key !== 'string') ||
    JSON.stringify([...ownKeys].sort(compareCodes)) !==
      JSON.stringify([...expectedCodes].sort(compareCodes))
  ) {
    findings.push(
      'diagnosticDefinitions: runtime registry map must be the exact deeply frozen own-data code map',
    );
  }
  for (const code of expectedCodes) {
    const descriptor = Object.getOwnPropertyDescriptor(definitions, code);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.configurable !== false ||
      descriptor.enumerable !== true ||
      descriptor.writable !== false ||
      !deepFrozenOwnDataTree(descriptor.value) ||
      descriptor.value.code !== code
    ) {
      findings.push(
        `${code}: diagnosticDefinitions row must be the exact deeply frozen own-data registry row`,
      );
    }
  }
  return findings;
}

function deepFrozenOwnDataTree(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 8 || seen.has(value)) return false;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.configurable !== false ||
      descriptor.enumerable !== true ||
      descriptor.writable !== false
    ) {
      return false;
    }
    if (
      typeof descriptor.value === 'object' &&
      descriptor.value !== null &&
      !deepFrozenOwnDataTree(descriptor.value, seen, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

function runtimeDiagnosticDefinitionRow(factory, row) {
  if (typeof factory !== 'function') {
    return { finding: 'runtime diagnostic registry definition factory is missing' };
  }
  try {
    return { value: factory(row.code, row.enforcementClass) };
  } catch (error) {
    return {
      finding: `runtime diagnostic registry definition factory threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function exactFrozenOwnDataRecord(actual, expected) {
  if (actual === null || typeof actual !== 'object' || !Object.isFrozen(actual)) return false;
  const actualDescriptors = Object.getOwnPropertyDescriptors(actual);
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(Object.keys(actualDescriptors).sort()) !== JSON.stringify(expectedKeys)) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = actualDescriptors[key];
    return (
      descriptor !== undefined &&
      'value' in descriptor &&
      descriptor.value === expected[key] &&
      descriptor.configurable === false &&
      descriptor.enumerable === true &&
      descriptor.writable === false
    );
  });
}

function diagnosticEmissionSiteDigest(emissionSites) {
  const rows = [];
  for (const [code, sites] of emissionSites) {
    for (const site of sites) {
      rows.push(
        `${code}\0${site.file}\0${site.line}\0${site.emitter}\0${site.ownerDigest}\0${site.siteDigest}`,
      );
    }
  }
  return createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}

function diagnosticEmissionOwner(node) {
  let owner = node.parent;
  let outermostFunction;
  while (owner !== undefined && !ts.isSourceFile(owner)) {
    if (ts.isFunctionLike(owner)) outermostFunction = owner;
    owner = owner.parent;
  }
  return outermostFunction ?? owner ?? node.getSourceFile();
}

export function scanDiagnosticProductionSources(
  files,
  { validateSummaryCompleteness = false } = {},
) {
  const cacheKey = validateSummaryCompleteness ? 'full' : 'partial';
  const cached = productionScanCache.get(files)?.get(cacheKey);
  if (cached !== undefined) return cached;
  const observedExcludedReachabilityEdges = new Set();
  const findings = [
    ...validateExcludedSourceReachability(files, observedExcludedReachabilityEdges),
  ];
  const emissionSites = new Map();
  const observedDiagnosticLiteralExemptions = new Set();
  const observedLoaderAuthorityFiles = new Set();
  const observedDynamicDiagnosticShapes = new Set();
  let siteCount = 0;
  const analysis = createProductionAnalysis(files);

  for (const [fileName, sourceFile] of analysis.sourceFiles) {
    if (!isProductionSourcePath(fileName)) continue;
    const hasBoundDiagnostics = analysis.boundFileNames.has(fileName);
    const fileContext = { ...analysis, fileName, sourceFile };
    if (diagnosticLiteralExemptions.has(fileName)) {
      observedDiagnosticLiteralExemptions.add(fileName);
      if (
        validateSummaryCompleteness &&
        diagnosticLiteralExemptions.get(fileName) !==
          createHash('sha256').update(sourceFile.text).digest('hex')
      ) {
        findings.push(
          `${fileName}: diagnostic registry literal exemption requires its exact reviewed full-file digest`,
        );
      }
    }
    const loaderAuthority = findRuntimeModuleLoaderAuthority(sourceFile, fileContext);
    if (loaderAuthority !== undefined) observedLoaderAuthorityFiles.add(fileName);
    if (
      loaderAuthority !== undefined &&
      reviewedRuntimeModuleLoaderAuthorityFiles.get(fileName) !==
        createHash('sha256').update(sourceFile.text).digest('hex')
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        loaderAuthority.getStart(sourceFile),
      );
      findings.push(
        `${fileName}:${position.line + 1}: runtime module loader authority requires an exact full-file capability summary`,
      );
    }
    if (!diagnosticLiteralExemptions.has(fileName)) {
      findings.push(
        ...adHocDiagnosticAssignmentFindings(
          sourceFile,
          fileContext,
          observedDynamicDiagnosticShapes,
        ),
      );
    }

    const visit = (node) => {
      const context = fileContext;
      const acquisitionFinding = diagnosticModuleAcquisitionFinding(node, context);
      if (acquisitionFinding !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`${fileName}:${position.line + 1}: ${acquisitionFinding}`);
      }
      const aliasFinding = hasBoundDiagnostics
        ? diagnosticAliasDeclarationFinding(node, context)
        : undefined;
      if (aliasFinding !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`${fileName}:${position.line + 1}: ${aliasFinding}`);
      }
      const escapeFinding = hasBoundDiagnostics
        ? diagnosticEmitterValueEscapeFinding(node, context)
        : undefined;
      if (escapeFinding !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`${fileName}:${position.line + 1}: ${escapeFinding}`);
      }
      const integrityFinding = hasBoundDiagnostics
        ? diagnosticValueIntegrityFinding(node, context)
        : undefined;
      if (integrityFinding !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`${fileName}:${position.line + 1}: ${integrityFinding}`);
      }
      if (hasBoundDiagnostics && ts.isCallExpression(node)) {
        const resolution = resolveDiagnosticEmitterCall(node, context);
        if (resolution.status === 'rejected') {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push(
            `${fileName}:${position.line + 1}: untrusted diagnostic emitter binding for ${node.expression.getText(sourceFile)} (${resolution.reason})`,
          );
        }
        if (resolution.status === 'approved') {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          let trusted = true;
          if (resolution.target === diagnosticFactoryDoor) {
            const factoryFinding = diagnosticFactoryArgumentFinding(node.arguments[0], context);
            if (factoryFinding !== undefined) {
              findings.push(`${fileName}:${position.line + 1}: ${factoryFinding}`);
              trusted = false;
            }
          }
          const codes = diagnosticCodesAtExactEmissionPosition(node, resolution, sourceFile);
          if (
            codes.size === 0 &&
            diagnosticEmitterRequiresLiteralCode(resolution.target) &&
            !callIsReviewedWrapperDelegation(node, context) &&
            !callIsReviewedDynamicForwarding(node, resolution.target, context)
          ) {
            findings.push(
              `${fileName}:${position.line + 1}: diagnostic emitter ${node.expression.getText(sourceFile)} must bind its code at the exact reviewed code position`,
            );
            trusted = false;
          }
          if (trusted) {
            for (const code of codes) {
              const site = {
                emitter: resolution.emitter,
                file: fileName,
                line: position.line + 1,
                ownerDigest: sourceNodeDigest(diagnosticEmissionOwner(node), sourceFile),
                siteDigest: sourceNodeDigest(node, sourceFile),
              };
              const existing = emissionSites.get(code) ?? [];
              existing.push(site);
              emissionSites.set(code, existing);
              siteCount += 1;
            }
          }
        }
      }

      if (
        (ts.isObjectLiteralExpression(node) || ts.isCallExpression(node)) &&
        !diagnosticLiteralExemptions.has(fileName)
      ) {
        const literal = adHocDiagnosticLiteral(node, context);
        if (literal !== undefined) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          if (literal.code !== undefined) {
            findings.push(
              `${fileName}:${position.line + 1}: ad hoc ${literal.code} production diagnostic literal; use a generated registry constructor`,
            );
          } else {
            const summaryFinding = dynamicDiagnosticShapeSummaryFinding(
              node,
              context,
              'literal',
              observedDynamicDiagnosticShapes,
            );
            if (summaryFinding !== undefined) {
              findings.push(`${fileName}:${position.line + 1}: ${summaryFinding}`);
            }
          }
        }
      }
      if (
        (ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
        !diagnosticLiteralExemptions.has(fileName)
      ) {
        const literal = adHocDiagnosticClass(node, context);
        if (literal !== undefined) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          if (literal.code !== undefined) {
            findings.push(
              `${fileName}:${position.line + 1}: ad hoc ${literal.code} production diagnostic class; use a generated registry constructor`,
            );
          } else {
            const summaryFinding = dynamicDiagnosticShapeSummaryFinding(
              node,
              context,
              'class',
              observedDynamicDiagnosticShapes,
            );
            if (summaryFinding !== undefined) {
              findings.push(`${fileName}:${position.line + 1}: ${summaryFinding}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (validateSummaryCompleteness) {
    for (const edge of reviewedExcludedSourceReachability) {
      if (!observedExcludedReachabilityEdges.has(edge)) {
        findings.push(`stale reviewed excluded-source reachability summary ${edge}`);
      }
    }
    for (const fileName of diagnosticLiteralExemptions.keys()) {
      if (!analysis.sourceFiles.has(fileName)) {
        findings.push(
          `${fileName}: reviewed diagnostic registry literal exemption source is missing`,
        );
      } else if (!observedDiagnosticLiteralExemptions.has(fileName)) {
        findings.push(`${fileName}: stale diagnostic registry literal exemption`);
      }
    }
    for (const fileName of reviewedRuntimeModuleLoaderAuthorityFiles.keys()) {
      if (!analysis.sourceFiles.has(fileName)) {
        findings.push(`${fileName}: reviewed runtime module loader authority source is missing`);
      } else if (!observedLoaderAuthorityFiles.has(fileName)) {
        findings.push(
          `${fileName}: stale runtime module loader authority summary has no owned capability`,
        );
      }
    }
    for (const [summary, reason] of reviewedDynamicDiagnosticShapeSummaries) {
      if (typeof reason !== 'string' || reason.trim().length < 24) {
        findings.push(
          `reviewed dynamic diagnostic-shape summary lacks a substantive reason ${summary}`,
        );
      }
      if (!observedDynamicDiagnosticShapes.has(summary)) {
        findings.push(`stale reviewed dynamic diagnostic-shape summary ${summary}`);
      }
    }
  }

  const result = { emissionSites, findings, siteCount };
  const cachedByMode = productionScanCache.get(files) ?? new Map();
  cachedByMode.set(cacheKey, result);
  productionScanCache.set(files, cachedByMode);
  return result;
}

function findRuntimeModuleLoaderAuthority(sourceFile, context) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (
        (moduleSpecifier === 'node:module' || moduleSpecifier === 'module') &&
        clause !== undefined &&
        !clause.isTypeOnly &&
        (clause.name !== undefined ||
          (clause.namedBindings !== undefined &&
            (ts.isNamespaceImport(clause.namedBindings) ||
              clause.namedBindings.elements.some((element) => !element.isTypeOnly))))
      ) {
        found = node;
        return;
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      (node.moduleSpecifier.text === 'node:module' || node.moduleSpecifier.text === 'module') &&
      !node.isTypeOnly &&
      (node.exportClause === undefined ||
        ts.isNamespaceExport(node.exportClause) ||
        node.exportClause.elements.some((element) => !element.isTypeOnly))
    ) {
      found = node;
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression) &&
      (node.moduleReference.expression.text === 'node:module' ||
        node.moduleReference.expression.text === 'module')
    ) {
      found = node;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      (((node.text === 'createRequire' || node.text === 'getBuiltinModule') &&
        identifierIsRuntimeValueReference(node)) ||
        (node.text === 'require' &&
          identifierIsRuntimeGlobal(node, context) &&
          identifierIsRuntimeValueReference(node)) ||
        (node.text === 'module' &&
          identifierIsRuntimeGlobal(node, context) &&
          ((ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) ||
            (ts.isElementAccessExpression(node.parent) && node.parent.expression === node) ||
            declarationNameIs(node, node.parent))))
    ) {
      found = node;
      return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const member = staticModuleLoaderMember(node, context);
      if (
        member === 'createRequire' ||
        member === 'getBuiltinModule' ||
        (ts.isElementAccessExpression(node) &&
          member === undefined &&
          expressionRootedAtGlobalProcess(node.expression, context, new Set())) ||
        (member === 'require' &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'globalThis' &&
          identifierIsRuntimeGlobal(node.expression, context))
      ) {
        found = node;
        return;
      }
    }
    if (ts.isCallExpression(node)) {
      if (isExactGetBuiltinModuleCall(node, context)) {
        found = node;
        return;
      }
      const loader = runtimeModuleLoaderArgument(node, context);
      if (
        loader.recognized &&
        [...possibleStaticStringValues(loader.argument, context, new Set())].some(
          (moduleSpecifier) => moduleSpecifier === 'node:module' || moduleSpecifier === 'module',
        )
      ) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function expressionRootedAtGlobalProcess(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return false;
  if (ts.isIdentifier(value)) {
    if (value.text === 'process' && identifierIsRuntimeGlobal(value, context)) return true;
    const symbol = context.checker.getSymbolAtLocation(value);
    if (symbol === undefined || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      expressionRootedAtGlobalProcess(declaration.initializer, context, seen)
    );
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const member = staticModuleLoaderMember(value, context);
    return (
      member === 'process' &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === 'globalThis' &&
      identifierIsRuntimeGlobal(value.expression, context)
    );
  }
  return false;
}

function identifierIsRuntimeValueReference(identifier) {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  return true;
}

function declarationNameIs(identifier, parent) {
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent)) &&
    parent.name === identifier
  );
}

function diagnosticAliasDeclarationFinding(node, context) {
  if (ts.isExportSpecifier(node)) {
    const importedName = node.propertyName?.text ?? node.name.text;
    if (aliasSensitiveDiagnosticBindings.has(importedName)) {
      return `diagnostic binding re-export ${importedName} -> ${node.name.text} is forbidden`;
    }
    return undefined;
  }
  if (
    ts.isExportDeclaration(node) &&
    node.exportClause === undefined &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier) &&
    context.fileName !== coreInternalDiagnosticsPath &&
    isReviewedDiagnosticModule(resolveImportModulePath(context.fileName, node.moduleSpecifier.text))
  ) {
    return `diagnostic star re-export from ${node.moduleSpecifier.text} is forbidden`;
  }
  if (ts.isImportSpecifier(node)) {
    const binding = importBindingFromSpecifier(node);
    if (
      binding.localName !== binding.importedName &&
      aliasSensitiveDiagnosticBindings.has(binding.importedName)
    ) {
      return `diagnostic binding alias drift ${binding.localName} -> ${binding.importedName} is forbidden`;
    }
    return undefined;
  }
  if (ts.isNamespaceImport(node)) {
    const importDeclaration = node.parent.parent;
    const moduleSpecifier = importDeclaration.moduleSpecifier.text;
    const modulePath = resolveImportModulePath(context.fileName, moduleSpecifier);
    if (isReviewedDiagnosticModule(modulePath)) {
      return `diagnostic namespace import ${node.name.text} from ${moduleSpecifier} is forbidden`;
    }
    return undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind) &&
    context.boundFileNames.has(context.fileName)
  ) {
    if (ts.isIdentifier(node.right)) {
      const target = resolveIdentifierDiagnosticEmitter(node.right, context);
      if (target.status === 'approved' || target.status === 'rejected') {
        return `assigned diagnostic emitter alias ${node.left.getText(context.sourceFile)} is forbidden`;
      }
    }
    if (
      ts.isPropertyAccessExpression(node.right) &&
      (aliasSensitiveDiagnosticBindings.has(node.right.name.text) ||
        (/^KV\d{3}$/u.test(node.right.name.text) &&
          isDiagnosticConstructorReceiver(node.right.expression, context)))
    ) {
      return `assigned diagnostic member alias ${node.left.getText(context.sourceFile)} is forbidden`;
    }
    if (ts.isIdentifier(node.left)) {
      const symbol = context.checker.getSymbolAtLocation(node.left);
      const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
      if (declaration !== undefined && ts.isParameter(declaration)) {
        if (isExactDiagnosticFactoryType(declaration.type, context)) {
          return `DiagnosticFactory capability reassignment ${node.left.text} is forbidden`;
        }
      }
    }
    const assignedReceiver =
      ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)
        ? node.left.expression
        : undefined;
    if (
      assignedReceiver !== undefined &&
      ts.isIdentifier(assignedReceiver) &&
      diagnosticFactoryIdentifierIsPermitted(assignedReceiver, context)
    ) {
      return `DiagnosticFactory capability property reassignment ${node.left.getText(context.sourceFile)} is forbidden`;
    }
    return undefined;
  }
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return undefined;
  if (!ts.isIdentifier(node.name)) {
    const alias = diagnosticBindingElementAlias(node.name);
    return alias === undefined ? undefined : `diagnostic destructuring alias ${alias} is forbidden`;
  }

  if (ts.isIdentifier(node.initializer) && context.boundFileNames.has(context.fileName)) {
    const target = resolveIdentifierDiagnosticEmitter(node.initializer, context);
    if (target.status === 'approved' || target.status === 'rejected') {
      return `local diagnostic emitter alias ${node.name.text} is forbidden`;
    }
  }
  if (ts.isPropertyAccessExpression(node.initializer)) {
    const member = node.initializer.name.text;
    if (
      aliasSensitiveDiagnosticBindings.has(member) ||
      (/^KV\d{3}$/u.test(member) &&
        isDiagnosticConstructorReceiver(node.initializer.expression, context))
    ) {
      return `local diagnostic member alias ${node.name.text} -> ${member} is forbidden`;
    }
  }
  return undefined;
}

function diagnosticModuleAcquisitionFinding(node, context) {
  let moduleExpression;
  let runtimeLoader = false;
  if (ts.isCallExpression(node)) {
    const loader = runtimeModuleLoaderArgument(node, context);
    runtimeLoader = loader.recognized;
    moduleExpression = loader.argument;
  } else if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    moduleExpression = node.moduleReference.expression;
  }
  if (moduleExpression === undefined) {
    if (runtimeLoader && ts.isCallExpression(node)) {
      return reviewedUnresolvedDynamicModuleAcquisition(node, context)
        ? undefined
        : 'unresolved dynamic module acquisition requires an exact reviewed capability summary';
    }
    if (!context.boundFileNames.has(context.fileName) || !ts.isCallExpression(node)) {
      return undefined;
    }
    const passesReviewedModuleName = node.arguments.some((argument) =>
      [...possibleStaticStringValues(argument, context, new Set())].some((moduleSpecifier) =>
        isReviewedDiagnosticModule(resolveImportModulePath(context.fileName, moduleSpecifier)),
      ),
    );
    return passesReviewedModuleName
      ? 'reviewed diagnostic module specifier may not pass through an unreviewed call'
      : undefined;
  }
  const moduleSpecifiers = possibleStaticStringValues(moduleExpression, context, new Set());
  for (const moduleSpecifier of moduleSpecifiers) {
    const modulePath = resolveImportModulePath(context.fileName, moduleSpecifier);
    if (isReviewedDiagnosticModule(modulePath)) {
      return `dynamic or import-equals acquisition of reviewed diagnostic module ${moduleSpecifier} is forbidden`;
    }
  }
  if (moduleSpecifiers.size === 0 && ts.isCallExpression(node)) {
    return reviewedUnresolvedDynamicModuleAcquisition(node, context)
      ? undefined
      : 'unresolved dynamic module acquisition requires an exact reviewed capability summary';
  }
  return undefined;
}

function runtimeModuleLoaderArgument(call, context) {
  const callee = unwrapTransparentExpression(call.expression);
  if (callee?.kind === ts.SyntaxKind.ImportKeyword) {
    return { argument: call.arguments[0], recognized: true };
  }
  if (runtimeModuleLoaderValue(callee, context, new Set())) {
    return { argument: call.arguments[0], recognized: true };
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === 'call' || callee.name.text === 'apply') &&
    runtimeModuleLoaderValue(callee.expression, context, new Set())
  ) {
    if (callee.name.text === 'call') {
      return { argument: call.arguments[1], recognized: true };
    }
    const args = unwrapTransparentExpression(call.arguments[1]);
    return {
      argument: ts.isArrayLiteralExpression(args) ? args.elements[0] : undefined,
      recognized: true,
    };
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Reflect' &&
    callee.name.text === 'apply' &&
    runtimeModuleLoaderValue(call.arguments[0], context, new Set())
  ) {
    const args = unwrapTransparentExpression(call.arguments[2]);
    return {
      argument: ts.isArrayLiteralExpression(args) ? args.elements[0] : undefined,
      recognized: true,
    };
  }
  return { argument: undefined, recognized: false };
}

function runtimeModuleLoaderValue(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return false;
  if (ts.isIdentifier(value)) {
    const symbol = context.checker.getSymbolAtLocation(value);
    if (
      value.text === 'require' &&
      (symbol === undefined || symbol.declarations?.every(declarationIsRuntimeErased) === true)
    ) {
      return true;
    }
    if (symbol === undefined || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      runtimeModuleLoaderValue(declaration.initializer, context, seen)
    );
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const member = ts.isPropertyAccessExpression(value)
      ? value.name.text
      : staticStringValue(value.argumentExpression, context, new Set());
    const receiver = value.expression;
    const cjsMainRequire =
      member === 'require' &&
      (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) &&
      staticModuleLoaderMember(receiver, context) === 'main' &&
      runtimeModuleLoaderValue(receiver.expression, context, seen);
    return (
      cjsMainRequire ||
      (member === 'require' &&
        ts.isIdentifier(receiver) &&
        (receiver.text === 'globalThis' || receiver.text === 'module') &&
        identifierIsRuntimeGlobal(receiver, context)) ||
      (member === undefined &&
        ((ts.isIdentifier(receiver) &&
          (receiver.text === 'globalThis' || receiver.text === 'module') &&
          identifierIsRuntimeGlobal(receiver, context)) ||
          runtimeModuleLoaderValue(receiver, context, seen)))
    );
  }
  if (ts.isCallExpression(value)) {
    if (isExactCreateRequireCall(value, context)) return true;
    const callee = unwrapTransparentExpression(value.expression);
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'bind' &&
      runtimeModuleLoaderValue(callee.expression, context, seen)
    );
  }
  return false;
}

function staticModuleLoaderMember(expression, context) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return ts.isElementAccessExpression(expression)
    ? staticStringValue(expression.argumentExpression, context, new Set())
    : undefined;
}

function identifierIsRuntimeGlobal(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  return symbol === undefined || symbol.declarations?.every(declarationIsRuntimeErased) === true;
}

function isExactCreateRequireCall(call, context) {
  const callee = unwrapTransparentExpression(call.expression);
  return exactCreateRequireFunctionValue(callee, context, new Set());
}

function exactCreateRequireFunctionValue(expression, context, seen) {
  const callee = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(callee)) {
    const binding = importedBinding(callee, context);
    if (
      binding?.importedName === 'createRequire' &&
      (binding.moduleSpecifier === 'node:module' || binding.moduleSpecifier === 'module')
    ) {
      return true;
    }
    const symbol = context.checker.getSymbolAtLocation(callee);
    if (symbol === undefined || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined
    ) {
      return exactCreateRequireFunctionValue(declaration.initializer, context, seen);
    }
    if (declaration !== undefined && ts.isBindingElement(declaration)) {
      const importedName =
        declaration.propertyName?.getText(context.sourceFile) ??
        (ts.isIdentifier(declaration.name) ? declaration.name.text : undefined);
      const variable = declaration.parent.parent;
      return (
        importedName === 'createRequire' &&
        ts.isVariableDeclaration(variable) &&
        variable.initializer !== undefined &&
        exactNodeModuleNamespaceValue(variable.initializer, context, seen)
      );
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire') {
    return exactNodeModuleNamespaceValue(callee.expression, context, seen);
  }
  return false;
}

function exactNodeModuleNamespaceValue(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(value)) {
    const symbol = context.checker.getSymbolAtLocation(value);
    const namespaceImport = symbol?.declarations?.find(ts.isNamespaceImport);
    const moduleSpecifier = namespaceImport?.parent.parent.moduleSpecifier;
    if (
      moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(moduleSpecifier) &&
      (moduleSpecifier.text === 'node:module' || moduleSpecifier.text === 'module')
    ) {
      return true;
    }
    if (symbol === undefined || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      exactNodeModuleNamespaceValue(declaration.initializer, context, seen)
    );
  }
  if (ts.isCallExpression(value)) {
    if (isExactGetBuiltinModuleCall(value, context)) {
      const moduleSpecifier = staticStringValue(value.arguments[0], context, new Set());
      return moduleSpecifier === 'node:module' || moduleSpecifier === 'module';
    }
    const loader = runtimeModuleLoaderArgument(value, context);
    const moduleSpecifier = staticStringValue(loader.argument, context, new Set());
    return loader.recognized && (moduleSpecifier === 'node:module' || moduleSpecifier === 'module');
  }
  return false;
}

function isExactGetBuiltinModuleCall(call, context) {
  const callee = unwrapTransparentExpression(call.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'getBuiltinModule' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'process' &&
    identifierIsRuntimeGlobal(callee.expression, context)
  );
}

function declarationIsRuntimeErased(declaration) {
  if (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    (ts.isImportSpecifier(declaration) && declaration.isTypeOnly)
  ) {
    return true;
  }
  let owner = declaration;
  while (owner !== undefined && !ts.isSourceFile(owner)) {
    if ((owner.flags & ts.NodeFlags.Ambient) !== 0 || hasDeclareModifier(owner)) return true;
    owner = owner.parent;
  }
  return ts.isFunctionDeclaration(declaration) && declaration.body === undefined;
}

function hasDeclareModifier(node) {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
}

function reviewedUnresolvedDynamicModuleAcquisition(call, context) {
  const key = [
    context.fileName,
    createHash('sha256').update(context.sourceFile.text).digest('hex'),
    sourceNodeDigest(call, context.sourceFile),
  ].join('#');
  return reviewedUnresolvedDynamicModuleAcquisitions.has(key);
}

function staticStringValue(expression, context, seen) {
  const values = possibleStaticStringValues(expression, context, seen);
  return values.size === 1 ? [...values][0] : undefined;
}

function possibleStaticStringValues(expression, context, seen) {
  const result = new Set();
  let value = expression;
  while (
    value !== undefined &&
    (ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isTypeAssertionExpression(value))
  ) {
    value = value.expression;
  }
  if (value === undefined) return result;
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    result.add(value.text);
    return result;
  }
  if (ts.isNumericLiteral(value)) {
    result.add(value.text);
    return result;
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = possibleStaticStringValues(value.left, context, new Set(seen));
    const right = possibleStaticStringValues(value.right, context, new Set(seen));
    for (const leftValue of left) {
      for (const rightValue of right) {
        if (result.size < 32) result.add(`${leftValue}${rightValue}`);
      }
    }
    return result;
  }
  if (ts.isConditionalExpression(value)) {
    for (const candidate of possibleStaticStringValues(value.whenTrue, context, new Set(seen))) {
      result.add(candidate);
    }
    for (const candidate of possibleStaticStringValues(value.whenFalse, context, new Set(seen))) {
      result.add(candidate);
    }
    return result;
  }
  if (ts.isTemplateExpression(value)) {
    let prefixes = new Set([value.head.text]);
    for (const span of value.templateSpans) {
      const substitutions = possibleStaticStringValues(span.expression, context, new Set(seen));
      const next = new Set();
      for (const prefix of prefixes) {
        for (const substitution of substitutions) {
          if (next.size < 32) next.add(`${prefix}${substitution}${span.literal.text}`);
        }
      }
      prefixes = next;
    }
    return prefixes;
  }
  if (ts.isCallExpression(value)) {
    const callee = unwrapTransparentExpression(value.expression);
    if (
      ts.isIdentifier(callee) &&
      callee.text === 'String' &&
      identifierIsRuntimeGlobal(callee, context) &&
      value.arguments.length === 1
    ) {
      return possibleStaticStringValues(value.arguments[0], context, new Set(seen));
    }
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      staticModuleLoaderMember(callee, context) === 'concat'
    ) {
      let prefixes = possibleStaticStringValues(callee.expression, context, new Set(seen));
      for (const argument of value.arguments) {
        const suffixes = possibleStaticStringValues(argument, context, new Set(seen));
        const next = new Set();
        for (const prefix of prefixes) {
          for (const suffix of suffixes) {
            if (next.size < 32) next.add(`${prefix}${suffix}`);
          }
        }
        prefixes = next;
      }
      return prefixes;
    }
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      staticModuleLoaderMember(callee, context) === 'join'
    ) {
      const array = unwrapTransparentExpression(callee.expression);
      const separators =
        value.arguments.length === 0
          ? new Set([','])
          : possibleStaticStringValues(value.arguments[0], context, new Set(seen));
      if (array !== undefined && ts.isArrayLiteralExpression(array)) {
        let rows = new Set(['']);
        for (let index = 0; index < array.elements.length; index += 1) {
          const element = array.elements[index];
          if (ts.isOmittedExpression(element)) continue;
          const elements = possibleStaticStringValues(element, context, new Set(seen));
          const next = new Set();
          for (const row of rows) {
            for (const elementValue of elements) {
              for (const separator of separators) {
                if (next.size < 32) {
                  next.add(index === 0 ? elementValue : `${row}${separator}${elementValue}`);
                }
              }
            }
          }
          rows = next;
        }
        return rows;
      }
    }
    if (
      value.arguments.length === 0 &&
      (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee))
    ) {
      const returns = ts.isBlock(callee.body)
        ? directReturnExpressions(callee.body)
        : [callee.body];
      for (const returned of returns) {
        if (returned === undefined) continue;
        for (const candidate of possibleStaticStringValues(returned, context, new Set(seen))) {
          result.add(candidate);
        }
      }
      return result;
    }
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    const symbol = context.checker.getSymbolAtLocation(value.expression);
    if (symbol === undefined || seen.has(symbol)) return result;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    let functionLike;
    if (declaration !== undefined && ts.isFunctionDeclaration(declaration)) {
      functionLike = declaration;
    }
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      functionLike = declaration.initializer;
    }
    if (functionLike?.body !== undefined) {
      const returns = ts.isBlock(functionLike.body)
        ? directReturnExpressions(functionLike.body)
        : [functionLike.body];
      for (const returned of returns) {
        if (returned === undefined) continue;
        const returnedValue = unwrapTransparentExpression(returned);
        if (returnedValue !== undefined && ts.isIdentifier(returnedValue)) {
          const parameterIndex = functionLike.parameters.findIndex(
            (parameter) =>
              ts.isIdentifier(parameter.name) &&
              context.checker.getSymbolAtLocation(parameter.name) ===
                context.checker.getSymbolAtLocation(returnedValue),
          );
          if (parameterIndex >= 0 && value.arguments[parameterIndex] !== undefined) {
            for (const candidate of possibleStaticStringValues(
              value.arguments[parameterIndex],
              context,
              new Set(seen),
            )) {
              result.add(candidate);
            }
            continue;
          }
        }
        for (const candidate of possibleStaticStringValues(returned, context, new Set(seen))) {
          result.add(candidate);
        }
      }
    }
    return result;
  }
  if (!ts.isIdentifier(value)) return result;
  const symbol = context.checker.getSymbolAtLocation(value);
  if (symbol === undefined || seen.has(symbol)) return result;
  seen.add(symbol);
  const declaration = preferredValueDeclaration(symbol);
  if (
    declaration === undefined ||
    (!ts.isVariableDeclaration(declaration) &&
      !ts.isParameter(declaration) &&
      !ts.isBindingElement(declaration)) ||
    declaration.initializer === undefined ||
    (ts.isVariableDeclaration(declaration) &&
      (!ts.isVariableDeclarationList(declaration.parent) ||
        (declaration.parent.flags & ts.NodeFlags.Const) === 0))
  ) {
    return result;
  }
  return possibleStaticStringValues(declaration.initializer, context, seen);
}

function diagnosticEmitterValueEscapeFinding(node, context) {
  if (ts.isIdentifier(node)) {
    if (identifierIsDeclarationName(node) || identifierIsTypePosition(node)) return undefined;
    const target = directDiagnosticEmitterTarget(node, context);
    if (target !== undefined) {
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) return undefined;
      if (
        target === transferredSqlSafetyDiagnosticRegistrarDoor &&
        isExactTransferredSqlSafetyDiagnosticRegistrarUse(node, context)
      ) {
        return undefined;
      }
      return `diagnostic emitter ${node.text} may only appear as the direct callee of its reviewed call`;
    }
    if (isExactFactoryCreatorBinding(node, context)) {
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) return undefined;
      return `DiagnosticFactory constructor ${node.text} may not escape its exact call position`;
    }
    if (isExactDiagnosticConstructorRegistryBinding(node, context)) {
      const member = node.parent;
      if (
        ts.isPropertyAccessExpression(member) &&
        member.expression === node &&
        /^KV\d{3}$/u.test(member.name.text) &&
        ts.isCallExpression(member.parent) &&
        member.parent.expression === member
      ) {
        return undefined;
      }
      return `diagnostic constructor registry ${node.text} may only select a generated KV constructor as a direct callee`;
    }
  }

  if (
    ts.isPropertyAccessExpression(node) &&
    /^KV\d{3}$/u.test(node.name.text) &&
    ts.isIdentifier(node.expression) &&
    isExactDiagnosticConstructorRegistryBinding(node.expression, context) &&
    !(ts.isCallExpression(node.parent) && node.parent.expression === node)
  ) {
    return `generated diagnostic constructor ${node.getText(context.sourceFile)} may not escape its exact call position`;
  }
  return undefined;
}

function isExactTransferredSqlSafetyDiagnosticRegistrarUse(identifier, context) {
  if (
    context.fileName !== 'packages/server/src/internal/data-plane-static-analysis.ts' ||
    identifier.text !== 'registerTransferredSqlSafetyDiagnostic'
  ) {
    return false;
  }
  const call = identifier.parent;
  if (
    !ts.isCallExpression(call) ||
    call.arguments.length !== 2 ||
    call.arguments[1] !== identifier ||
    !ts.isIdentifier(call.expression) ||
    !isExactImportedOrLocalBinding(
      call.expression,
      '@kovojs/drizzle/internal/static',
      'extractStaticBuildAnalysisFactsFromProject',
      context,
    ) ||
    sourceNodeDigest(call, context.sourceFile) !==
      expectedTransferredSqlSafetyDiagnosticRegistrarCallDigest
  ) {
    return false;
  }
  const options = call.arguments[0];
  if (
    !ts.isObjectLiteralExpression(options) ||
    options.properties.length !== 2 ||
    !ts.isSpreadAssignment(options.properties[0]) ||
    !ts.isShorthandPropertyAssignment(options.properties[1]) ||
    options.properties[1].name.text !== 'files'
  ) {
    return false;
  }
  let owner = call.parent;
  while (owner !== undefined && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
  return (
    owner !== undefined &&
    owner.parent === context.sourceFile &&
    owner.name?.text === 'runStaticBuildAnalysisFacts' &&
    sourceNodeDigest(owner, context.sourceFile) === expectedStaticBuildAnalysisFactsOwnerDigest
  );
}

function identifierIsDeclarationName(identifier) {
  const parent = identifier.parent;
  return (
    ((ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isClassDeclaration(parent)) &&
      parent.name === identifier) ||
    (ts.isImportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
  );
}

function identifierIsTypePosition(identifier) {
  let node = identifier.parent;
  while (node !== undefined) {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return true;
    }
    if (ts.isExpression(node) || ts.isStatement(node) || ts.isSourceFile(node)) return false;
    node = node.parent;
  }
  return false;
}

function directDiagnosticEmitterTarget(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  if (declaration === undefined) return undefined;
  if (ts.isImportSpecifier(declaration)) {
    return reviewedImportTarget(context.fileName, importBindingFromSpecifier(declaration), context);
  }
  if (!ts.isFunctionDeclaration(declaration) || declaration.parent !== context.sourceFile) {
    return undefined;
  }
  const name = declaration.name?.text;
  if (name === undefined) return undefined;
  const key = `${context.fileName}#${name}`;
  return key === rootDiagnosticDoor ||
    key === diagnosticFactoryDoor ||
    reviewedDiagnosticWrappers.has(key)
    ? key
    : undefined;
}

function isExactFactoryCreatorBinding(identifier, context) {
  return isExactImportedOrLocalBinding(
    identifier,
    compilerDiagnosticsPath,
    'createDiagnosticFactory',
    context,
  );
}

function isExactDiagnosticConstructorRegistryBinding(identifier, context) {
  const binding = importedBinding(identifier, context);
  return (
    binding !== undefined &&
    binding.localName === 'diagnosticConstructors' &&
    binding.importedName === 'diagnosticConstructors' &&
    resolveImportModulePath(context.fileName, binding.moduleSpecifier) ===
      coreInternalDiagnosticsPath &&
    bridgeResolvesExactExport('diagnosticConstructors', context)
  );
}

function isDiagnosticConstructorReceiver(receiver, context) {
  if (!ts.isIdentifier(receiver) || !context.boundFileNames.has(context.fileName)) return false;
  return isExactDiagnosticConstructorRegistryBinding(receiver, context);
}

function diagnosticBindingElementAlias(name) {
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken !== undefined) continue;
    const propertyName = element.propertyName;
    const importedName =
      propertyName !== undefined &&
      (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
        ? propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
    if (importedName !== undefined && aliasSensitiveDiagnosticBindings.has(importedName)) {
      const localName = ts.isIdentifier(element.name) ? element.name.text : '<nested>';
      return `${localName} -> ${importedName}`;
    }
    if (!ts.isIdentifier(element.name)) {
      const nested = diagnosticBindingElementAlias(element.name);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function isReviewedDiagnosticModule(modulePath) {
  if (
    modulePath === coreDiagnosticsPath ||
    modulePath === coreInternalDiagnosticsPath ||
    modulePath === generatedDiagnosticRegistryModulePath ||
    modulePath === compilerDiagnosticsPath
  ) {
    return true;
  }
  return [...reviewedDiagnosticWrappers.keys()].some((key) => key.startsWith(`${modulePath}#`));
}

function createProductionAnalysis(files) {
  const cached = productionAnalysisCache.get(files);
  if (cached !== undefined) return cached;
  const sourceFiles = new Map();
  for (const file of files) {
    const fileName = normalizePath(file.path);
    if (!isProductionSourcePath(fileName)) continue;
    sourceFiles.set(
      fileName,
      ts.createSourceFile(
        fileName,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        sourceScriptKind(fileName),
      ),
    );
  }
  const compilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    resolvePackageJsonExports: false,
    resolvePackageJsonImports: false,
    target: ts.ScriptTarget.Latest,
  };
  const host = {
    fileExists: (fileName) => sourceFiles.has(normalizePath(fileName)),
    getCanonicalFileName: (fileName) => normalizePath(fileName),
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => '',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: (fileName) => sourceFiles.get(normalizePath(fileName)),
    readFile: (fileName) => sourceFiles.get(normalizePath(fileName))?.text,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  // Every production source participates in the TypeScript program. Raw-source regex admission is
  // not a safe denominator: JavaScript identifier and string escapes are decoded only by the parser.
  const rootNames = [...sourceFiles.keys()];
  const program = ts.createProgram({
    host,
    options: compilerOptions,
    rootNames,
  });
  const boundFileNames = new Set(
    [...sourceFiles]
      .filter(
        ([fileName, sourceFile]) =>
          diagnosticBindingCandidateSourceFile(sourceFile, fileName) ||
          fileName === coreInternalDiagnosticsPath ||
          fileName === coreDiagnosticsPath ||
          fileName === compilerDiagnosticsPath ||
          [...reviewedDiagnosticWrappers.keys()].some((key) => key.startsWith(`${fileName}#`)),
      )
      .map(([fileName]) => fileName),
  );
  const analysis = {
    boundFileNames,
    checker: program.getTypeChecker(),
    sourceFiles,
  };
  productionAnalysisCache.set(files, analysis);
  return analysis;
}

function diagnosticBindingCandidateSourceFile(sourceFile, fileName) {
  let candidate = false;
  const visit = (node) => {
    if (candidate) return;
    if (
      (ts.isIdentifier(node) && aliasSensitiveDiagnosticBindings.has(node.text)) ||
      (ts.isStringLiteralLike(node) && /^KV\d{3}$/u.test(node.text)) ||
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'at' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'diagnostics') ||
      ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        isReviewedDiagnosticModule(resolveImportModulePath(fileName, node.moduleSpecifier.text)))
    ) {
      candidate = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidate;
}

function sourceScriptKind(fileName) {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:mjs|cjs|js)$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function resolveDiagnosticEmitterCall(call, context) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    return resolveIdentifierDiagnosticEmitter(expression, context);
  }
  if (!ts.isPropertyAccessExpression(expression)) return { status: 'none' };

  const member = expression.name.text;
  if (/^KV\d{3}$/u.test(member)) {
    if (!ts.isIdentifier(expression.expression)) {
      return {
        reason: 'generated constructor receiver must be the exact named import',
        status: 'rejected',
      };
    }
    const binding = importedBinding(expression.expression, context);
    if (binding === undefined || binding.importedName !== 'diagnosticConstructors') {
      return {
        reason: 'generated constructor receiver is a local/lookalike binding',
        status: 'rejected',
      };
    }
    if (binding.localName !== binding.importedName) {
      return {
        reason: 'generated constructor import aliases are not census-stable',
        status: 'rejected',
      };
    }
    const modulePath = resolveImportModulePath(context.fileName, binding.moduleSpecifier);
    if (
      modulePath !== coreInternalDiagnosticsPath ||
      !bridgeResolvesExactExport('diagnosticConstructors', context)
    ) {
      return {
        reason: `diagnosticConstructors must resolve through the exact ${coreInternalDiagnosticsPath} re-export`,
        status: 'rejected',
      };
    }
    return {
      constructorCode: member,
      emitter: `diagnosticConstructors.${member}`,
      status: 'approved',
      target: generatedDiagnosticConstructorDoor,
    };
  }

  if (member === 'at') {
    const receiver = expression.expression;
    if (
      (ts.isIdentifier(receiver) &&
        (/(?:diagnostic|factory)/iu.test(receiver.text) ||
          diagnosticFactoryIdentifierIsPermitted(receiver, context))) ||
      literalDiagnosticCode(call.arguments[0]) !== undefined
    ) {
      return {
        reason:
          'structural DiagnosticFactory.at calls are forbidden; use the runtime-owned diagnosticAt sink',
        status: 'rejected',
      };
    }
    return { status: 'none' };
  }
  if (reviewedDiagnosticEmitterNames.has(member)) {
    return {
      reason: 'namespace/member lookalikes are forbidden; import the reviewed symbol by name',
      status: 'rejected',
    };
  }
  return { status: 'none' };
}

function resolveIdentifierDiagnosticEmitter(identifier, context, seen = new Set()) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'unbound reviewed-emitter spelling', status: 'rejected' }
      : { status: 'none' };
  }
  if (seen.has(symbol)) return { reason: 'diagnostic emitter alias cycle', status: 'rejected' };
  seen.add(symbol);

  const declaration = preferredValueDeclaration(symbol);
  if (declaration === undefined) {
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'reviewed-emitter spelling has no resolvable declaration', status: 'rejected' }
      : { status: 'none' };
  }

  if (ts.isImportSpecifier(declaration)) {
    const binding = importBindingFromSpecifier(declaration);
    const target = reviewedImportTarget(context.fileName, binding, context);
    if (target !== undefined) {
      if (binding.localName !== binding.importedName) {
        return {
          reason: `alias drift ${binding.localName} -> ${binding.importedName} is forbidden`,
          status: 'rejected',
        };
      }
      return {
        emitter: binding.importedName,
        status: 'approved',
        target,
      };
    }
    return reviewedDiagnosticEmitterNames.has(binding.localName) ||
      reviewedDiagnosticEmitterNames.has(binding.importedName)
      ? {
          reason: `import does not resolve to a reviewed emitter definition (${binding.moduleSpecifier})`,
          status: 'rejected',
        }
      : { status: 'none' };
  }

  if (ts.isFunctionDeclaration(declaration)) {
    const name = declaration.name?.text;
    const key = name === undefined ? undefined : `${context.fileName}#${name}`;
    if (
      (key === rootDiagnosticDoor ||
        key === diagnosticFactoryDoor ||
        reviewedDiagnosticWrappers.has(key)) &&
      declaration.parent === context.sourceFile
    ) {
      return { emitter: name, status: 'approved', target: key };
    }
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'local function shadows a reviewed emitter name', status: 'rejected' }
      : { status: 'none' };
  }

  if (ts.isVariableDeclaration(declaration)) {
    const initializer = declaration.initializer;
    if (initializer !== undefined && ts.isIdentifier(initializer)) {
      const target = resolveIdentifierDiagnosticEmitter(initializer, context, seen);
      if (target.status === 'approved' || target.status === 'rejected') {
        return {
          reason: `local alias ${identifier.text} obscures the reviewed emitter binding`,
          status: 'rejected',
        };
      }
    }
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'local variable shadows a reviewed emitter name', status: 'rejected' }
      : { status: 'none' };
  }

  return reviewedDiagnosticEmitterNames.has(identifier.text)
    ? {
        reason: `${ts.SyntaxKind[declaration.kind]} shadows a reviewed emitter name`,
        status: 'rejected',
      }
    : { status: 'none' };
}

function diagnosticFactoryArgumentFinding(argument, context) {
  if (!ts.isIdentifier(argument)) {
    return 'diagnosticAt factory argument must be one exact runtime-owned capability binding';
  }
  if (!diagnosticFactoryIdentifierIsPermitted(argument, context)) {
    return `diagnosticAt factory argument ${argument.text} is annotation-only, forged, or not minted by createDiagnosticFactory`;
  }
  const symbol = context.checker.getSymbolAtLocation(argument);
  if (symbol !== undefined && bindingIsReassignedInScope(symbol, argument, context)) {
    return `DiagnosticFactory capability binding ${argument.text} was reassigned before emission`;
  }
  return undefined;
}

function diagnosticFactoryIdentifierIsPermitted(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  if (declaration === undefined) return false;
  if (ts.isParameter(declaration)) {
    return isExactDiagnosticFactoryType(declaration.type, context);
  }
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return false;
  const declarationList = declaration.parent;
  if (
    !ts.isVariableDeclarationList(declarationList) ||
    (declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    return false;
  }
  const initializer = declaration.initializer;
  return (
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    isExactFactoryCreatorBinding(initializer.expression, context)
  );
}

function bindingIsReassignedInScope(symbol, use, context) {
  let scope = use.parent;
  while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  if (scope === undefined) return false;
  let assigned = false;
  const visit = (node) => {
    if (assigned) return;
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind) &&
      assignmentTargetReferencesSymbol(node.left, symbol, context)
    ) {
      assigned = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      assignmentTargetReferencesSymbol(node.operand, symbol, context)
    ) {
      assigned = true;
      return;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      assignmentTargetReferencesSymbol(node.initializer, symbol, context)
    ) {
      assigned = true;
      return;
    }
    if (
      ts.isDeleteExpression(node) &&
      assignmentTargetReferencesSymbol(node.expression, symbol, context)
    ) {
      assigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return assigned;
}

function assignmentTargetReferencesSymbol(target, symbol, context) {
  let matches = false;
  const visit = (node) => {
    if (matches) return;
    if (ts.isIdentifier(node) && context.checker.getSymbolAtLocation(node) === symbol) {
      matches = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(target);
  return matches;
}

function isExactDiagnosticFactoryType(typeNode, context) {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return false;
  if (!ts.isIdentifier(typeNode.typeName) || typeNode.typeName.text !== 'DiagnosticFactory') {
    return false;
  }
  return isExactImportedOrLocalBinding(
    typeNode.typeName,
    compilerDiagnosticsPath,
    'DiagnosticFactory',
    context,
  );
}

function isExactImportedOrLocalBinding(identifier, expectedFile, expectedName, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  if (declaration === undefined) return false;
  if (ts.isImportSpecifier(declaration)) {
    const binding = importBindingFromSpecifier(declaration);
    return (
      binding.localName === expectedName &&
      binding.importedName === expectedName &&
      resolveImportModulePath(context.fileName, binding.moduleSpecifier) === expectedFile
    );
  }
  if (
    (ts.isInterfaceDeclaration(declaration) ||
      ts.isFunctionDeclaration(declaration) ||
      ts.isVariableDeclaration(declaration)) &&
    declaration.name !== undefined &&
    ts.isIdentifier(declaration.name)
  ) {
    return context.fileName === expectedFile && declaration.name.text === expectedName;
  }
  return false;
}

function importedBinding(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  return declaration !== undefined && ts.isImportSpecifier(declaration)
    ? importBindingFromSpecifier(declaration)
    : undefined;
}

function preferredValueDeclaration(symbol) {
  return symbol.declarations?.find(
    (declaration) =>
      ts.isImportSpecifier(declaration) ||
      ts.isFunctionDeclaration(declaration) ||
      ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isInterfaceDeclaration(declaration) ||
      ts.isBindingElement(declaration),
  );
}

function importBindingFromSpecifier(specifier) {
  const importDeclaration = specifier.parent.parent.parent;
  return {
    importedName: specifier.propertyName?.text ?? specifier.name.text,
    localName: specifier.name.text,
    moduleSpecifier: importDeclaration.moduleSpecifier.text,
  };
}

function reviewedImportTarget(fileName, binding, context) {
  const modulePath = resolveImportModulePath(fileName, binding.moduleSpecifier);
  if (
    modulePath === coreInternalDiagnosticsPath &&
    binding.importedName === 'createRegisteredDiagnostic'
  ) {
    return bridgeResolvesExactExport('createRegisteredDiagnostic', context)
      ? rootDiagnosticDoor
      : undefined;
  }
  if (
    modulePath === coreInternalDiagnosticsPath &&
    binding.importedName === 'deriveRegisteredDiagnostic'
  ) {
    return bridgeResolvesExactExport('deriveRegisteredDiagnostic', context)
      ? derivedDiagnosticDoor
      : undefined;
  }
  if (modulePath === coreDiagnosticsPath && binding.importedName === 'createRegisteredDiagnostic') {
    return rootDiagnosticDoor;
  }
  if (modulePath === compilerDiagnosticsPath && binding.importedName === 'diagnosticAt') {
    return diagnosticFactoryDoor;
  }
  const wrapperKey = `${modulePath}#${binding.importedName}`;
  return reviewedDiagnosticWrappers.has(wrapperKey) ? wrapperKey : undefined;
}

function bridgeResolvesExactExport(exportedName, context) {
  const expectedModulePath = protectedCoreBridgeExports.get(exportedName);
  const bridge = context.sourceFiles.get(coreInternalDiagnosticsPath);
  if (expectedModulePath === undefined || bridge === undefined) return false;
  if (exactStarExportCount(bridge, coreInternalDiagnosticsPath, expectedModulePath) !== 1) {
    return false;
  }
  for (const statement of bridge.statements) {
    if (explicitlyExportsName(statement, exportedName)) return false;
  }
  return protectedBridgeSourceOwnershipIsExact(exportedName, context);
}

function protectedBridgeSourceOwnershipIsExact(exportedName, context) {
  const ownerPath = protectedCoreBridgeExports.get(exportedName);
  const owner = ownerPath === undefined ? undefined : context.sourceFiles.get(ownerPath);
  if (
    ownerPath === undefined ||
    owner === undefined ||
    !owner.statements.some((statement) => explicitlyExportsName(statement, exportedName))
  ) {
    return false;
  }
  for (const candidatePath of protectedCoreBridgeExports.values()) {
    if (candidatePath === ownerPath) continue;
    const candidate = context.sourceFiles.get(candidatePath);
    if (candidate?.statements.some((statement) => explicitlyExportsName(statement, exportedName))) {
      return false;
    }
  }
  return true;
}

function resolveImportModulePath(fileName, moduleSpecifier) {
  if (moduleSpecifier === '@kovojs/core/internal/diagnostics') {
    return coreInternalDiagnosticsPath;
  }
  if (!moduleSpecifier.startsWith('.')) return moduleSpecifier;
  const resolved = normalizePath(
    path.posix.normalize(path.posix.join(path.posix.dirname(fileName), moduleSpecifier)),
  );
  if (/\.(?:js|mjs|cjs)$/u.test(resolved)) return resolved.replace(/\.(?:mjs|cjs|js)$/u, '.ts');
  if (resolved.endsWith('.ts')) return resolved;
  return `${resolved}.ts`;
}

function diagnosticCodesAtExactEmissionPosition(call, resolution, sourceFile) {
  const codes = new Set();
  if (resolution.constructorCode !== undefined) codes.add(resolution.constructorCode);
  const position = diagnosticEmitterCodePositions.get(resolution.target);
  if (position === undefined) return codes;
  const argument = call.arguments[position.argument];
  if (argument === undefined) return codes;
  const codeExpression =
    position.property === undefined
      ? argument
      : ts.isObjectLiteralExpression(argument)
        ? objectLiteralOwnPropertyInitializer(argument, position.property, sourceFile)
        : undefined;
  const code = literalDiagnosticCode(codeExpression);
  if (code !== undefined) codes.add(code);
  return codes;
}

function literalDiagnosticCode(expression) {
  let value = expression;
  while (
    value !== undefined &&
    (ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isTypeAssertionExpression(value))
  ) {
    value = value.expression;
  }
  return value !== undefined && ts.isStringLiteralLike(value) && /^KV\d{3}$/u.test(value.text)
    ? value.text
    : undefined;
}

function objectLiteralOwnPropertyInitializer(object, name, sourceFile) {
  let initializer;
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name, sourceFile) === name) {
      if (initializer !== undefined) return undefined;
      initializer = property.initializer;
      continue;
    }
    if (initializer !== undefined && objectPropertyMayOverride(property, name, sourceFile)) {
      return undefined;
    }
  }
  return initializer;
}

function objectPropertyMayOverride(property, name, sourceFile) {
  if (ts.isSpreadAssignment(property)) return true;
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
  if (property.name === undefined) return false;
  if (ts.isComputedPropertyName(property.name)) {
    return (
      !ts.isStringLiteralLike(property.name.expression) || property.name.expression.text === name
    );
  }
  return propertyNameText(property.name, sourceFile) === name;
}

function diagnosticEmitterRequiresLiteralCode(target) {
  return diagnosticEmitterCodePositions.has(target);
}

function callIsReviewedWrapperDelegation(call, context) {
  let owner = call.parent;
  while (owner !== undefined) {
    if (ts.isFunctionDeclaration(owner)) {
      const name = owner.name?.text;
      const key = name === undefined ? undefined : `${context.fileName}#${name}`;
      return (
        key === diagnosticFactoryDoor ||
        key === generatedDiagnosticConstructorDoor ||
        reviewedDiagnosticWrappers.has(key)
      );
    }
    owner = owner.parent;
  }
  return false;
}

function callIsReviewedDynamicForwarding(call, target, context) {
  if (
    target !== 'packages/server/src/static-export-diagnostics.ts#blockingStaticExportDiagnostic'
  ) {
    return false;
  }
  let owner = call.parent;
  while (owner !== undefined && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
  const argument = call.arguments[0];
  if (
    owner === undefined ||
    owner.name?.text !== 'blockingStaticExportDiagnostics' ||
    context.fileName !== 'packages/server/src/static-export-diagnostics.ts' ||
    !ts.isIdentifier(argument)
  ) {
    return false;
  }
  const diagnosticSymbol = context.checker.getSymbolAtLocation(argument);
  const diagnosticDeclaration =
    diagnosticSymbol === undefined ? undefined : preferredValueDeclaration(diagnosticSymbol);
  if (
    diagnosticSymbol === undefined ||
    diagnosticDeclaration === undefined ||
    !ts.isVariableDeclaration(diagnosticDeclaration) ||
    !ts.isIdentifier(diagnosticDeclaration.name) ||
    !ts.isVariableDeclarationList(diagnosticDeclaration.parent) ||
    (diagnosticDeclaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    diagnosticDeclaration.initializer === undefined ||
    bindingIsReassignedInScope(diagnosticSymbol, argument, context)
  ) {
    return false;
  }
  const indexedDiagnostic = unwrapTransparentExpression(diagnosticDeclaration.initializer);
  if (
    !ts.isElementAccessExpression(indexedDiagnostic) ||
    !ts.isIdentifier(indexedDiagnostic.expression)
  ) {
    return false;
  }
  const sourceSymbol = context.checker.getSymbolAtLocation(indexedDiagnostic.expression);
  const sourceDeclaration =
    sourceSymbol === undefined ? undefined : preferredValueDeclaration(sourceSymbol);
  const diagnosticsParameter = owner.parameters[0];
  if (
    sourceSymbol === undefined ||
    sourceDeclaration === undefined ||
    !ts.isVariableDeclaration(sourceDeclaration) ||
    !ts.isVariableDeclarationList(sourceDeclaration.parent) ||
    (sourceDeclaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    sourceDeclaration.initializer === undefined ||
    !ts.isCallExpression(sourceDeclaration.initializer) ||
    !ts.isIdentifier(sourceDeclaration.initializer.expression) ||
    !isExactImportedOrLocalBinding(
      sourceDeclaration.initializer.expression,
      serverBuildSecurityIntrinsicsPath,
      'snapshotBuildArray',
      context,
    ) ||
    sourceDeclaration.initializer.arguments.length < 1 ||
    !ts.isIdentifier(sourceDeclaration.initializer.arguments[0]) ||
    diagnosticsParameter === undefined ||
    !ts.isIdentifier(diagnosticsParameter.name) ||
    context.checker.getSymbolAtLocation(sourceDeclaration.initializer.arguments[0]) !==
      context.checker.getSymbolAtLocation(diagnosticsParameter.name) ||
    bindingIsReassignedInScope(sourceSymbol, indexedDiagnostic.expression, context)
  ) {
    return false;
  }
  const references = symbolIdentifierOccurrences(owner, diagnosticSymbol, context);
  const provenanceAssertion = references.some((reference) => {
    const call = reference.parent;
    const binding =
      ts.isCallExpression(call) && ts.isIdentifier(call.expression)
        ? importedBinding(call.expression, context)
        : undefined;
    return (
      ts.isCallExpression(call) &&
      call.arguments[0] === reference &&
      binding?.moduleSpecifier === '@kovojs/core/internal/diagnostics' &&
      binding.importedName === 'assertRegisteredDiagnostic' &&
      binding.localName === 'assertRegisteredDiagnostic'
    );
  });
  return (
    references.length === 4 &&
    references.includes(diagnosticDeclaration.name) &&
    references.includes(argument) &&
    provenanceAssertion &&
    references.some(
      (reference) =>
        ts.isPropertyAccessExpression(reference.parent) &&
        reference.parent.expression === reference &&
        reference.parent.name.text === 'code',
    )
  );
}

function symbolIdentifierOccurrences(root, symbol, context) {
  const matches = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && context.checker.getSymbolAtLocation(node) === symbol) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function diagnosticValueIntegrityFinding(node, context) {
  if (ts.isObjectLiteralExpression(node)) {
    let containsRegisteredDiagnostic = false;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (containsRegisteredDiagnostic) {
          return 'spread after a registered diagnostic may override its code or severity';
        }
        if (diagnosticValueDerivesFromRegistered(property.expression, context, new Set())) {
          containsRegisteredDiagnostic = true;
        }
        continue;
      }
      if (
        containsRegisteredDiagnostic &&
        objectPropertyMayOverrideDiagnosticIdentity(property, context)
      ) {
        return 'registered diagnostic code/severity override is forbidden';
      }
    }
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind) &&
    diagnosticIdentityMutationTarget(node.left, context)
  ) {
    return 'registered diagnostic code/severity mutation is forbidden';
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    diagnosticIdentityMutationTarget(node.operand, context)
  ) {
    return 'registered diagnostic code/severity mutation is forbidden';
  }
  if (ts.isDeleteExpression(node) && diagnosticIdentityMutationTarget(node.expression, context)) {
    return 'registered diagnostic code/severity mutation is forbidden';
  }
  if (ts.isCallExpression(node)) {
    if (objectAssignOverridesRegisteredDiagnostic(node, context)) {
      return 'registered diagnostic code/severity override is forbidden';
    }
    if (mutatesRegisteredDiagnosticIdentity(node, context)) {
      return 'registered diagnostic code/severity mutation is forbidden';
    }
  }
  return undefined;
}

function diagnosticValueDerivesFromRegistered(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return false;
  if (ts.isCallExpression(value)) {
    if (resolveDiagnosticEmitterCall(value, context).status === 'approved') return true;
    if (ts.isIdentifier(value.expression)) {
      const calleeSymbol = context.checker.getSymbolAtLocation(value.expression);
      if (calleeSymbol !== undefined && !seen.has(calleeSymbol)) {
        const callee = preferredValueDeclaration(calleeSymbol);
        if (callee !== undefined && ts.isFunctionDeclaration(callee) && callee.body !== undefined) {
          seen.add(calleeSymbol);
          if (
            directReturnExpressions(callee.body).some(
              (returned) =>
                returned !== undefined &&
                diagnosticValueDerivesFromRegistered(returned, context, new Set(seen)),
            )
          ) {
            return true;
          }
        }
      }
    }
    return value.arguments.some((argument) =>
      diagnosticValueDerivesFromRegistered(argument, context, new Set(seen)),
    );
  }
  if (ts.isConditionalExpression(value)) {
    return (
      diagnosticValueDerivesFromRegistered(value.whenTrue, context, new Set(seen)) ||
      diagnosticValueDerivesFromRegistered(value.whenFalse, context, new Set(seen))
    );
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      value.operatorToken.kind === ts.SyntaxKind.CommaToken)
  ) {
    return (
      diagnosticValueDerivesFromRegistered(value.left, context, new Set(seen)) ||
      diagnosticValueDerivesFromRegistered(value.right, context, new Set(seen))
    );
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) &&
        diagnosticValueDerivesFromRegistered(element, context, new Set(seen)),
    );
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const selected = staticallySelectedContainerValue(value, context, new Set(seen));
    return (
      selected !== undefined &&
      diagnosticValueDerivesFromRegistered(selected, context, new Set(seen))
    );
  }
  if (ts.isObjectLiteralExpression(value)) {
    let derives = false;
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (derives) return false;
        if (diagnosticValueDerivesFromRegistered(property.expression, context, new Set(seen))) {
          derives = true;
        }
      } else if (derives && objectPropertyMayOverrideDiagnosticIdentity(property, context)) {
        return false;
      }
    }
    return derives;
  }
  if (!ts.isIdentifier(value)) return false;
  const symbol =
    ts.isShorthandPropertyAssignment(value.parent) && value.parent.name === value
      ? (context.checker.getShorthandAssignmentValueSymbol(value.parent) ??
        context.checker.getSymbolAtLocation(value))
      : context.checker.getSymbolAtLocation(value);
  if (symbol === undefined || seen.has(symbol)) return false;
  seen.add(symbol);
  const declaration = preferredValueDeclaration(symbol);
  return (
    declaration !== undefined &&
    (ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isBindingElement(declaration)) &&
    declaration.initializer !== undefined &&
    diagnosticValueDerivesFromRegistered(declaration.initializer, context, seen)
  );
}

function staticallySelectedContainerValue(access, context, seen) {
  const receiver = resolveContainerExpression(access.expression, context, seen);
  if (receiver === undefined) return undefined;
  if (ts.isPropertyAccessExpression(access)) {
    return objectLiteralPropertyValue(receiver, access.name.text, context);
  }
  const key = staticElementKey(access.argumentExpression, context);
  if (key === undefined) return undefined;
  if (ts.isArrayLiteralExpression(receiver) && typeof key === 'number') {
    const element = receiver.elements[key];
    return element !== undefined && !ts.isOmittedExpression(element) ? element : undefined;
  }
  return typeof key === 'string' ? objectLiteralPropertyValue(receiver, key, context) : undefined;
}

function resolveContainerExpression(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return undefined;
  if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(value);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  const declaration = preferredValueDeclaration(symbol);
  return declaration !== undefined &&
    (ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isBindingElement(declaration)) &&
    declaration.initializer !== undefined
    ? resolveContainerExpression(declaration.initializer, context, seen)
    : undefined;
}

function objectLiteralPropertyValue(object, name, context) {
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  let selected;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      selected = undefined;
      continue;
    }
    if (property.name === undefined || staticPropertyName(property.name, context) !== name)
      continue;
    if (ts.isPropertyAssignment(property)) selected = property.initializer;
    else if (ts.isShorthandPropertyAssignment(property)) selected = property.name;
    else selected = undefined;
  }
  return selected;
}

function staticElementKey(expression, context) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return undefined;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  return staticStringValue(value, context, new Set());
}

function objectPropertyMayOverrideDiagnosticIdentity(property, context) {
  if (ts.isSpreadAssignment(property)) return true;
  if (property.name === undefined) return false;
  const name = staticPropertyName(property.name, context);
  return name === undefined || name === 'code' || name === 'severity';
}

function diagnosticIdentityMutationTarget(target, context) {
  const value = unwrapTransparentExpression(target);
  if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) return false;
  const receiver = value.expression;
  if (!diagnosticValueDerivesFromRegistered(receiver, context, new Set())) return false;
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === 'code' || value.name.text === 'severity';
  }
  const property = staticStringValue(value.argumentExpression, context, new Set());
  return property === undefined || property === 'code' || property === 'severity';
}

function mutatesRegisteredDiagnosticIdentity(call, context) {
  if (
    callTargetsStaticMember(call, 'Object', 'assign', context) ||
    callTargetsStaticMember(call, 'Object', 'defineProperty', context) ||
    callTargetsStaticMember(call, 'Object', 'defineProperties', context) ||
    callTargetsStaticMember(call, 'Reflect', 'set', context) ||
    callTargetsStaticMember(call, 'Reflect', 'defineProperty', context) ||
    callTargetsStaticMember(call, 'Reflect', 'deleteProperty', context)
  ) {
    return (
      call.arguments[0] !== undefined &&
      diagnosticValueDerivesFromRegistered(call.arguments[0], context, new Set())
    );
  }
  return false;
}

function objectAssignOverridesRegisteredDiagnostic(call, context) {
  if (!callTargetsStaticMember(call, 'Object', 'assign', context)) {
    return false;
  }
  let containsRegisteredDiagnostic = false;
  for (const argument of call.arguments) {
    if (
      containsRegisteredDiagnostic &&
      expressionMayCarryDiagnosticIdentityOverride(argument, context)
    ) {
      return true;
    }
    if (diagnosticValueDerivesFromRegistered(argument, context, new Set())) {
      containsRegisteredDiagnostic = true;
    }
  }
  return false;
}

function expressionMayCarryDiagnosticIdentityOverride(expression, context) {
  const value = unwrapTransparentExpression(expression);
  if (!ts.isObjectLiteralExpression(value)) return true;
  return value.properties.some(
    (property) =>
      ts.isSpreadAssignment(property) ||
      objectPropertyMayOverrideDiagnosticIdentity(property, context),
  );
}

function adHocDiagnosticLiteral(node, context) {
  const shape = diagnosticLiteralShape(node, context, new Set());
  return shape.hasCode && shape.codes.size > 0 && (shape.hasMessage || shape.hasSeverity)
    ? { code: [...shape.codes].sort()[0] }
    : shape.hasCode && (shape.hasMessage || shape.hasSeverity)
      ? { code: undefined }
      : undefined;
}

function diagnosticLiteralShape(expression, context, seen) {
  const empty = () => ({ codes: new Set(), hasCode: false, hasMessage: false, hasSeverity: false });
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return empty();
  if (ts.isIdentifier(value)) {
    const symbol = context.checker.getSymbolAtLocation(value);
    if (symbol === undefined || seen.has(symbol)) return empty();
    seen.add(symbol);
    const boundValue = context.diagnosticShapeBindings?.get(symbol);
    if (boundValue !== undefined) {
      return diagnosticLiteralShape(boundValue, context, seen);
    }
    const declaration = preferredValueDeclaration(symbol);
    if (
      declaration !== undefined &&
      ((ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) ||
        (ts.isParameter(declaration) && declaration.initializer !== undefined) ||
        (ts.isBindingElement(declaration) && declaration.initializer !== undefined))
    ) {
      return diagnosticLiteralShape(declaration.initializer, context, seen);
    }
    return empty();
  }
  if (ts.isCallExpression(value) && callTargetsStaticMember(value, 'Object', 'assign', context)) {
    const result = empty();
    for (const argument of value.arguments) {
      mergeDiagnosticLiteralShape(
        result,
        diagnosticLiteralShape(
          argument,
          { ...context, expandDiagnosticShapeCalls: true },
          new Set(seen),
        ),
      );
    }
    return result;
  }
  if (
    ts.isCallExpression(value) &&
    (callTargetsStaticMember(value, 'Object', 'defineProperties', context) ||
      callTargetsStaticMember(value, 'Object', 'create', context))
  ) {
    return diagnosticDescriptorMapShape(value.arguments[1], context, seen);
  }
  if (
    ts.isCallExpression(value) &&
    callTargetsStaticMember(value, 'Object', 'fromEntries', context)
  ) {
    return diagnosticEntryArrayShape(value.arguments[0], context, seen);
  }
  if (ts.isCallExpression(value) && context.expandDiagnosticShapeCalls === true) {
    const functionLike = localFunctionLikeForCall(value, context, new Set());
    if (functionLike !== undefined) {
      if (seen.has(functionLike)) return empty();
      const callSeen = new Set(seen);
      callSeen.add(functionLike);
      const bindings = new Map(context.diagnosticShapeBindings ?? []);
      for (let index = 0; index < functionLike.parameters.length; index += 1) {
        const parameter = functionLike.parameters[index];
        const argument = value.arguments[index] ?? parameter?.initializer;
        if (parameter === undefined || argument === undefined || !ts.isIdentifier(parameter.name)) {
          continue;
        }
        const symbol = context.checker.getSymbolAtLocation(parameter.name);
        if (symbol !== undefined) bindings.set(symbol, argument);
      }
      const nestedContext = { ...context, diagnosticShapeBindings: bindings };
      const result = empty();
      const returns = ts.isBlock(functionLike.body)
        ? directReturnExpressions(functionLike.body)
        : [functionLike.body];
      for (const returned of returns) {
        if (returned !== undefined) {
          mergeDiagnosticLiteralShape(
            result,
            diagnosticLiteralShape(returned, nestedContext, new Set(callSeen)),
          );
        }
      }
      return result;
    }
  }
  if (!ts.isObjectLiteralExpression(value)) return empty();
  const result = empty();
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = diagnosticLiteralShape(
        property.expression,
        { ...context, expandDiagnosticShapeCalls: true },
        new Set(seen),
      );
      mergeDiagnosticLiteralShape(result, spread);
      continue;
    }
    if (property.name === undefined) continue;
    const name = staticPropertyName(property.name, context);
    if (name === 'message') result.hasMessage = true;
    if (name === 'severity') result.hasSeverity = true;
    if (name === 'code') {
      result.hasCode = true;
      const initializer =
        ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
          ? ts.isPropertyAssignment(property)
            ? property.initializer
            : property.name
          : undefined;
      for (const code of diagnosticCodeValues(initializer, context, new Set(seen))) {
        result.codes.add(code);
      }
    }
  }
  return result;
}

function localFunctionLikeForCall(call, context, seen) {
  return localFunctionLikeValue(unwrapTransparentExpression(call.expression), context, seen);
}

function localFunctionLikeValue(value, context, seen) {
  if (value === undefined) return undefined;
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(value);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  const declaration = preferredValueDeclaration(symbol);
  if (declaration !== undefined && ts.isFunctionDeclaration(declaration) && declaration.body) {
    return declaration;
  }
  if (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  ) {
    return localFunctionLikeValue(
      unwrapTransparentExpression(declaration.initializer),
      context,
      seen,
    );
  }
  return undefined;
}

function mergeDiagnosticLiteralShape(target, source) {
  target.hasCode ||= source.hasCode;
  target.hasMessage ||= source.hasMessage;
  target.hasSeverity ||= source.hasSeverity;
  for (const code of source.codes) target.codes.add(code);
}

function diagnosticDescriptorMapShape(expression, context, seen) {
  const result = { codes: new Set(), hasCode: false, hasMessage: false, hasSeverity: false };
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return result;
  if (!ts.isObjectLiteralExpression(value)) return result;
  for (const property of value.properties) {
    if (property.name === undefined) continue;
    const name = staticPropertyName(property.name, context);
    if (name === 'message') result.hasMessage = true;
    if (name === 'severity') result.hasSeverity = true;
    if (name !== 'code') continue;
    result.hasCode = true;
    const descriptor =
      ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)
        ? property.initializer
        : undefined;
    const codeValue =
      descriptor === undefined
        ? undefined
        : objectLiteralOwnPropertyInitializer(descriptor, 'value', context.sourceFile);
    for (const code of diagnosticCodeValues(codeValue, context, new Set(seen))) {
      result.codes.add(code);
    }
  }
  return result;
}

function diagnosticEntryArrayShape(expression, context, seen) {
  const result = { codes: new Set(), hasCode: false, hasMessage: false, hasSeverity: false };
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return result;
  if (!ts.isArrayLiteralExpression(value)) return result;
  for (const entry of value.elements) {
    const pair = unwrapTransparentExpression(entry);
    if (!ts.isArrayLiteralExpression(pair) || pair.elements.length < 2) continue;
    const name = staticStringValue(pair.elements[0], context, new Set(seen));
    if (name === 'message') result.hasMessage = true;
    if (name === 'severity') result.hasSeverity = true;
    if (name !== 'code') continue;
    result.hasCode = true;
    for (const code of diagnosticCodeValues(pair.elements[1], context, new Set(seen))) {
      result.codes.add(code);
    }
  }
  return result;
}

function adHocDiagnosticAssignmentFindings(sourceFile, context, observedSummaries) {
  const groups = new Map();
  const record = (node, receiver, property, assignedValue) => {
    if (property !== 'code' && property !== 'message' && property !== 'severity') return;
    const owner = diagnosticEmissionOwner(node);
    const receiverValue = unwrapTransparentExpression(receiver);
    if (receiverValue === undefined) return;
    const symbol = ts.isIdentifier(receiverValue)
      ? context.checker.getSymbolAtLocation(receiverValue)
      : undefined;
    const key = symbol ?? `${owner.pos}:${receiverValue.getText(sourceFile)}`;
    const group = groups.get(key) ?? { codes: new Set(), node, properties: new Set() };
    group.properties.add(property);
    if (property === 'code') {
      for (const code of diagnosticCodeValues(assignedValue, context, new Set())) {
        group.codes.add(code);
      }
    }
    groups.set(key, group);
  };
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind) &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
    ) {
      record(
        node,
        node.left.expression,
        ts.isPropertyAccessExpression(node.left)
          ? node.left.name.text
          : staticStringValue(node.left.argumentExpression, context, new Set()),
        node.right,
      );
    }
    if (ts.isCallExpression(node)) {
      const objectDefineProperty = callTargetsStaticMember(
        node,
        'Object',
        'defineProperty',
        context,
      );
      const reflectSet = callTargetsStaticMember(node, 'Reflect', 'set', context);
      const reflectDefineProperty = callTargetsStaticMember(
        node,
        'Reflect',
        'defineProperty',
        context,
      );
      if (objectDefineProperty || reflectSet || reflectDefineProperty) {
        record(
          node,
          node.arguments[0],
          staticStringValue(node.arguments[1], context, new Set()),
          objectDefineProperty
            ? diagnosticDescriptorValue(node.arguments[2], sourceFile)
            : node.arguments[2],
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const findings = [];
  for (const group of groups.values()) {
    if (!group.properties.has('code')) continue;
    if (!group.properties.has('message') && !group.properties.has('severity')) continue;
    const position = sourceFile.getLineAndCharacterOfPosition(group.node.getStart(sourceFile));
    if (group.codes.size > 0) {
      findings.push(
        `${context.fileName}:${position.line + 1}: ad hoc ${[...group.codes].sort()[0]} production diagnostic assignment construction; use a generated registry constructor`,
      );
    } else {
      const summaryFinding = dynamicDiagnosticShapeSummaryFinding(
        group.node,
        context,
        'assignment',
        observedSummaries,
      );
      if (summaryFinding !== undefined) {
        findings.push(`${context.fileName}:${position.line + 1}: ${summaryFinding}`);
      }
    }
  }
  return findings;
}

function dynamicDiagnosticShapeSummaryFinding(node, context, construction, observedSummaries) {
  const summary = [
    context.fileName,
    construction,
    sourceNodeDigest(node, context.sourceFile),
    sourceNodeDigest(diagnosticEmissionOwner(node), context.sourceFile),
  ].join('#');
  observedSummaries.add(summary);
  return reviewedDynamicDiagnosticShapeSummaries.has(summary)
    ? undefined
    : `unreviewed dynamic structured diagnostic ${construction}; exact capability summary required (${summary})`;
}

function diagnosticDescriptorValue(expression, sourceFile) {
  const descriptor = unwrapTransparentExpression(expression);
  return descriptor !== undefined && ts.isObjectLiteralExpression(descriptor)
    ? objectLiteralOwnPropertyInitializer(descriptor, 'value', sourceFile)
    : undefined;
}

function adHocDiagnosticClass(node, context) {
  const shape = { codes: new Set(), hasCode: false, hasMessage: false, hasSeverity: false };
  for (const member of node.members) {
    if (
      (!ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member)) ||
      member.name === undefined
    ) {
      continue;
    }
    const name = staticPropertyName(member.name, context);
    if (name === 'message') shape.hasMessage = true;
    if (name === 'severity') shape.hasSeverity = true;
    if (name === 'code') {
      shape.hasCode = true;
      const values = ts.isPropertyDeclaration(member)
        ? [member.initializer]
        : member.body === undefined
          ? []
          : directReturnExpressions(member.body);
      for (const value of values) {
        for (const code of diagnosticCodeValues(value, context, new Set())) {
          shape.codes.add(code);
        }
      }
    }
  }
  return shape.hasCode && shape.codes.size > 0 && (shape.hasMessage || shape.hasSeverity)
    ? { code: [...shape.codes].sort()[0] }
    : shape.hasCode && (shape.hasMessage || shape.hasSeverity)
      ? { code: undefined }
      : undefined;
}

function diagnosticCodeValues(expression, context, seen) {
  const codes = new Set();
  if (expression === undefined) return codes;
  const text =
    staticStringValue(expression, context, new Set(seen)) ??
    foldedDiagnosticCodeString(expression, context, seen);
  if (text !== undefined && /^KV\d{3}$/u.test(text)) codes.add(text);
  const value = unwrapTransparentExpression(expression);
  if (ts.isConditionalExpression(value)) {
    for (const code of diagnosticCodeValues(value.whenTrue, context, new Set(seen)))
      codes.add(code);
    for (const code of diagnosticCodeValues(value.whenFalse, context, new Set(seen)))
      codes.add(code);
  }
  if (ts.isIdentifier(value)) {
    const symbol =
      ts.isShorthandPropertyAssignment(value.parent) && value.parent.name === value
        ? (context.checker.getShorthandAssignmentValueSymbol(value.parent) ??
          context.checker.getSymbolAtLocation(value))
        : context.checker.getSymbolAtLocation(value);
    if (symbol !== undefined && !seen.has(symbol)) {
      seen.add(symbol);
      const declaration = preferredValueDeclaration(symbol);
      if (
        declaration !== undefined &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isParameter(declaration) ||
          ts.isBindingElement(declaration)) &&
        declaration.initializer
      ) {
        for (const code of diagnosticCodeValues(declaration.initializer, context, seen))
          codes.add(code);
      }
    }
  }
  return codes;
}

function foldedDiagnosticCodeString(expression, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return undefined;
  if (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'join' &&
    ts.isArrayLiteralExpression(unwrapTransparentExpression(value.expression.expression))
  ) {
    const array = unwrapTransparentExpression(value.expression.expression);
    const separator =
      value.arguments.length === 0
        ? ','
        : staticStringValue(value.arguments[0], context, new Set(seen));
    if (separator === undefined) return undefined;
    const parts = [];
    for (const element of array.elements) {
      if (ts.isOmittedExpression(element)) return undefined;
      const part = staticStringValue(element, context, new Set(seen));
      if (part === undefined) return undefined;
      parts.push(part);
    }
    return parts.join(separator);
  }
  if (
    ts.isCallExpression(value) &&
    isStaticMemberCall(value, 'String', 'fromCharCode') &&
    value.arguments.every((argument) => ts.isNumericLiteral(unwrapTransparentExpression(argument)))
  ) {
    return String.fromCharCode(
      ...value.arguments.map((argument) => Number(unwrapTransparentExpression(argument).text)),
    );
  }
  if (
    ts.isTaggedTemplateExpression(value) &&
    ts.isPropertyAccessExpression(value.tag) &&
    ts.isIdentifier(value.tag.expression) &&
    value.tag.expression.text === 'String' &&
    value.tag.name.text === 'raw'
  ) {
    if (ts.isNoSubstitutionTemplateLiteral(value.template)) return value.template.text;
    let result = value.template.head.text;
    for (const span of value.template.templateSpans) {
      const part = unwrapTransparentExpression(span.expression);
      if (ts.isNumericLiteral(part)) result += part.text;
      else {
        const textPart = staticStringValue(part, context, new Set(seen));
        if (textPart === undefined) return undefined;
        result += textPart;
      }
      result += span.literal.text;
    }
    return result;
  }
  return undefined;
}

function staticPropertyName(name, context) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return ts.isComputedPropertyName(name)
    ? staticStringValue(name.expression, context, new Set())
    : undefined;
}

function propertyNameText(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return name.getText(sourceFile);
}

function validateEmissionDoorBindings(files) {
  const cached = emissionDoorBindingCache.get(files);
  if (cached !== undefined) return cached;
  const analysis = createProductionAnalysis(files);
  const findings = [];
  const edges = new Map();

  const coreBridge = analysis.sourceFiles.get(coreInternalDiagnosticsPath);
  findings.push(...validateCoreDiagnosticsBridge(coreBridge, analysis));

  const rootSource = analysis.sourceFiles.get(coreDiagnosticsPath);
  if (
    rootSource === undefined ||
    findTopLevelFunction(rootSource, 'createRegisteredDiagnostic') === undefined
  ) {
    findings.push(`${rootDiagnosticDoor}: root validating diagnostic door is missing`);
  }
  findings.push(...validateRootDiagnosticDoorDefinition(rootSource));
  findings.push(...validateRegisteredDiagnosticProvenance(rootSource, analysis));
  findings.push(...validateDiagnosticRegistryFreezeInitialization(rootSource));

  const constructorFunction =
    rootSource === undefined
      ? undefined
      : findTopLevelFunction(rootSource, 'createDiagnosticConstructor');
  if (constructorFunction === undefined) {
    findings.push(
      `${generatedDiagnosticConstructorDoor}: generated constructor wrapper is missing`,
    );
  } else {
    edges.set(
      generatedDiagnosticConstructorDoor,
      emitterTargetsInNode(constructorFunction, coreDiagnosticsPath, analysis, findings),
    );
  }

  const compilerSource = analysis.sourceFiles.get(compilerDiagnosticsPath);
  const factoryFunction =
    compilerSource === undefined ? undefined : findTopLevelFunction(compilerSource, 'diagnosticAt');
  if (factoryFunction === undefined) {
    findings.push(`${diagnosticFactoryDoor}: reviewed runtime-owned factory sink is missing`);
  } else {
    edges.set(
      diagnosticFactoryDoor,
      emitterTargetsInNode(factoryFunction, compilerDiagnosticsPath, analysis, findings),
    );
  }
  findings.push(...validateDiagnosticFactoryDefinition(compilerSource));
  findings.push(...validateCompilerDiagnosticDispatch(analysis));
  findings.push(...validateBlockingStaticExportDiagnosticCollection(analysis));

  for (const [key, wrapper] of reviewedDiagnosticWrappers) {
    const separator = key.lastIndexOf('#');
    const fileName = key.slice(0, separator);
    const sourceFile = analysis.sourceFiles.get(fileName);
    const declaration =
      sourceFile === undefined ? undefined : findTopLevelFunction(sourceFile, wrapper.name);
    if (declaration === undefined) {
      findings.push(`${key}: reviewed diagnostic wrapper definition is missing`);
      continue;
    }
    if (wrapper.exported && !hasExportModifier(declaration)) {
      findings.push(`${key}: reviewed imported wrapper must remain a named export`);
    }
    edges.set(key, emitterTargetsInNode(declaration, fileName, analysis, findings));
  }

  for (const key of [
    ...reviewedDiagnosticWrappers.keys(),
    diagnosticFactoryDoor,
    generatedDiagnosticConstructorDoor,
  ]) {
    if (!emitterGraphReachesRoot(key, edges)) {
      findings.push(
        `${key}: reviewed diagnostic wrapper has no exact path to ${rootDiagnosticDoor}`,
      );
    }
  }
  for (const key of [
    ...reviewedDiagnosticWrappers.keys(),
    diagnosticFactoryDoor,
    generatedDiagnosticConstructorDoor,
  ]) {
    const declaration = reviewedWrapperDeclaration(key, analysis);
    if (
      declaration !== undefined &&
      !everyWrapperReturnDerivesFromRoot(declaration, key, analysis, edges)
    ) {
      findings.push(
        `${key}: every reachable return must derive from ${rootDiagnosticDoor} on all branches`,
      );
    }
    if (declaration !== undefined) {
      findings.push(...reviewedWrapperCodeFlowFindings(declaration, key, analysis));
    }
  }
  emissionDoorBindingCache.set(files, findings);
  return findings;
}

function validateBlockingStaticExportDiagnosticCollection(analysis) {
  const fileName = 'packages/server/src/static-export-diagnostics.ts';
  const sourceFile = analysis.sourceFiles.get(fileName);
  const owner =
    sourceFile === undefined
      ? undefined
      : findTopLevelFunction(sourceFile, 'blockingStaticExportDiagnostics');
  const finding = `${fileName}#blockingStaticExportDiagnostics: every collected diagnostic must be the exact reviewed blockingStaticExportDiagnostic result`;
  if (sourceFile === undefined || owner?.body === undefined) return [finding];
  const ownerDigest = sourceNodeDigest(owner, sourceFile);
  if (ownerDigest !== expectedBlockingStaticExportCollectionDigest) {
    return [
      `${fileName}#blockingStaticExportDiagnostics: collection control flow drifted from its reviewed exact body (received ${ownerDigest})`,
    ];
  }

  const context = { ...analysis, fileName, sourceFile };
  const blocking = findVariableInNode(owner.body, 'blocking');
  if (
    blocking === undefined ||
    !ts.isIdentifier(blocking.name) ||
    blocking.initializer === undefined ||
    !ts.isArrayLiteralExpression(blocking.initializer) ||
    blocking.initializer.elements.length !== 0 ||
    !ts.isVariableDeclarationList(blocking.parent) ||
    (blocking.parent.flags & ts.NodeFlags.Const) === 0
  ) {
    return [finding];
  }
  const blockingSymbol = context.checker.getSymbolAtLocation(blocking.name);
  if (blockingSymbol === undefined) return [finding];

  const appendCalls = [];
  const visit = (node) => {
    if (node !== owner && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'witnessArrayAppend'
    ) {
      appendCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(owner, visit);
  if (appendCalls.length !== 1) return [finding];

  const append = appendCalls[0];
  const destination = append.arguments[0];
  const collected = unwrapTransparentExpression(append.arguments[1]);
  if (
    !isExactImportedOrLocalBinding(
      append.expression,
      serverSecurityWitnessIntrinsicsPath,
      'witnessArrayAppend',
      context,
    ) ||
    destination === undefined ||
    !ts.isIdentifier(destination) ||
    context.checker.getSymbolAtLocation(destination) !== blockingSymbol ||
    collected === undefined ||
    !ts.isCallExpression(collected)
  ) {
    return [finding];
  }
  const resolution = resolveDiagnosticEmitterCall(collected, context);
  if (
    resolution.status !== 'approved' ||
    resolution.target !==
      'packages/server/src/static-export-diagnostics.ts#blockingStaticExportDiagnostic' ||
    !callIsReviewedDynamicForwarding(collected, resolution.target, context)
  ) {
    return [finding];
  }

  const returns = directReturnExpressions(owner.body);
  if (
    returns.length !== 1 ||
    returns[0] === undefined ||
    !ts.isIdentifier(returns[0]) ||
    context.checker.getSymbolAtLocation(returns[0]) !== blockingSymbol ||
    bindingIsReassignedInScope(blockingSymbol, blocking.name, context) ||
    symbolIdentifierOccurrences(owner, blockingSymbol, context).length !== 3
  ) {
    return [finding];
  }
  return [];
}

/** Test-facing C13 hook for adversarial binding/return-flow mutations without evidence-ledger I/O. */
export function validateDiagnosticEmissionDoorBindings(files) {
  return validateEmissionDoorBindings(files);
}

function emitterTargetsInNode(node, fileName, analysis, findings) {
  const sourceFile = analysis.sourceFiles.get(fileName);
  const targets = new Set();
  if (sourceFile === undefined) return targets;
  const visit = (child) => {
    if (child !== node && (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child))) return;
    if (ts.isCallExpression(child)) {
      const resolution = resolveDiagnosticEmitterCall(child, {
        ...analysis,
        fileName,
        sourceFile,
      });
      if (resolution.status === 'approved') targets.add(resolution.target);
      if (resolution.status === 'rejected') {
        const position = sourceFile.getLineAndCharacterOfPosition(child.getStart(sourceFile));
        findings.push(
          `${fileName}:${position.line + 1}: reviewed wrapper uses untrusted emitter ${child.expression.getText(sourceFile)} (${resolution.reason})`,
        );
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return targets;
}

function emitterGraphReachesRoot(start, edges, seen = new Set()) {
  if (start === rootDiagnosticDoor) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  for (const target of edges.get(start) ?? []) {
    if (emitterGraphReachesRoot(target, edges, new Set(seen))) return true;
  }
  return false;
}

function reviewedWrapperDeclaration(key, analysis) {
  const separator = key.lastIndexOf('#');
  const fileName = key.slice(0, separator);
  const name = key.slice(separator + 1);
  const sourceFile = analysis.sourceFiles.get(fileName);
  return sourceFile === undefined ? undefined : findTopLevelFunction(sourceFile, name);
}

function everyWrapperReturnDerivesFromRoot(declaration, key, analysis, edges) {
  const fileName = key.slice(0, key.lastIndexOf('#'));
  const sourceFile = analysis.sourceFiles.get(fileName);
  if (sourceFile === undefined || declaration.body === undefined) return false;
  const returns = directReturnExpressions(declaration.body);
  return (
    statementAlwaysExits(declaration.body) &&
    returns.length > 0 &&
    returns.every(
      (expression) =>
        expression !== undefined &&
        expressionDerivesFromDiagnosticRoot(
          expression,
          key,
          { ...analysis, fileName, sourceFile },
          edges,
          new Set(),
        ),
    )
  );
}

function directReturnExpressions(body) {
  const returns = [];
  const pending = [body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (node !== body && ts.isFunctionLike(node)) continue;
    if (ts.isReturnStatement(node)) {
      returns.push(node.expression);
      continue;
    }
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return returns;
}

function statementAlwaysExits(statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      if (statementAlwaysExits(child)) return true;
    }
    return false;
  }
  if (ts.isIfStatement(statement)) {
    return (
      statement.elseStatement !== undefined &&
      statementAlwaysExits(statement.thenStatement) &&
      statementAlwaysExits(statement.elseStatement)
    );
  }
  if (ts.isTryStatement(statement)) {
    if (statement.finallyBlock !== undefined && statementAlwaysExits(statement.finallyBlock)) {
      return true;
    }
    return (
      statement.catchClause !== undefined &&
      statementAlwaysExits(statement.tryBlock) &&
      statementAlwaysExits(statement.catchClause.block)
    );
  }
  return false;
}

function expressionDerivesFromDiagnosticRoot(expression, wrapperKey, context, edges, seen) {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isAwaitExpression(value)
  ) {
    value = value.expression;
  }

  if (ts.isCallExpression(value)) {
    const resolution = resolveDiagnosticEmitterCall(value, context);
    return resolution.status === 'approved' && emitterGraphReachesRoot(resolution.target, edges);
  }
  if (ts.isConditionalExpression(value)) {
    return (
      expressionDerivesFromDiagnosticRoot(
        value.whenTrue,
        wrapperKey,
        context,
        edges,
        new Set(seen),
      ) &&
      expressionDerivesFromDiagnosticRoot(
        value.whenFalse,
        wrapperKey,
        context,
        edges,
        new Set(seen),
      )
    );
  }
  if (ts.isBinaryExpression(value) || ts.isObjectLiteralExpression(value)) return false;
  if (ts.isTemplateExpression(value)) {
    return wrapperKey === `${verifierDiagnosticsPath}#diagnosticMessage`
      ? diagnosticMessageTemplateIsExact(value, context, edges)
      : false;
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) return false;
  if (ts.isIdentifier(value)) {
    const symbol = context.checker.getSymbolAtLocation(value);
    if (symbol === undefined || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = preferredValueDeclaration(symbol);
    const declarationList =
      declaration !== undefined && ts.isVariableDeclaration(declaration)
        ? declaration.parent
        : undefined;
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declarationList !== undefined &&
      ts.isVariableDeclarationList(declarationList) &&
      (declarationList.flags & ts.NodeFlags.Const) !== 0 &&
      !bindingIsReassignedInScope(symbol, value, context) &&
      declaration.initializer !== undefined &&
      expressionDerivesFromDiagnosticRoot(declaration.initializer, wrapperKey, context, edges, seen)
    );
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    if (wrapperKey !== generatedDiagnosticConstructorDoor) return false;
    const expressions = ts.isBlock(value.body) ? directReturnExpressions(value.body) : [value.body];
    return (
      (!ts.isBlock(value.body) || statementAlwaysExits(value.body)) &&
      expressions.length > 0 &&
      expressions.every(
        (returned) =>
          returned !== undefined &&
          expressionDerivesFromDiagnosticRoot(returned, wrapperKey, context, edges, new Set(seen)),
      )
    );
  }
  return false;
}

function diagnosticMessageTemplateIsExact(expression, context, edges) {
  const declaration = findTopLevelFunction(context.sourceFile, 'diagnosticMessage');
  if (declaration === undefined || declaration.parameters.length !== 2) return false;
  const codeParameter = declaration.parameters[0];
  const detailParameter = declaration.parameters[1];
  if (
    codeParameter === undefined ||
    detailParameter === undefined ||
    !ts.isIdentifier(codeParameter.name) ||
    !ts.isIdentifier(detailParameter.name) ||
    expression.head.text !== '' ||
    expression.templateSpans.length !== 3 ||
    expression.templateSpans[0]?.literal.text !== ' ' ||
    expression.templateSpans[1]?.literal.text !== ': ' ||
    expression.templateSpans[2]?.literal.text !== ''
  ) {
    return false;
  }
  const codeSymbol = context.checker.getSymbolAtLocation(codeParameter.name);
  const detailSymbol = context.checker.getSymbolAtLocation(detailParameter.name);
  const codeProperty = exactPropertyAccess(expression.templateSpans[0]?.expression, 'code');
  const messageCall = expression.templateSpans[1]?.expression;
  const detail = unwrapTransparentExpression(expression.templateSpans[2]?.expression);
  if (
    codeSymbol === undefined ||
    detailSymbol === undefined ||
    codeProperty === undefined ||
    !ts.isCallExpression(messageCall) ||
    !ts.isIdentifier(messageCall.expression) ||
    !isExactImportedOrLocalBinding(
      messageCall.expression,
      verifierDiagnosticsPath,
      'trimDiagnosticSentence',
      context,
    ) ||
    messageCall.arguments.length !== 1 ||
    !ts.isIdentifier(detail) ||
    context.checker.getSymbolAtLocation(detail) !== detailSymbol ||
    !trimDiagnosticSentenceDefinitionIsExact(context)
  ) {
    return false;
  }
  const messageProperty = exactPropertyAccess(messageCall.arguments[0], 'message');
  if (messageProperty === undefined) return false;
  const diagnosticSymbol = context.checker.getSymbolAtLocation(codeProperty.expression);
  if (
    diagnosticSymbol === undefined ||
    context.checker.getSymbolAtLocation(messageProperty.expression) !== diagnosticSymbol ||
    bindingIsReassignedInScope(diagnosticSymbol, expression, context)
  ) {
    return false;
  }
  const diagnosticDeclaration = preferredValueDeclaration(diagnosticSymbol);
  if (
    diagnosticDeclaration === undefined ||
    !ts.isVariableDeclaration(diagnosticDeclaration) ||
    !ts.isVariableDeclarationList(diagnosticDeclaration.parent) ||
    (diagnosticDeclaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    diagnosticDeclaration.initializer === undefined ||
    !ts.isCallExpression(diagnosticDeclaration.initializer)
  ) {
    return false;
  }
  const resolution = resolveDiagnosticEmitterCall(diagnosticDeclaration.initializer, context);
  const rootCode = unwrapTransparentExpression(diagnosticDeclaration.initializer.arguments[0]);
  return (
    resolution.status === 'approved' &&
    emitterGraphReachesRoot(resolution.target, edges) &&
    ts.isIdentifier(rootCode) &&
    context.checker.getSymbolAtLocation(rootCode) === codeSymbol
  );
}

function trimDiagnosticSentenceDefinitionIsExact(context) {
  const declaration = findTopLevelFunction(context.sourceFile, 'trimDiagnosticSentence');
  if (
    declaration === undefined ||
    declaration.parameters.length !== 1 ||
    declaration.body === undefined ||
    declaration.body.statements.length !== 1 ||
    !ts.isIdentifier(declaration.parameters[0]?.name)
  ) {
    return false;
  }
  const message = declaration.parameters[0].name;
  const messageSymbol = context.checker.getSymbolAtLocation(message);
  const statement = declaration.body.statements[0];
  if (
    messageSymbol === undefined ||
    statement === undefined ||
    !ts.isReturnStatement(statement) ||
    statement.expression === undefined ||
    !ts.isConditionalExpression(statement.expression)
  ) {
    return false;
  }
  const conditional = statement.expression;
  return (
    exactVerifierIntrinsicCall(
      conditional.condition,
      'verifierStringEndsWith',
      [messageSymbol, '.'],
      context,
    ) &&
    exactVerifierIntrinsicCall(
      conditional.whenTrue,
      'verifierStringSlice',
      [messageSymbol, 0, -1],
      context,
    ) &&
    ts.isIdentifier(unwrapTransparentExpression(conditional.whenFalse)) &&
    context.checker.getSymbolAtLocation(unwrapTransparentExpression(conditional.whenFalse)) ===
      messageSymbol
  );
}

function exactVerifierIntrinsicCall(expression, name, expectedArguments, context) {
  const call = unwrapTransparentExpression(expression);
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    !isExactImportedOrLocalBinding(
      call.expression,
      verifierSecurityIntrinsicsPath,
      name,
      context,
    ) ||
    call.arguments.length !== expectedArguments.length
  ) {
    return false;
  }
  return expectedArguments.every((expected, index) => {
    const argument = unwrapTransparentExpression(call.arguments[index]);
    if (typeof expected === 'string') {
      return ts.isStringLiteralLike(argument) && argument.text === expected;
    }
    if (typeof expected === 'number') {
      if (expected >= 0) return ts.isNumericLiteral(argument) && Number(argument.text) === expected;
      return (
        ts.isPrefixUnaryExpression(argument) &&
        argument.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(argument.operand) &&
        -Number(argument.operand.text) === expected
      );
    }
    return ts.isIdentifier(argument) && context.checker.getSymbolAtLocation(argument) === expected;
  });
}

function exactPropertyAccess(expression, property) {
  const value = unwrapTransparentExpression(expression);
  return ts.isPropertyAccessExpression(value) && value.name.text === property ? value : undefined;
}

function unwrapTransparentExpression(expression) {
  let value = expression;
  while (
    value !== undefined &&
    (ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isTypeAssertionExpression(value) ||
      ts.isNonNullExpression(value))
  ) {
    value = value.expression;
  }
  return value;
}

function reviewedWrapperCodeFlowFindings(declaration, key, analysis) {
  const position =
    diagnosticEmitterCodePositions.get(key) ??
    (key === generatedDiagnosticConstructorDoor ? { argument: 0 } : undefined);
  if (position === undefined || declaration.body === undefined) return [];
  const fileName = key.slice(0, key.lastIndexOf('#'));
  const sourceFile = analysis.sourceFiles.get(fileName);
  if (sourceFile === undefined) return [`${key}: source file is missing`];
  const context = { ...analysis, fileName, sourceFile };
  const expected = wrapperCodeSource(declaration, position, context);
  if (expected === undefined) return [`${key}: reviewed wrapper code source is not exact`];
  const findings = [];
  const visit = (node) => {
    if (node !== declaration && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const resolution = resolveDiagnosticEmitterCall(node, context);
      if (resolution.status === 'approved' && resolution.target !== key) {
        const actual = diagnosticCodeExpressionAtCall(node, resolution.target, sourceFile);
        const actualText =
          resolution.target === generatedDiagnosticConstructorDoor
            ? resolution.constructorCode
            : resolution.target === derivedDiagnosticDoor && actual !== undefined
              ? `${actual.getText(sourceFile)}.code`
              : actual?.getText(sourceFile);
        const matchesReviewedSource =
          resolution.target === derivedDiagnosticDoor
            ? expected.property === 'code' &&
              actual !== undefined &&
              ts.isIdentifier(actual) &&
              context.checker.getSymbolAtLocation(actual) === expected.symbol
            : diagnosticCodeExpressionMatchesWrapperSource(actual, expected, context);
        if (actualText === undefined || !matchesReviewedSource) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          findings.push(
            `${key}:${line}: dynamic diagnostic code ${actualText ?? '<unproven>'} does not derive from reviewed source ${expected.text}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return findings;
}

function wrapperCodeSource(declaration, position, context) {
  const parameter = declaration.parameters[position.argument];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(parameter.name);
  if (symbol === undefined || bindingIsReassignedInScope(symbol, parameter.name, context)) {
    return undefined;
  }
  return {
    property: position.property,
    symbol,
    text:
      position.property === undefined
        ? parameter.name.text
        : `${parameter.name.text}.${position.property}`,
  };
}

function diagnosticCodeExpressionMatchesWrapperSource(expression, expected, context) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return false;
  if (expected.property === undefined) {
    return ts.isIdentifier(value) && context.checker.getSymbolAtLocation(value) === expected.symbol;
  }
  const property = exactPropertyAccess(value, expected.property);
  return (
    property !== undefined &&
    ts.isIdentifier(property.expression) &&
    context.checker.getSymbolAtLocation(property.expression) === expected.symbol
  );
}

function diagnosticCodeExpressionAtCall(call, target, sourceFile) {
  if (target === generatedDiagnosticConstructorDoor) return undefined;
  if (target === derivedDiagnosticDoor) {
    return call.arguments[0];
  }
  const position = diagnosticEmitterCodePositions.get(target);
  if (position === undefined) return undefined;
  const argument = call.arguments[position.argument];
  if (argument === undefined) return undefined;
  return position.property === undefined
    ? argument
    : ts.isObjectLiteralExpression(argument)
      ? objectLiteralOwnPropertyInitializer(argument, position.property, sourceFile)
      : undefined;
}

function findTopLevelFunction(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function hasExportModifier(declaration) {
  return ts
    .getModifiers(declaration)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function validateCoreDiagnosticsBridge(sourceFile, context) {
  if (sourceFile === undefined) {
    return [`${coreInternalDiagnosticsPath}: reviewed diagnostics bridge is missing`];
  }
  const findings = [];
  for (const [exportedName, expectedModulePath] of protectedCoreBridgeExports) {
    if (exactStarExportCount(sourceFile, coreInternalDiagnosticsPath, expectedModulePath) !== 1) {
      findings.push(
        `${coreInternalDiagnosticsPath}: reviewed ${exportedName} binding must have exactly one star re-export from ${expectedModulePath}`,
      );
    }
    for (const statement of sourceFile.statements) {
      if (explicitlyExportsName(statement, exportedName)) {
        findings.push(
          `${coreInternalDiagnosticsPath}: explicit shadow export for ${exportedName} is forbidden`,
        );
      }
    }
    if (!protectedBridgeSourceOwnershipIsExact(exportedName, context)) {
      findings.push(
        `${coreInternalDiagnosticsPath}: reviewed ${exportedName} must be exported only by ${expectedModulePath}`,
      );
    }
  }
  const starExports = sourceFile.statements.filter(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause === undefined &&
      statement.moduleSpecifier !== undefined,
  );
  const reviewedStarExportSources = new Set(protectedCoreBridgeExports.values());
  if (starExports.length !== reviewedStarExportSources.size) {
    findings.push(
      `${coreInternalDiagnosticsPath}: bridge must contain only the reviewed star re-exports`,
    );
  }
  return findings;
}

function exactStarExportCount(sourceFile, fileName, expectedModulePath) {
  return sourceFile.statements.filter(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause === undefined &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      resolveImportModulePath(fileName, statement.moduleSpecifier.text) === expectedModulePath,
  ).length;
}

function explicitlyExportsName(statement, exportedName) {
  if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
    if (ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.some((element) => element.name.text === exportedName);
    }
    return statement.exportClause.name.text === exportedName;
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return hasExportModifier(statement) && statement.name.text === exportedName;
  }
  if (!hasExportModifier(statement)) return false;
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)) &&
    statement.name?.text === exportedName
  ) {
    return true;
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNameContains(declaration.name, exportedName),
    );
  }
  return false;
}

function bindingNameContains(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, expected),
  );
}

function validateRootDiagnosticDoorDefinition(sourceFile) {
  if (sourceFile === undefined) return [`${rootDiagnosticDoor}: root source is missing`];
  const implementation = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createRegisteredDiagnostic' &&
      statement.body !== undefined,
  );
  if (
    implementation === undefined ||
    implementation.body === undefined ||
    !hasExportModifier(implementation)
  ) {
    return [`${rootDiagnosticDoor}: validating implementation is missing`];
  }
  const findings = [];
  const definitionFactory = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createRegisteredDiagnosticDefinition' &&
      statement.body !== undefined,
  );
  const definitionFactoryDigest = sourceNodeDigest(definitionFactory, sourceFile);
  if (definitionFactoryDigest !== expectedRegisteredDiagnosticDefinitionFactoryDigest) {
    findings.push(
      `${coreDiagnosticsPath}#createRegisteredDiagnosticDefinition: registry definition implementation drifted from its reviewed exact body (received ${definitionFactoryDigest})`,
    );
  }
  const implementationDigest = sourceNodeDigest(implementation, sourceFile);
  if (implementationDigest !== expectedRootDiagnosticDoorDigest) {
    findings.push(
      `${rootDiagnosticDoor}: validating implementation drifted from its reviewed exact body (received ${implementationDigest})`,
    );
  }
  const registered = findVariableInNode(implementation.body, 'registered');
  const registeredStatement = registered?.parent?.parent;
  const registeredValue =
    registered?.initializer === undefined
      ? undefined
      : unwrapTransparentExpression(registered.initializer);
  const addStatements = implementation.body.statements.filter((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const call = unwrapTransparentExpression(statement.expression);
    return (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'securityWeakSetAdd' &&
      call.arguments.length === 2 &&
      ts.isIdentifier(call.arguments[0]) &&
      call.arguments[0].text === 'registeredDiagnosticRegistry' &&
      ts.isIdentifier(call.arguments[1]) &&
      call.arguments[1].text === 'registered'
    );
  });
  const returns = directReturnExpressions(implementation.body);
  const returned = returns.length === 1 ? unwrapTransparentExpression(returns[0]) : undefined;
  const registeredIndex = implementation.body.statements.indexOf(registeredStatement);
  const addIndex =
    addStatements.length === 1 ? implementation.body.statements.indexOf(addStatements[0]) : -1;
  const returnStatement = implementation.body.statements.find(
    (statement) =>
      ts.isReturnStatement(statement) &&
      statement.expression !== undefined &&
      unwrapTransparentExpression(statement.expression) === returned,
  );
  const returnIndex = implementation.body.statements.indexOf(returnStatement);
  if (
    registered === undefined ||
    !ts.isVariableDeclarationList(registered.parent) ||
    (registered.parent.flags & ts.NodeFlags.Const) === 0 ||
    registeredValue === undefined ||
    !ts.isCallExpression(registeredValue) ||
    !ts.isIdentifier(registeredValue.expression) ||
    registeredValue.expression.text !== 'freezeSecurityValue' ||
    registeredValue.arguments.length !== 1 ||
    !ts.isIdentifier(registeredValue.arguments[0]) ||
    registeredValue.arguments[0].text !== 'diagnostic' ||
    addStatements.length !== 1 ||
    returned === undefined ||
    !ts.isIdentifier(returned) ||
    returned.text !== 'registered' ||
    registeredIndex < 0 ||
    addIndex !== registeredIndex + 1 ||
    returnIndex !== addIndex + 1 ||
    !hasExactNamedImport(sourceFile, 'freezeSecurityValue') ||
    !hasExactNamedImport(sourceFile, 'securityWeakSetAdd')
  ) {
    findings.push(
      `${rootDiagnosticDoor}: root must freeze, privately enroll, and return the same exact diagnostic identity`,
    );
  }
  return findings;
}

function validateRegisteredDiagnosticProvenance(sourceFile, analysis) {
  if (sourceFile === undefined) {
    return [`${coreDiagnosticsPath}#registeredDiagnosticRegistry: provenance source is missing`];
  }
  const findings = [];
  const registry = findTopLevelVariable(sourceFile, 'registeredDiagnosticRegistry');
  const registryStatement = registry?.parent?.parent;
  const registryInitializer =
    registry?.initializer === undefined
      ? undefined
      : unwrapTransparentExpression(registry.initializer);
  if (
    registry === undefined ||
    !ts.isVariableDeclarationList(registry.parent) ||
    (registry.parent.flags & ts.NodeFlags.Const) === 0 ||
    !ts.isVariableStatement(registryStatement) ||
    hasExportModifier(registryStatement) ||
    sourceFile.statements.some((statement) =>
      explicitlyExportsName(statement, 'registeredDiagnosticRegistry'),
    ) ||
    registryInitializer === undefined ||
    !ts.isCallExpression(registryInitializer) ||
    !ts.isIdentifier(registryInitializer.expression) ||
    registryInitializer.expression.text !== 'securityWeakSet' ||
    registryInitializer.arguments.length !== 0 ||
    !hasExactNamedImport(sourceFile, 'securityWeakSet')
  ) {
    findings.push(
      `${coreDiagnosticsPath}#registeredDiagnosticRegistry: provenance registry must be a module-private captured WeakSet`,
    );
  }

  const implementation = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createRegisteredDiagnostic' &&
      statement.body !== undefined,
  );
  const guard = findTopLevelFunction(sourceFile, 'isRegisteredDiagnostic');
  const assertion = findTopLevelFunction(sourceFile, 'assertRegisteredDiagnostic');
  const derivation = findTopLevelFunction(sourceFile, 'deriveRegisteredDiagnostic');
  const addCalls = namedCallExpressions(sourceFile, 'securityWeakSetAdd');
  const hasCalls = namedCallExpressions(sourceFile, 'securityWeakSetHas');
  if (
    implementation === undefined ||
    addCalls.length !== 1 ||
    !nodeContains(implementation, addCalls[0])
  ) {
    findings.push(
      `${rootDiagnosticDoor}: only the validating constructor may enroll diagnostic identity`,
    );
  }
  if (
    guard === undefined ||
    hasCalls.length !== 1 ||
    !nodeContains(guard, hasCalls[0]) ||
    !hasExactNamedImport(sourceFile, 'securityWeakSetHas')
  ) {
    findings.push(
      `${coreDiagnosticsPath}#isRegisteredDiagnostic: provenance checks must use the private captured WeakSet`,
    );
  }
  for (const [name, declaration, expectedDigest] of [
    ['isRegisteredDiagnostic', guard, expectedRegisteredDiagnosticGuardDigest],
    ['assertRegisteredDiagnostic', assertion, expectedRegisteredDiagnosticAssertionDigest],
    ['deriveRegisteredDiagnostic', derivation, expectedDerivedDiagnosticDoorDigest],
  ]) {
    const digest = sourceNodeDigest(declaration, sourceFile);
    if (digest !== expectedDigest) {
      findings.push(
        `${coreDiagnosticsPath}#${name}: runtime provenance implementation drifted from its reviewed exact body (received ${digest})`,
      );
    }
  }

  const staticExportSource = analysis.sourceFiles.get(
    'packages/server/src/static-export-diagnostics.ts',
  );
  const staticExportRehydration =
    staticExportSource === undefined
      ? undefined
      : findTopLevelFunction(staticExportSource, 'rehydrateStaticExportCompileDiagnostic');
  const staticExportDigest = sourceNodeDigest(staticExportRehydration, staticExportSource);
  if (staticExportDigest !== expectedStaticExportDiagnosticRehydrationDoorDigest) {
    findings.push(
      `${staticExportDiagnosticRehydrationDoor}: serialized diagnostic rehydration door drifted from its reviewed exact body (received ${staticExportDigest})`,
    );
  }
  const sqlSafetySource = analysis.sourceFiles.get(
    'packages/server/src/internal/data-plane-static-analysis.ts',
  );
  const sqlSafetyRehydration =
    sqlSafetySource === undefined
      ? undefined
      : findTopLevelFunction(sqlSafetySource, 'rehydrateSerializedSqlSafetyDiagnostic');
  const sqlSafetyDigest = sourceNodeDigest(sqlSafetyRehydration, sqlSafetySource);
  if (sqlSafetyDigest !== expectedSqlSafetyDiagnosticRehydrationDoorDigest) {
    findings.push(
      `${sqlSafetyDiagnosticRehydrationDoor}: serialized SQL-safety diagnostic rehydration door drifted from its reviewed exact body (received ${sqlSafetyDigest})`,
    );
  }
  const transferredRegistrar =
    sqlSafetySource === undefined
      ? undefined
      : findTopLevelFunction(sqlSafetySource, 'registerTransferredSqlSafetyDiagnostic');
  const transferredRegistrarDigest = sourceNodeDigest(transferredRegistrar, sqlSafetySource);
  if (transferredRegistrarDigest !== expectedTransferredSqlSafetyDiagnosticRegistrarDigest) {
    findings.push(
      `${transferredSqlSafetyDiagnosticRegistrarDoor}: transferred diagnostic constructor capability drifted from its reviewed exact body (received ${transferredRegistrarDigest})`,
    );
  }
  const staticBuildAnalysisOwner =
    sqlSafetySource === undefined
      ? undefined
      : findTopLevelFunction(sqlSafetySource, 'runStaticBuildAnalysisFacts');
  const staticBuildAnalysisOwnerDigest = sourceNodeDigest(
    staticBuildAnalysisOwner,
    sqlSafetySource,
  );
  if (staticBuildAnalysisOwnerDigest !== expectedStaticBuildAnalysisFactsOwnerDigest) {
    findings.push(
      `${transferredSqlSafetyDiagnosticRegistrarDoor}: constructor capability transfer owner drifted from its reviewed exact body (received ${staticBuildAnalysisOwnerDigest})`,
    );
  }
  // The consumer-side grant above is only half of the capability boundary. Pin the exact Drizzle
  // recipient and loop so the callback cannot be retained, duplicated, or invoked with substituted
  // registry fields while still minting a server-trusted diagnostic (SPEC §2/§11).
  const drizzleStaticSource = analysis.sourceFiles.get(drizzleStaticPath);
  for (const [name, expectedDigest] of [
    [
      'extractStaticBuildAnalysisFactsFromProject',
      expectedStaticBuildAnalysisProjectExtractorDigest,
    ],
    ['transferStaticBuildDiagnostics', expectedStaticBuildDiagnosticTransferDigest],
  ]) {
    const declaration =
      drizzleStaticSource === undefined
        ? undefined
        : findTopLevelFunction(drizzleStaticSource, name);
    const digest = sourceNodeDigest(declaration, drizzleStaticSource);
    if (digest !== expectedDigest) {
      findings.push(
        `${drizzleStaticPath}#${name}: transferred diagnostic capability recipient drifted from its reviewed exact body (received ${digest})`,
      );
    }
  }
  return findings;
}

function hasExactNamedImport(sourceFile, importedName) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '#security-witness-intrinsics' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === importedName && element.propertyName === undefined,
      ),
  );
}

function namedCallExpressions(root, name) {
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function nodeContains(owner, node) {
  return node.getStart() >= owner.getStart() && node.getEnd() <= owner.getEnd();
}

function validateDiagnosticRegistryFreezeInitialization(sourceFile) {
  if (sourceFile === undefined) {
    return [`${coreDiagnosticsPath}#diagnosticDefinitions: registry source is missing`];
  }
  const declarationIndex = sourceFile.statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === 'diagnosticDefinitions',
      ),
  );
  const freezeIndexes = [];
  for (let index = 0; index < sourceFile.statements.length; index += 1) {
    const statement = sourceFile.statements[index];
    if (
      statement !== undefined &&
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      statement.expression.expression.text === 'freezeDiagnosticRegistryValue' &&
      statement.expression.arguments.length === 1 &&
      ts.isIdentifier(statement.expression.arguments[0]) &&
      statement.expression.arguments[0].text === 'diagnosticDefinitions'
    ) {
      freezeIndexes.push(index);
    }
  }
  return declarationIndex >= 0 && freezeIndexes.length === 1 && freezeIndexes[0] > declarationIndex
    ? []
    : [
        `${coreDiagnosticsPath}#diagnosticDefinitions: registry must pass exactly once through the reviewed deep-freeze initialization`,
      ];
}

function validateCompilerDiagnosticDispatch(analysis) {
  const findings = [];
  const pipeline = analysis.sourceFiles.get(compilerValidatorPipelinePath);
  if (pipeline === undefined) {
    findings.push(`${compilerValidatorPipelinePath}: reviewed validator pipeline is missing`);
  } else {
    const digest = createHash('sha256').update(pipeline.text).digest('hex');
    if (digest !== expectedCompilerValidatorPipelineDigest) {
      findings.push(
        `${compilerValidatorPipelinePath}: reviewed validator registry and dispatch summary drifted (received ${digest})`,
      );
    }
  }
  const compileSource = analysis.sourceFiles.get(compilerCompilePath);
  if (compileSource === undefined) {
    findings.push(`${compilerCompilePath}: reviewed compiler entry dispatch is missing`);
    return findings;
  }
  for (const [name, expectedDigest] of [
    ['compileComponentModule', expectedCompileComponentModuleDigest],
    ['validateComponentPhase', expectedValidateComponentPhaseDigest],
  ]) {
    const declaration = findTopLevelFunction(compileSource, name);
    const digest = sourceNodeDigest(declaration, compileSource);
    if (digest !== expectedDigest) {
      findings.push(
        `${compilerCompilePath}#${name}: reviewed compiler diagnostic reachability summary drifted (received ${digest})`,
      );
    }
  }
  return findings;
}

function validateDiagnosticFactoryDefinition(sourceFile) {
  if (sourceFile === undefined)
    return [`${compilerDiagnosticsPath}: diagnostics source is missing`];
  const findings = [];
  const brand = findTopLevelVariable(sourceFile, 'diagnosticFactoryBrand');
  const states = findTopLevelVariable(sourceFile, 'diagnosticFactoryStates');
  const create = findTopLevelFunction(sourceFile, 'createDiagnosticFactory');
  const emit = findTopLevelFunction(sourceFile, 'diagnosticAt');
  const createDigest = sourceNodeDigest(create, sourceFile);
  if (createDigest !== expectedDiagnosticFactoryConstructorDigest) {
    findings.push(
      `${compilerDiagnosticsPath}#createDiagnosticFactory: implementation drifted from its reviewed exact body (received ${createDigest})`,
    );
  }
  const emitDigest = sourceNodeDigest(emit, sourceFile);
  if (emitDigest !== expectedDiagnosticFactorySinkDigest) {
    findings.push(
      `${diagnosticFactoryDoor}: implementation drifted from its reviewed exact body after the ownership guard (received ${emitDigest})`,
    );
  }
  if (
    brand === undefined ||
    brand.initializer === undefined ||
    !ts.isCallExpression(brand.initializer) ||
    !ts.isIdentifier(brand.initializer.expression) ||
    brand.initializer.expression.text !== 'Symbol' ||
    variableIsExported(brand)
  ) {
    findings.push(
      `${compilerDiagnosticsPath}: DiagnosticFactory must use one module-private unique Symbol sentinel`,
    );
  }
  if (
    states === undefined ||
    states.initializer === undefined ||
    !ts.isNewExpression(states.initializer) ||
    !ts.isIdentifier(states.initializer.expression) ||
    states.initializer.expression.text !== 'WeakMap' ||
    variableIsExported(states)
  ) {
    findings.push(
      `${compilerDiagnosticsPath}: DiagnosticFactory ownership must live in one module-private WeakMap`,
    );
  }
  const factoryDeclaration =
    create === undefined ? undefined : findVariableInNode(create, 'factory');
  let freezeCall = factoryDeclaration?.initializer;
  while (
    freezeCall !== undefined &&
    (ts.isParenthesizedExpression(freezeCall) ||
      ts.isAsExpression(freezeCall) ||
      ts.isSatisfiesExpression(freezeCall) ||
      ts.isTypeAssertionExpression(freezeCall))
  ) {
    freezeCall = freezeCall.expression;
  }
  const defineCall =
    freezeCall !== undefined &&
    ts.isCallExpression(freezeCall) &&
    isStaticMemberCall(freezeCall, 'Object', 'freeze')
      ? freezeCall.arguments[0]
      : undefined;
  if (
    create === undefined ||
    defineCall === undefined ||
    !ts.isCallExpression(defineCall) ||
    !isStaticMemberCall(defineCall, 'Object', 'defineProperty') ||
    defineCall.arguments[1] === undefined ||
    !ts.isIdentifier(defineCall.arguments[1]) ||
    defineCall.arguments[1].text !== 'diagnosticFactoryBrand' ||
    !factoryConstructorOwnsExactCapability(create, factoryDeclaration, defineCall)
  ) {
    findings.push(
      `${compilerDiagnosticsPath}#createDiagnosticFactory: constructor must brand, freeze, and register the exact capability`,
    );
  }
  if (emit === undefined || !hasExactDiagnosticFactoryOwnershipGuard(emit)) {
    findings.push(
      `${diagnosticFactoryDoor}: sink must reject every capability absent from the private ownership map`,
    );
  }
  const factoryInterface = sourceFile.statements.find(
    (statement) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'DiagnosticFactory',
  );
  if (
    factoryInterface === undefined ||
    !factoryInterface.members.some((member) =>
      isPrivateDiagnosticFactoryBrandMember(member, sourceFile),
    )
  ) {
    findings.push(
      `${compilerDiagnosticsPath}#DiagnosticFactory: type must carry the module-private runtime brand`,
    );
  }
  if (
    factoryInterface === undefined ||
    factoryInterface.members.some(
      (member) => member.name !== undefined && propertyNameText(member.name, sourceFile) === 'at',
    )
  ) {
    findings.push(
      `${compilerDiagnosticsPath}#DiagnosticFactory: structural at methods are forbidden`,
    );
  }
  if (
    identifierOccurrenceCount(sourceFile, 'diagnosticFactoryBrand') !== 3 ||
    identifierOccurrenceCount(sourceFile, 'diagnosticFactoryStates') !== 3
  ) {
    findings.push(
      `${compilerDiagnosticsPath}: private DiagnosticFactory sentinel and ownership state must not escape their reviewed declaration, mint, and sink positions`,
    );
  }
  return findings;
}

function sourceNodeDigest(node, sourceFile) {
  if (node === undefined) return '<missing>';
  return createHash('sha256').update(node.getText(sourceFile)).digest('hex');
}

function factoryConstructorOwnsExactCapability(declaration, factoryDeclaration, defineCall) {
  if (
    declaration === undefined ||
    declaration.body === undefined ||
    factoryDeclaration === undefined ||
    defineCall === undefined ||
    declaration.parameters.length !== 3 ||
    !declaration.parameters.every(
      (parameter, index) =>
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === ['fileName', 'source', 'offsetMap'][index],
    ) ||
    !diagnosticFactoryShellIsExact(defineCall) ||
    declaration.body.statements.length !== 4
  ) {
    return false;
  }
  const [factoryStatement, stateStatement, setStatement, returnStatement] =
    declaration.body.statements;
  if (
    factoryStatement === undefined ||
    stateStatement === undefined ||
    setStatement === undefined ||
    returnStatement === undefined ||
    !ts.isVariableStatement(factoryStatement) ||
    factoryStatement.declarationList.declarations[0] !== factoryDeclaration ||
    (factoryStatement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    !ts.isVariableStatement(stateStatement) ||
    stateStatement.declarationList.declarations.length !== 1 ||
    (stateStatement.declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    return false;
  }
  const state = stateStatement.declarationList.declarations[0];
  if (
    state === undefined ||
    !ts.isIdentifier(state.name) ||
    state.name.text !== 'state' ||
    state.initializer === undefined ||
    !ts.isCallExpression(state.initializer) ||
    !isStaticMemberCall(state.initializer, 'Object', 'freeze') ||
    state.initializer.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(state.initializer.arguments[0])
  ) {
    return false;
  }
  const stateObject = state.initializer.arguments[0];
  if (stateObject.properties.length !== 2) return false;
  const offsetMap = stateObject.properties[0];
  const positionFor = stateObject.properties[1];
  if (
    !ts.isShorthandPropertyAssignment(offsetMap) ||
    offsetMap.name.text !== 'offsetMap' ||
    !ts.isPropertyAssignment(positionFor) ||
    propertyNameText(positionFor.name, positionFor.getSourceFile()) !== 'positionFor' ||
    !ts.isCallExpression(positionFor.initializer) ||
    !ts.isIdentifier(positionFor.initializer.expression) ||
    positionFor.initializer.expression.text !== 'createOffsetToPosition' ||
    positionFor.initializer.arguments.length !== 1 ||
    !ts.isIdentifier(positionFor.initializer.arguments[0]) ||
    positionFor.initializer.arguments[0].text !== 'source'
  ) {
    return false;
  }
  if (
    !ts.isExpressionStatement(setStatement) ||
    !ts.isCallExpression(setStatement.expression) ||
    !ts.isPropertyAccessExpression(setStatement.expression.expression) ||
    !ts.isIdentifier(setStatement.expression.expression.expression) ||
    setStatement.expression.expression.expression.text !== 'diagnosticFactoryStates' ||
    setStatement.expression.expression.name.text !== 'set' ||
    setStatement.expression.arguments.length !== 2 ||
    !ts.isIdentifier(setStatement.expression.arguments[0]) ||
    setStatement.expression.arguments[0].text !== 'factory' ||
    !ts.isIdentifier(setStatement.expression.arguments[1]) ||
    setStatement.expression.arguments[1].text !== 'state'
  ) {
    return false;
  }
  return (
    ts.isReturnStatement(returnStatement) &&
    returnStatement.expression !== undefined &&
    ts.isIdentifier(returnStatement.expression) &&
    returnStatement.expression.text === 'factory'
  );
}

function diagnosticFactoryShellIsExact(defineCall) {
  if (defineCall.arguments.length !== 3) return false;
  const shell = unwrapTransparentExpression(defineCall.arguments[0]);
  const brand = unwrapTransparentExpression(defineCall.arguments[1]);
  const descriptor = unwrapTransparentExpression(defineCall.arguments[2]);
  if (
    !ts.isObjectLiteralExpression(shell) ||
    shell.properties.length !== 1 ||
    !ts.isShorthandPropertyAssignment(shell.properties[0]) ||
    shell.properties[0].name.text !== 'fileName' ||
    !ts.isIdentifier(brand) ||
    brand.text !== 'diagnosticFactoryBrand' ||
    !ts.isObjectLiteralExpression(descriptor) ||
    descriptor.properties.length !== 4
  ) {
    return false;
  }
  const expected = new Map([
    ['configurable', ts.SyntaxKind.FalseKeyword],
    ['enumerable', ts.SyntaxKind.FalseKeyword],
    ['value', ts.SyntaxKind.TrueKeyword],
    ['writable', ts.SyntaxKind.FalseKeyword],
  ]);
  for (const property of descriptor.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyNameText(property.name, property.getSourceFile());
    if (expected.get(name) !== property.initializer.kind) return false;
    expected.delete(name);
  }
  return expected.size === 0;
}

function hasExactDiagnosticFactoryOwnershipGuard(declaration) {
  if (declaration.body === undefined) return false;
  const statements = declaration.body.statements;
  const stateIndex = statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'state',
      ),
  );
  if (stateIndex !== 0) return false;
  const stateStatement = statements[stateIndex];
  if (
    !ts.isVariableStatement(stateStatement) ||
    (stateStatement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    stateStatement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const state = stateStatement.declarationList.declarations[0];
  if (
    state === undefined ||
    !ts.isIdentifier(state.name) ||
    state.name.text !== 'state' ||
    state.initializer === undefined ||
    !ts.isCallExpression(state.initializer) ||
    !ts.isPropertyAccessExpression(state.initializer.expression) ||
    !ts.isIdentifier(state.initializer.expression.expression) ||
    state.initializer.expression.expression.text !== 'diagnosticFactoryStates' ||
    state.initializer.expression.name.text !== 'get' ||
    state.initializer.arguments.length !== 1 ||
    !ts.isIdentifier(state.initializer.arguments[0]) ||
    state.initializer.arguments[0].text !== 'factory'
  ) {
    return false;
  }
  const guard = statements[stateIndex + 1];
  if (
    guard === undefined ||
    !ts.isIfStatement(guard) ||
    guard.elseStatement !== undefined ||
    !ts.isBinaryExpression(guard.expression) ||
    guard.expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !ts.isIdentifier(guard.expression.left) ||
    guard.expression.left.text !== 'state' ||
    !ts.isIdentifier(guard.expression.right) ||
    guard.expression.right.text !== 'undefined' ||
    !ts.isBlock(guard.thenStatement) ||
    guard.thenStatement.statements.length !== 1
  ) {
    return false;
  }
  const rejection = guard.thenStatement.statements[0];
  return (
    rejection !== undefined &&
    ts.isThrowStatement(rejection) &&
    rejection.expression !== undefined &&
    ts.isNewExpression(rejection.expression) &&
    ts.isIdentifier(rejection.expression.expression) &&
    rejection.expression.expression.text === 'TypeError' &&
    rejection.expression.arguments?.length === 1 &&
    ts.isStringLiteralLike(rejection.expression.arguments[0]) &&
    rejection.expression.arguments[0].text ===
      'DiagnosticFactory must be created by createDiagnosticFactory.'
  );
}

function isPrivateDiagnosticFactoryBrandMember(member, sourceFile) {
  return (
    ts.isPropertySignature(member) &&
    member.name !== undefined &&
    ts.isComputedPropertyName(member.name) &&
    ts.isIdentifier(member.name.expression) &&
    member.name.expression.text === 'diagnosticFactoryBrand' &&
    member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ===
      true &&
    member.type !== undefined &&
    ts.isLiteralTypeNode(member.type) &&
    member.type.literal.kind === ts.SyntaxKind.TrueKeyword &&
    propertyNameText(member.name, sourceFile) === '[diagnosticFactoryBrand]'
  );
}

function identifierOccurrenceCount(sourceFile, name) {
  let count = 0;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function findTopLevelVariable(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
  return undefined;
}

function findVariableInNode(root, name) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isStaticMemberCall(call, receiver, member) {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === receiver &&
    call.expression.name.text === member
  );
}

function callTargetsStaticMember(call, receiver, member, context) {
  return expressionTargetsStaticMember(call.expression, receiver, member, context, new Set());
}

function expressionTargetsStaticMember(expression, receiver, member, context, seen) {
  const value = unwrapTransparentExpression(expression);
  if (value === undefined) return false;
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const selected = ts.isPropertyAccessExpression(value)
      ? value.name.text
      : staticStringValue(value.argumentExpression, context, new Set());
    return (
      selected === member &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === receiver &&
      identifierIsRuntimeGlobal(value.expression, context)
    );
  }
  if (!ts.isIdentifier(value)) return false;
  const symbol = context.checker.getSymbolAtLocation(value);
  if (symbol === undefined || seen.has(symbol)) return false;
  seen.add(symbol);
  const declaration = preferredValueDeclaration(symbol);
  if (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  ) {
    return expressionTargetsStaticMember(declaration.initializer, receiver, member, context, seen);
  }
  if (
    declaration !== undefined &&
    ts.isBindingElement(declaration) &&
    ts.isObjectBindingPattern(declaration.parent) &&
    ts.isVariableDeclaration(declaration.parent.parent) &&
    declaration.parent.parent.initializer !== undefined
  ) {
    const selected = declaration.propertyName ?? declaration.name;
    return (
      staticPropertyName(selected, context) === member &&
      ts.isIdentifier(declaration.parent.parent.initializer) &&
      declaration.parent.parent.initializer.text === receiver &&
      identifierIsRuntimeGlobal(declaration.parent.parent.initializer, context)
    );
  }
  return false;
}

function variableIsExported(declaration) {
  return ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent)
    ? hasExportModifier(declaration.parent.parent)
    : false;
}

/**
 * Derive exact source and executable-witness identities without consulting the registry's
 * enforcementClass. The reviewed evidence ledger assigns these identities to layers separately;
 * this split is what lets the gate reject a coherent SPEC/generated-registry relabel.
 */
export function deriveDiagnosticActualLayerBindingFacts({
  emissionSites,
  evidence,
  fixtureFiles,
  rows,
}) {
  const productionSites = [];
  for (const [code, sites] of emissionSites) {
    for (const site of sites) {
      productionSites.push({ code, identity: diagnosticEmissionSiteIdentity(code, site) });
    }
  }

  const evidenceWitnesses = [];
  const entries = evidence?.diagnostics ?? {};
  const matrix = evidence?.compilerMatrix;
  const matrixSource = normalizePath(matrix?.source ?? '<missing>');
  const matrixTestFile = normalizePath(matrix?.test ?? '<missing>');
  const matrixTestName = matrix?.testName ?? '<missing>';
  const matrixSourceDigest = sourceTextDigest(fixtureFiles?.[matrixSource] ?? '<missing>');
  const matrixTestBody =
    findNamedTest(fixtureFiles?.[matrixTestFile] ?? '', matrixTestName, matrixTestFile) ??
    '<missing>';

  for (const row of rows) {
    if (row.severity !== 'error') continue;
    const entry = entries[row.code];
    if (entry?.kind === compilerMatrixKind) {
      evidenceWitnesses.push({
        code: row.code,
        identity: [
          row.code,
          'compiler-matrix',
          `${matrixSource}#${row.code}`,
          `source=${matrixSourceDigest}`,
          `${matrixTestFile}#${matrixTestName}`,
          `body=${sourceTextDigest(matrixTestBody)}`,
        ].join('|'),
        role: 'compiler-matrix',
      });
      continue;
    }

    const references =
      entry?.kind === fixturesKind
        ? [
            ['red', entry.red],
            ['green', entry.green],
            ['own-layer', entry.ownLayer],
          ]
        : entry?.kind === reviewedZeroEmissionKind
          ? [['zero-emission mutation', entry.mutation]]
          : [];
    for (const [role, reference] of references) {
      const file = normalizePath(reference?.file ?? '<missing>');
      const testName = reference?.test ?? '<missing>';
      const body = findNamedTest(fixtureFiles?.[file] ?? '', testName, file) ?? '<missing>';
      evidenceWitnesses.push({
        code: row.code,
        identity: [row.code, role, `${file}#${testName}`, `body=${sourceTextDigest(body)}`].join(
          '|',
        ),
        role,
      });
    }
  }

  productionSites.sort((left, right) => left.identity.localeCompare(right.identity));
  evidenceWitnesses.sort((left, right) => left.identity.localeCompare(right.identity));
  return { evidenceWitnesses, productionSites };
}

function diagnosticEmissionSiteIdentity(code, site) {
  return [
    code,
    `${normalizePath(site.file)}:${site.line}`,
    site.emitter,
    `owner=${site.ownerDigest}`,
    `body=${site.siteDigest}`,
  ].join('|');
}

function sourceTextDigest(source) {
  return createHash('sha256').update(source).digest('hex');
}

function validateDiagnosticActualLayerBindings({ emissionSites, evidence, fixtureFiles, rows }) {
  const findings = [];
  const review = evidence?.actualLayerBindings;
  if (review === null || typeof review !== 'object' || Array.isArray(review)) {
    return [
      `${diagnosticConformanceEvidencePath}: independently reviewed actual-layer bindings are missing`,
    ];
  }

  const reviewDigest = diagnosticActualLayerReviewDigest(review);
  if (reviewDigest !== expectedDiagnosticActualLayerReviewDigest) {
    findings.push(
      `${diagnosticConformanceEvidencePath}: independently reviewed actual-layer binding manifest drifted (received ${reviewDigest})`,
    );
  }

  const primary = reviewedLayerAssignments(review.primary, 'primary diagnostic', findings);
  const production = reviewedLayerAssignments(review.productionSites, 'production site', findings);
  const witnesses = reviewedLayerAssignments(
    review.evidenceWitnesses,
    'evidence witness',
    findings,
  );

  const expectedCodes = new Set(rows.map((row) => row.code));
  findings.push(
    ...exactCodeSetFindings(
      `${diagnosticConformanceEvidencePath} primary actual-layer bindings`,
      new Set(primary.keys()),
      expectedCodes,
    ),
  );

  const facts = deriveDiagnosticActualLayerBindingFacts({
    emissionSites,
    evidence,
    fixtureFiles,
    rows,
  });
  const derivedProduction = exactIdentityMap(
    facts.productionSites,
    'derived production diagnostic site',
    findings,
  );
  const derivedWitnesses = exactIdentityMap(
    facts.evidenceWitnesses,
    'derived diagnostic evidence witness',
    findings,
  );
  findings.push(
    ...exactIdentitySetFindings(
      `${diagnosticConformanceEvidencePath} production actual-layer bindings`,
      new Set(production.keys()),
      new Set(derivedProduction.keys()),
    ),
    ...exactIdentitySetFindings(
      `${diagnosticConformanceEvidencePath} witness actual-layer bindings`,
      new Set(witnesses.keys()),
      new Set(derivedWitnesses.keys()),
    ),
  );

  for (const row of rows) {
    const actual = primary.get(row.code);
    if (actual !== undefined && actual !== row.enforcementClass) {
      findings.push(
        `${row.code}: independently bound primary actual layer ${actual} disagrees with SPEC enforcement ${row.enforcementClass}`,
      );
    }
  }

  for (const [identity, fact] of derivedProduction) {
    const siteLayer = production.get(identity);
    const primaryLayer = primary.get(fact.code);
    if (siteLayer === undefined || primaryLayer === undefined) continue;
    // SPEC §11.3 precedence is deliberately not equality here. A compile-error may retain a
    // runtime floor, and a runtime-primary guarantee may reject statically provable subsets before
    // execution. An audited site, however, cannot stand in for either blocking posture (or vice
    // versa); each mixed blocking site remains exact and review-bound above.
    if ((primaryLayer === 'audited-escape') !== (siteLayer === 'audited-escape')) {
      findings.push(
        `${fact.code}: production site ${identity} has actual layer ${siteLayer}, incompatible with primary ${primaryLayer}`,
      );
    }
  }

  for (const [identity, fact] of derivedWitnesses) {
    const witnessLayer = witnesses.get(identity);
    const primaryLayer = primary.get(fact.code);
    if (witnessLayer !== undefined && primaryLayer !== undefined && witnessLayer !== primaryLayer) {
      findings.push(
        `${fact.code}: ${fact.role} witness has actual layer ${witnessLayer}, but primary evidence must prove ${primaryLayer}`,
      );
    }
  }

  return findings;
}

function reviewedLayerAssignments(groups, label, findings) {
  const assignments = new Map();
  if (groups === null || typeof groups !== 'object' || Array.isArray(groups)) {
    findings.push(`${diagnosticConformanceEvidencePath}: ${label} layer groups are missing`);
    return assignments;
  }
  for (const key of Object.keys(groups)) {
    if (!diagnosticActualLayers.includes(key)) {
      findings.push(`${diagnosticConformanceEvidencePath}: unknown ${label} layer ${key}`);
    }
  }
  for (const layer of diagnosticActualLayers) {
    const values = groups[layer];
    if (!Array.isArray(values)) {
      findings.push(
        `${diagnosticConformanceEvidencePath}: ${label} layer ${layer} must be an array`,
      );
      continue;
    }
    for (const value of values) {
      if (typeof value !== 'string' || value.length === 0) {
        findings.push(
          `${diagnosticConformanceEvidencePath}: ${label} layer ${layer} contains an invalid identity`,
        );
        continue;
      }
      if (assignments.has(value)) {
        findings.push(`${diagnosticConformanceEvidencePath}: duplicate ${label} binding ${value}`);
        continue;
      }
      assignments.set(value, layer);
    }
  }
  return assignments;
}

function exactIdentityMap(facts, label, findings) {
  const result = new Map();
  for (const fact of facts) {
    if (result.has(fact.identity)) findings.push(`${label} identity collided: ${fact.identity}`);
    else result.set(fact.identity, fact);
  }
  return result;
}

function exactIdentitySetFindings(label, actual, expected) {
  const missing = [...expected].filter((identity) => !actual.has(identity)).sort();
  const extra = [...actual].filter((identity) => !expected.has(identity)).sort();
  const findings = [];
  if (missing.length > 0) findings.push(`${label}: missing ${missing.join(', ')}`);
  if (extra.length > 0) findings.push(`${label}: unexpected ${extra.join(', ')}`);
  return findings;
}

function diagnosticActualLayerReviewDigest(review) {
  const rows = [
    `reviewBasis\0${typeof review?.reviewBasis === 'string' ? review.reviewBasis : '<missing>'}`,
  ];
  for (const section of ['primary', 'productionSites', 'evidenceWitnesses']) {
    for (const layer of diagnosticActualLayers) {
      const values = Array.isArray(review?.[section]?.[layer])
        ? review[section][layer].filter((value) => typeof value === 'string').sort()
        : ['<missing>'];
      for (const value of values) rows.push(`${section}\0${layer}\0${value}`);
    }
  }
  return sourceTextDigest(rows.join('\n'));
}

function validateDiagnosticEvidence({ emissionSites, errorCodes, evidence, fixtureFiles }) {
  const findings = [];
  if (evidence?.schema !== diagnosticConformanceSchema) {
    findings.push(
      `${diagnosticConformanceEvidencePath}: schema must be ${diagnosticConformanceSchema}`,
    );
    return findings;
  }

  const entries = evidence.diagnostics ?? {};
  const expectedCodes = new Set(errorCodes);
  findings.push(
    ...exactCodeSetFindings(
      `${diagnosticConformanceEvidencePath} error evidence`,
      new Set(Object.keys(entries)),
      expectedCodes,
    ),
  );

  const matrix = evidence.compilerMatrix;
  const matrixCodes = matrixCodesFromSource(fixtureFiles?.[matrix?.source] ?? '');
  const matrixTest = findNamedTest(fixtureFiles?.[matrix?.test] ?? '', matrix?.testName);
  if (matrixTest === undefined) {
    findings.push(`${matrix?.test ?? '<missing>'}: compiler matrix red/green test is missing`);
  } else if (!matrixTest.includes('.positive()') || !matrixTest.includes('.negative()')) {
    findings.push(`${matrix.test}: compiler matrix test must execute positive() and negative()`);
  }

  for (const code of errorCodes) {
    const entry = entries[code];
    if (entry === undefined) continue;
    const sites = emissionSites.get(code) ?? [];

    if (entry.kind === reviewedZeroEmissionKind) {
      if (sites.length > 0) {
        findings.push(`${code}: reviewed zero-emission applicability contradicts derived sites`);
      }
      if (typeof entry.reason !== 'string' || entry.reason.trim().length < 24) {
        findings.push(`${code}: zero-emission applicability needs a reviewed, explicit reason`);
      }
      if (typeof entry.reviewer !== 'string' || entry.reviewer.trim().length === 0) {
        findings.push(`${code}: zero-emission applicability needs a named reviewer role`);
      }
      findings.push(
        ...validateFixtureReference(code, 'zero-emission mutation', entry.mutation, fixtureFiles),
      );
      continue;
    }

    if (sites.length === 0) {
      findings.push(`${code}: no derived production enforcement site`);
    }

    if (entry.kind === compilerMatrixKind) {
      if (!matrixCodes.has(code)) {
        findings.push(`${code}: compiler-matrix evidence row is missing from ${matrix?.source}`);
      }
      if (entry.ownerPackage !== 'compiler') {
        findings.push(`${code}: compiler-matrix evidence ownerPackage must be compiler`);
      }
      continue;
    }

    if (entry.kind !== fixturesKind) {
      findings.push(
        `${code}: evidence kind must be ${fixturesKind}, ${compilerMatrixKind}, or ${reviewedZeroEmissionKind}`,
      );
      continue;
    }

    const roleReferences = [entry.red, entry.green, entry.ownLayer]
      .filter(
        (reference) => typeof reference?.file === 'string' && typeof reference?.test === 'string',
      )
      .map((reference) => `${normalizePath(reference.file)}#${reference.test}`);
    if (roleReferences.length === 3 && new Set(roleReferences).size !== 3) {
      findings.push(`${code}: red, green, and own-layer fixtures must be three distinct tests`);
    }

    findings.push(...validateFixtureReference(code, 'red', entry.red, fixtureFiles, true));
    findings.push(...validateFixtureReference(code, 'green', entry.green, fixtureFiles));
    findings.push(...validateFixtureReference(code, 'own-layer', entry.ownLayer, fixtureFiles));
    const ownFile = normalizePath(entry.ownLayer?.file ?? '');
    if (
      typeof entry.ownerPackage !== 'string' ||
      !ownFile.startsWith(`packages/${entry.ownerPackage}/`)
    ) {
      findings.push(
        `${code}: own-layer fixture must live under declared owner package ${entry.ownerPackage ?? '<missing>'}`,
      );
    }
  }
  return findings;
}

function validateFixtureReference(code, label, reference, fixtureFiles, requireCode = false) {
  if (
    reference === undefined ||
    typeof reference.file !== 'string' ||
    typeof reference.test !== 'string'
  ) {
    return [`${code}: ${label} fixture reference is incomplete`];
  }
  const file = normalizePath(reference.file);
  if (!isTestSourcePath(file)) return [`${code}: ${label} fixture must name a test source file`];
  const text = fixtureFiles?.[file];
  if (typeof text !== 'string') return [`${code}: ${label} fixture file ${file} is missing`];
  const test = findNamedTest(text, reference.test, file);
  if (test === undefined) return [`${code}: ${label} fixture test "${reference.test}" is missing`];
  const findings = [];
  if (!fixtureTestHasNonVacuousAssertion(test, file)) {
    findings.push(
      `${code}: ${label} fixture test "${reference.test}" has no non-vacuous assertion`,
    );
  }
  if (label === 'green' && greenFixturePositivelyAssertsCode(test, code, file)) {
    findings.push(
      `${code}: green fixture test "${reference.test}" positively asserts the diagnostic instead of an accepted path`,
    );
  }
  if (requireCode && !fixtureTestBodyReferencesCode(test, code, file)) {
    findings.push(
      `${code}: red fixture test "${reference.test}" no longer asserts the diagnostic code in its callback`,
    );
  }
  return findings;
}

function greenFixturePositivelyAssertsCode(testBody, code, fileName) {
  const sourceFile = fixtureCallbackSource(testBody, fileName);
  let found = false;
  const positiveMatchers = new Set([
    'toContain',
    'toEqual',
    'toMatch',
    'toMatchObject',
    'toStrictEqual',
    'toThrow',
    'toThrowError',
  ]);
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text;
      if (
        positiveMatchers.has(matcher) &&
        !matcherChainHasNot(node.expression.expression) &&
        node.arguments.some((argument) => argument.getText(sourceFile).includes(code))
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function matcherChainHasNot(expression) {
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    if (current.name.text === 'not') return true;
    current = current.expression;
  }
  return false;
}

function findNamedTest(text, testName, fileName = 'fixture.test.ts') {
  if (typeof text !== 'string' || typeof testName !== 'string') return undefined;
  const cacheKey = createHash('sha256').update(`${fileName}\0${text}`).digest('hex');
  let tests = namedFixtureTestCache.get(cacheKey);
  if (tests === undefined) {
    tests = collectNamedFixtureTests(text, fileName);
    namedFixtureTestCache.set(cacheKey, tests);
  }
  return tests.get(testName);
}

function collectNamedFixtureTests(text, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tests = new Map();
  if (!vitestBindingIsExact(sourceFile, 'expect')) return tests;
  if (sourceFileHasExclusiveTestRegistration(sourceFile)) return tests;
  const visit = (node) => {
    if (ts.isCallExpression(node) && isTestCall(node.expression, sourceFile)) {
      const title = node.arguments[0];
      if (title && ts.isStringLiteralLike(title)) {
        const callback = node.arguments[1];
        if (
          testRegistrationIsUnconditionallyActive(node, sourceFile) &&
          callback !== undefined &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          tests.set(
            title.text,
            tests.has(title.text) ? undefined : callback.body.getText(sourceFile),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tests;
}

function sourceFileHasExclusiveTestRegistration(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const chain = vitestRegistrationMemberChain(node, sourceFile);
      if (
        chain !== undefined &&
        (chain.members.includes('only') || chain.members.includes(undefined))
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function vitestRegistrationMemberChain(expression, sourceFile) {
  const members = [];
  let value = expression;
  while (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    members.unshift(
      ts.isPropertyAccessExpression(value)
        ? value.name.text
        : value.argumentExpression !== undefined &&
            (ts.isStringLiteralLike(value.argumentExpression) ||
              ts.isNoSubstitutionTemplateLiteral(value.argumentExpression))
          ? value.argumentExpression.text
          : undefined,
    );
    value = value.expression;
  }
  if (
    !ts.isIdentifier(value) ||
    !['describe', 'it', 'suite', 'test'].includes(value.text) ||
    !vitestBindingIsExact(sourceFile, value.text)
  ) {
    return undefined;
  }
  return { base: value.text, members };
}

function testRegistrationIsUnconditionallyActive(call, sourceFile) {
  const testCallee = call.expression.getText(sourceFile);
  if (/\.(?:skip|skipIf|todo|only|runIf)(?:\b|\()/u.test(testCallee)) return false;
  let ancestor = call.parent;
  while (ancestor !== undefined && !ts.isSourceFile(ancestor)) {
    if (
      ts.isIfStatement(ancestor) ||
      ts.isConditionalExpression(ancestor) ||
      ts.isSwitchStatement(ancestor) ||
      ts.isForStatement(ancestor) ||
      ts.isForInStatement(ancestor) ||
      ts.isForOfStatement(ancestor) ||
      ts.isWhileStatement(ancestor) ||
      ts.isDoStatement(ancestor) ||
      ts.isTryStatement(ancestor) ||
      (ts.isBinaryExpression(ancestor) &&
        (ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          ancestor.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          ancestor.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return false;
    }
    if (ts.isFunctionLike(ancestor)) {
      const suiteCall = ancestor.parent;
      if (
        !ts.isCallExpression(suiteCall) ||
        !suiteCall.arguments.includes(ancestor) ||
        !isUnconditionallyActiveSuiteCall(suiteCall.expression, sourceFile)
      ) {
        return false;
      }
    }
    ancestor = ancestor.parent;
  }
  return true;
}

function isUnconditionallyActiveSuiteCall(expression, sourceFile) {
  return (
    ts.isIdentifier(expression) &&
    (expression.text === 'describe' || expression.text === 'suite') &&
    vitestBindingIsExact(sourceFile, expression.text)
  );
}

function vitestBindingIsExact(sourceFile, name) {
  let exactImportCount = 0;
  let shadowed = false;
  const visit = (node) => {
    if (shadowed) return;
    if (ts.isImportSpecifier(node) && node.name.text === name) {
      const declaration = node.parent.parent.parent;
      if (node.propertyName === undefined && declaration.moduleSpecifier.text === 'vitest') {
        exactImportCount += 1;
      } else {
        shadowed = true;
      }
      return;
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      node.name !== undefined &&
      bindingNameContains(node.name, name)
    ) {
      shadowed = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      node.left.text === name
    ) {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return exactImportCount === 1 && !shadowed;
}

function fixtureTestHasNonVacuousAssertion(testBody, fileName) {
  const sourceFile = fixtureCallbackSource(testBody, fileName);
  let witnessed = false;
  const visit = (node) => {
    if (witnessed) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'expect' &&
      node.arguments[0] !== undefined &&
      expressionContainsRuntimeWitness(node.arguments[0])
    ) {
      witnessed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return witnessed;
}

function expressionContainsRuntimeWitness(expression) {
  let witnessed = false;
  const visit = (node) => {
    if (witnessed) return;
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isAwaitExpression(node) ||
      (ts.isIdentifier(node) &&
        node.text !== 'undefined' &&
        node.text !== 'NaN' &&
        node.text !== 'Infinity')
    ) {
      witnessed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return witnessed;
}

function fixtureTestBodyReferencesCode(testBody, code, fileName) {
  const sourceFile = fixtureCallbackSource(testBody, fileName);
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      (ts.isStringLiteralLike(node) ||
        node.kind === ts.SyntaxKind.RegularExpressionLiteral ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.getText(sourceFile).includes(code)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function fixtureCallbackSource(testBody, fileName) {
  const syntheticFile = `${fileName}.diagnostic-witness.ts`;
  return ts.createSourceFile(
    syntheticFile,
    `const diagnosticWitness = async () => ${testBody};`,
    ts.ScriptTarget.Latest,
    true,
    syntheticFile.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function diagnosticEvidenceWitnessDigest(errorCodes, evidence, fixtureFiles) {
  const rows = [];
  const entries = evidence?.diagnostics ?? {};
  for (const code of errorCodes) {
    const entry = entries[code];
    if (entry === undefined) {
      rows.push(`${code}\0<missing>`);
      continue;
    }
    rows.push(`${code}\0kind\0${entry.kind ?? '<missing>'}\0${entry.ownerPackage ?? '<missing>'}`);
    const references =
      entry.kind === fixturesKind
        ? [
            ['red', entry.red],
            ['green', entry.green],
            ['own-layer', entry.ownLayer],
          ]
        : entry.kind === reviewedZeroEmissionKind
          ? [['zero-emission mutation', entry.mutation]]
          : [];
    for (const [label, reference] of references) {
      const file = normalizePath(reference?.file ?? '<missing>');
      const testName = reference?.test ?? '<missing>';
      const body = findNamedTest(fixtureFiles?.[file] ?? '', testName, file) ?? '<missing>';
      rows.push(`${code}\0${label}\0${file}\0${testName}\0${body}`);
    }
  }
  const matrix = evidence?.compilerMatrix;
  const matrixFile = normalizePath(matrix?.test ?? '<missing>');
  rows.push(
    `compiler-matrix\0${matrixFile}\0${matrix?.testName ?? '<missing>'}\0${
      findNamedTest(fixtureFiles?.[matrixFile] ?? '', matrix?.testName, matrixFile) ?? '<missing>'
    }`,
  );
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function isTestCall(expression, sourceFile) {
  return (
    ts.isIdentifier(expression) &&
    (expression.text === 'it' || expression.text === 'test') &&
    vitestBindingIsExact(sourceFile, expression.text)
  );
}

function matrixCodesFromSource(source) {
  const block = source.match(/const compilerDiagnosticCoverageOrder = \[([\s\S]*?)\] as const/u);
  if (!block) return new Set();
  return new Set(Array.from(block[1].matchAll(/'(KV\d{3})'/gu), (match) => match[1]));
}

function exactCodeSetFindings(label, actual, expected) {
  const missing = [...expected].filter((code) => !actual.has(code)).sort(compareCodes);
  const extra = [...actual].filter((code) => !expected.has(code)).sort(compareCodes);
  const findings = [];
  if (missing.length > 0) findings.push(`${label}: missing ${missing.join(', ')}`);
  if (extra.length > 0) findings.push(`${label}: unexpected ${extra.join(', ')}`);
  return findings;
}

function referencedEvidenceFiles(evidence) {
  const files = new Set();
  if (typeof evidence?.compilerMatrix?.source === 'string')
    files.add(evidence.compilerMatrix.source);
  if (typeof evidence?.compilerMatrix?.test === 'string') files.add(evidence.compilerMatrix.test);
  for (const entry of Object.values(evidence?.diagnostics ?? {})) {
    for (const key of ['red', 'green', 'ownLayer', 'mutation']) {
      if (typeof entry?.[key]?.file === 'string') files.add(normalizePath(entry[key].file));
    }
  }
  return files;
}

function collectPackageSourceFiles(root) {
  const files = [];
  const packagesRoot = path.join(root, 'packages');
  walk(packagesRoot, (absolutePath) => {
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (!/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(relativePath)) return;
    files.push({ path: relativePath, text: readFileSync(absolutePath, 'utf8') });
  });
  return files;
}

function walk(directory, onFile) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(child, onFile);
    else if (entry.isFile()) onFile(child);
  }
}

function isProductionSourcePath(fileName) {
  const file = normalizePath(fileName);
  return (
    /^packages\/[^/]+\/.+\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file) &&
    !/^packages\/[^/]+\/(?:dist|node_modules|templates|test)\//u.test(file) &&
    !isTestSourcePath(file) &&
    !file.startsWith('packages/conformance-fixtures/')
  );
}

function validateExcludedSourceReachability(files, observedEdges = new Set()) {
  const allFiles = new Map(
    files
      .map((file) => [normalizePath(file.path), file.text])
      .filter(([fileName]) => fileName.startsWith('packages/')),
  );
  const allPaths = new Set(allFiles.keys());
  const analysis = createProductionAnalysis(files);
  const findings = [];
  for (const [fileName, sourceFile] of analysis.sourceFiles) {
    const context = { ...analysis, fileName, sourceFile };
    const visit = (node) => {
      for (const moduleSpecifier of staticModuleSpecifiersAtNode(node, context)) {
        const target = resolveExistingPackageModulePath(fileName, moduleSpecifier, allPaths);
        if (target !== undefined && !isProductionSourcePath(target)) {
          const edge = excludedReachabilityEdgeKey(
            fileName,
            sourceFile.text,
            target,
            allFiles.get(target),
          );
          if (edge !== undefined) observedEdges.add(edge);
          if (edge === undefined || !reviewedExcludedSourceReachability.has(edge)) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            findings.push(
              `${fileName}:${position.line + 1}: production source may not reach excluded framework source ${target}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return findings;
}

function excludedReachabilityEdgeKey(importer, importerText, target, targetText) {
  if (targetText === undefined) return undefined;
  return `${importer}#${createHash('sha256').update(importerText).digest('hex')}#${target}#${createHash('sha256').update(targetText).digest('hex')}`;
}

function staticModuleSpecifiersAtNode(node, context) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return new Set([node.moduleSpecifier.text]);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return new Set([node.moduleReference.expression.text]);
  }
  if (!ts.isCallExpression(node)) return new Set();
  const loader = runtimeModuleLoaderArgument(node, context);
  return loader.recognized
    ? possibleStaticStringValues(loader.argument, context, new Set())
    : new Set();
}

function resolveExistingPackageModulePath(fileName, moduleSpecifier, allPaths) {
  if (moduleSpecifier === '@kovojs/conformance-fixtures') {
    return [...allPaths].find((candidate) =>
      candidate.startsWith('packages/conformance-fixtures/'),
    );
  }
  if (moduleSpecifier.startsWith('@kovojs/conformance-fixtures/')) {
    const suffix = moduleSpecifier.slice('@kovojs/conformance-fixtures/'.length);
    const base = `packages/conformance-fixtures/${suffix}`;
    return modulePathCandidates(base).find((candidate) => allPaths.has(candidate));
  }
  const packageImport = moduleSpecifier.match(/^@kovojs\/([^/]+)(?:\/(.*))?$/u);
  if (packageImport !== null) {
    const packageName = packageImport[1];
    const suffix = packageImport[2] ?? 'src/index';
    const bases = [`packages/${packageName}/${suffix}`, `packages/${packageName}/src/${suffix}`];
    for (const base of bases) {
      const target = modulePathCandidates(base).find((candidate) => allPaths.has(candidate));
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (!moduleSpecifier.startsWith('.')) return undefined;
  const base = normalizePath(
    path.posix.normalize(path.posix.join(path.posix.dirname(fileName), moduleSpecifier)),
  );
  return modulePathCandidates(base).find((candidate) => allPaths.has(candidate));
}

function modulePathCandidates(base) {
  const withoutRuntimeExtension = base.replace(/\.(?:mjs|cjs|js)$/u, '');
  const candidates = [base, withoutRuntimeExtension];
  for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
    candidates.push(`${withoutRuntimeExtension}${extension}`);
    candidates.push(`${withoutRuntimeExtension}/index${extension}`);
  }
  return [...new Set(candidates)];
}

function isTestSourcePath(fileName) {
  return /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/u.test(
    normalizePath(fileName),
  );
}

function normalizePath(value) {
  return String(value).replaceAll(path.sep, '/');
}

function compareCodes(left, right) {
  return Number(left.slice(2)) - Number(right.slice(2));
}

function conformanceResult(findings, codes, errorCodes, sites) {
  return {
    codes,
    errorCodes,
    findings,
    ok: findings.length === 0,
    sites,
  };
}

export async function main(options = {}) {
  const result = evaluateSpecConformanceClosure(await loadSpecConformanceInput(options));
  process.stdout.write(
    `check-spec-conformance-closure/v1 ${result.ok ? 'OK' : 'FAIL'} codes=${result.codes} errors=${result.errorCodes} sites=${result.sites}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`- ${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
