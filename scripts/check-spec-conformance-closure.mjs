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
export const diagnosticConformanceSchema = 'kovo.diagnostic-conformance-evidence/v1';

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
const serverBuildSecurityIntrinsicsPath = 'packages/server/src/build-security-intrinsics.ts';
const serverSecurityWitnessIntrinsicsPath = 'packages/server/src/security-witness-intrinsics.ts';
const verifierDiagnosticsPath = 'packages/test/src/verifier-diagnostics.ts';
const verifierSecurityIntrinsicsPath = 'packages/test/src/verifier-security-intrinsics.ts';
const rootDiagnosticDoor = `${coreDiagnosticsPath}#createRegisteredDiagnostic`;
const diagnosticFactoryDoor = `${compilerDiagnosticsPath}#diagnosticAt`;
const generatedDiagnosticConstructorDoor = `${coreDiagnosticsPath}#createDiagnosticConstructor`;
const expectedDiagnosticEmissionSiteDigest =
  '1f605f161d5d1d5513044e1403ff7ce34772583cbbee778aecba9abc60d04ef2';
const expectedRootDiagnosticDoorDigest =
  '6ace905f997e5c733f0e3b070dde67b2c6a399bf1b1f8f92851b0bd4985440e8';
const expectedRegisteredDiagnosticDefinitionFactoryDigest =
  'e8dd153b51da2c8f22bc81bfe190d872c63bca35acf4a10ddef4db6f511f6a97';
const expectedDiagnosticFactoryConstructorDigest =
  'f6a630771e31fc07f420b1b67a62c8d9f0400b369c9d04b95f52d2172622bde6';
const expectedDiagnosticFactorySinkDigest =
  '74213deb854487b068017e285bc57791f0fcd5ec333c8971b3bcf22df832befd';
const expectedDiagnosticEvidenceWitnessDigest =
  '0f17c841bb8faf327a15805eb1ac84c4d1a000254175e00c3a5ed00c9d34b841';
const expectedBlockingStaticExportCollectionDigest =
  '37a12e352557d6831047c8ded36f5eb4d7d616b6124b6e31f868834a5ad0ba73';
const expectedCompilerValidatorPipelineDigest =
  '1832d3bcd778d43a514906a554570f556daa91939b6fb5922b2aec4d3d24a187';
const expectedCompileComponentModuleDigest =
  'a22e75b77161b32169cd2d41c0248a61baf55e2296197e6e82adbd5341e4d904';
const expectedValidateComponentPhaseDigest =
  '54f995664b8b91f754f04481585a009e256dce30ac8f3a66cabb80fc53d109db';
const expectedCoreBuildDistCommand =
  'vp pack src/generated.ts src/index.ts src/internal/agent-docs.ts src/internal/classifier-verdict.ts src/internal/client-module-url.ts src/internal/component-render.ts src/internal/derivation.ts src/internal/diagnostics.ts src/internal/document-protocol.ts src/internal/event.ts src/internal/filesystem.ts src/internal/fragment-target.ts src/internal/framework-identity.ts src/internal/graph.ts src/internal/json.ts src/internal/module-ref.ts src/internal/package-prefix.ts src/internal/query-delta.ts src/internal/query-shape-source.ts src/internal/render-plan-token.ts src/internal/route-pattern.ts src/internal/security-markers.ts src/internal/security-operation-ir.ts src/internal/security-url.ts src/internal/semantic-attribute-manifest.ts src/internal/semantic-attributes.ts src/internal/sink-policy.ts src/internal/source-sink-registry.ts src/internal/sql-safety.ts src/internal/storage.ts src/internal/verifier.ts src/internal/wire-json.ts --dts';
// Capability-closure summaries for the few framework-owned loaders whose target is intentionally
// runtime-selected. Each row pins both the complete source file and the acquisition expression, so
// a new loader, consumer shape, or file-level dataflow change fails closed instead of extending a hand-written
// JavaScript flow interpreter (plans/10x-better-security.md, layered-closure decision).
const reviewedUnresolvedDynamicModuleAcquisitions = new Set([
  'packages/browser/src/inline-loader.ts#2f9e41eda34b608793f2dbd54817ca1f0aa04da106d278e7fef51e4d03caaa91#c7ce4597dc092d68bd9823e3434012745d9c977893566551bcdfee04cfb2a2e5',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#3b2fbaed304404bb191701b08b79947a7869566df27f18520e91925ff3bc2d31',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#f3f265afd66e69c25580b7ce0942eaf5bd8e36b1c3b9ec15d8a8cac80eba3836',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#bc216e52c412c8b193eb048ec65ffe9acb38280f67773837203ae1f164ba01a2',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#1c6d930e4e45cf09d26898686ca29ac9f739589a667ca73b6b77a70dfd7744ec',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#666bd656e7c42491b16f3d6f97fb64bef5faaf31813e8ac4ecdd5f3df6eb104d',
  'packages/cli/src/commands/build-export.ts#b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb#606f565bbb48636a234c79a4289dac3cf14d662050180563b00a61a266db42aa',
  'packages/cli/src/commands/db.ts#ee124a743f4e948da7fa66338746629c412a5f4c44113cad02e5e30cf064069b#88ff0d5b98c41aa906dd00878fccf940791c27dc1e087908d6efa85c9d56af3f',
  'packages/compiler/src/security-analyzer-soundness-oracle.ts#20c389cf7797b16fd645a7b507fda66ede4f84c3857fdb1d8cd487dd8c8b68b5#4597d4868f6caa7d49aa7fd626313ad01af41164f801c7ee52a9395287151099',
  'packages/compiler/src/security-analyzer-soundness-oracle.ts#20c389cf7797b16fd645a7b507fda66ede4f84c3857fdb1d8cd487dd8c8b68b5#7c8fe398cd82d5ea80560281e00f6154b09b15615233da0a8b56ac03f861e51b',
  'packages/compiler/src/vite-config-source.ts#4b88f6e8e7657d91dbaffe6d75cf4c4bf5863b455fd5cafb901a5c8a1a577d52#2d48f56da770ec53b7e31eacdafd3983b0929513b177d3acfd08d2c3db8012ca',
  'packages/server/src/vite-source.ts#d20810d8378391eeced5375aa3c41998c433b9846f2a612735e2c1d9365d6d41#2d48f56da770ec53b7e31eacdafd3983b0929513b177d3acfd08d2c3db8012ca',
  'packages/server/src/sqlite.ts#bf1d2efe01383618c6bb4f0c6050b408b074f8f76ab263d3a02f6a164e81d9c8#cb1f4aa1ac29147775093dc3c4411e81e956780357d25c102098893d5361a482',
  'packages/test/src/integration/optimistic-client.ts#b24a45e17548fade0853e47da6ae471c27445ca38c518f509fe71353aafe1879#c7ce4597dc092d68bd9823e3434012745d9c977893566551bcdfee04cfb2a2e5',
]);
const reviewedRuntimeModuleLoaderAuthorityFiles = new Map([
  [
    'packages/cli/src/add-catalog.ts',
    'b97ffe89a21a03af3f358f60cb65104fa0959776ad7224e0d2678a239a781b86',
  ],
  [
    'packages/cli/src/artifact-provenance.ts',
    'da1736683f02aa22445aebda0d43cc64c3a80f2b41a9de4810c0a9901a653060',
  ],
  [
    'packages/cli/src/capability-closure-packages.ts',
    '30542a21ce9288e9ec52707f79c0a02b397923c20f166a8b761c7d881224fa92',
  ],
  ['packages/cli/src/bin.ts', 'a3f0e056e282bb26179e8e4923ad17674b995ef6320326091a21e71d55db9f8e'],
  [
    'packages/cli/src/commands/build-export.ts',
    'b0d61e0aa85fb61fda9eb18b2f23addae9057d2e32aa30d2b3eff3821a295dcb',
  ],
  [
    'packages/cli/src/commands/compile.ts',
    '8924eed8109ff3123699c5a1fe55b69ede27db96a48a81587da2b933245a0d96',
  ],
  [
    'packages/cli/src/commands/dev.ts',
    '50b45397b114a15fbe4bf8ea1a531fff63f33f049d6fd2e68163acc44698531b',
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
    '7053fe51e30006da2bf9f437653f85e61bc142e63c9430eef19ee1a071543a8b',
  ],
  [
    'packages/drizzle/src/trust-escapes-static.ts',
    'bb7273924dcc8f31bcdb82058b85d3d3da801b0677fc1661ed8b1b3b10559c90',
  ],
  [
    'packages/icons/scripts/icon-plan.mjs',
    '4d740398a37db8ee61656535c11276898ce7ffdb6a38944406d37a8cfa74bbe5',
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
    'bf1d2efe01383618c6bb4f0c6050b408b074f8f76ab263d3a02f6a164e81d9c8',
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
    'e97464eaef4e91110c9d8e5c40d4038844b36ff871f27bd51958e95e3c8b6221',
  ],
]);
const reviewedExcludedSourceReachability = new Set([
  'packages/browser/src/inline-loader-response-apply-fixture.ts#827d81112f925959161c509d839ac5c547cc6fc1f0adf87173555c0fdc47c342#packages/conformance-fixtures/src/oracle-fixtures.ts#296830253989e0b95f67bda799647ab13254403ed3344491e427e14dad067c56',
]);
// Dynamic `{ code, message/severity }` projections are denied by default. The few existing
// non-diagnostic protocols and registry-derived projections are capability-closed by exact site +
// outer-owner digests; any new shape or owner edit must be reviewed explicitly.
const reviewedDynamicDiagnosticShapeSummaries = new Map([
  [
    'packages/cli/src/commands/build-export.ts#literal#a209f13a3241aa94fc75527ddecacbd22892f71c957ec29711008fa69148dc72#866753292155eaa3ce46b5aedd1ba30c9f5a55f60ad3bc41a1db59fe07cf49c4',
    'Registry-derived compiler diagnostic projection for the build-export result protocol.',
  ],
  [
    'packages/cli/src/commands/compile.ts#literal#46266841b02836a4b1a875f9222807db4ebb2e7bee8d197868ac210207efe2ac#f6581d65c230f2660ada314d445b048f17a174369588ccab51ba334a81d62a3b',
    'Registry-derived compiler diagnostic projection for the compile command result protocol.',
  ],
  [
    'packages/cli/src/commands/mcp.ts#literal#6affac251930fd2eed1ebe17b0bf9a2cedbf622fb6edbe4baab81d3366695b9f#74f1f6c9819e17da9c8199275f742db019410dbdbb2b60d1fd0dec644f6fc537',
    'Non-Kovo JSON-RPC response envelope with protocol-defined code and message fields.',
  ],
  [
    'packages/cli/src/commands/mcp.ts#literal#b6188b2dc75cde7ed04e5dffc1bb8cc23ff69c7bac827d79d3963f2166cad02b#2b1864d1eea92c670f67d773404460999b0f0a1bb7d5151aa8e23a8432cd9438',
    'Non-Kovo JSON-RPC error response with protocol-defined code and message fields.',
  ],
  [
    'packages/cli/src/commands/mcp.ts#literal#f2091906e301fb03121aa20a853418afcc31c978c1d8a82154ca6f5b7ae00d7c#fa8805bb083a94886273d47b92c0687075cc917036e3a9bedbe5060fd5dfedc4',
    'Non-Kovo JSON-RPC error response with protocol-defined code and message fields.',
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
    'packages/compiler/src/hmr-impact.ts#literal#dd6ddbf49d08780a059b50b062fe4a5dd195bc0e3e4fd5938e3acc64c6165335#dcca5e77c314a9c1374d1af3c7797f0fd933a71f5fa58a76c897d8995e740431',
    'Registry-derived compiler diagnostic projection for the HMR impact protocol.',
  ],
  [
    'packages/compiler/src/vite.ts#literal#293c37145f7111633ce41b23d828733c359937a5d21d4e97c9f3fa13d1ee2496#553626fc124adb68dc0097d3ed90d5da7b31c9d7c90cf31ce522ec85a8fabeb3',
    'Registry-derived compiler diagnostic projection for the Vite integration protocol.',
  ],
  [
    'packages/drizzle/src/graph.ts#literal#037a71b0f00e382d761fb4137b567a34140f2e1d5daa99e58cfcce9f396328f0#beed01b5fa90fee5ddd948ea765c0648b95dd154a2326d104ed6f3e69b39008b',
    'Touch-graph unresolved fact; downstream graph diagnostics own registered KV emission.',
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
    'packages/server/src/internal/data-plane-static-analysis.ts#literal#048eb4a04eb19e28bc29729be7d4c8afabee33f58e6ce6164c23009c60b4c667#4b46d3c234b34599ea420f45f0e216ffdaaee651b6624dacce71bfa74c060f71',
    'Registry-derived compiler diagnostic projection for data-plane analysis.',
  ],
  [
    'packages/server/src/internal/data-plane-static-analysis.ts#literal#d8b01e4ce93ec83c534e009638f2469aa0608d221b451f71cf8ea1f10ed10c10#57371d8c08eb6a24f7ebc60389bc9f66e024f9fdc268aea5ec31e817b4059c81',
    'Registry-derived compiler diagnostic projection for data-plane analysis.',
  ],
  [
    'packages/server/src/vite.ts#literal#1f2af3a1963df166654add61950d15bb3ff427f8c696b92f9d3d3cbe6a3f49cb#656322d0c6607285ad077b6f22b222c720d2bdb3b0b797ba652a378cc2b8d1a6',
    'Registry-derived compiler diagnostic projection for the server Vite integration.',
  ],
  [
    'packages/test/src/integration/fixture-compiler-plugin.ts#literal#6d68b0cf359673b8aaa9738ba0e6082092fc51a98d943d841017256b72d1078a#6f24790b339c702d1fc57fd7f6bb3fd02ae753a67cf002b09dd0c92cb4b32595',
    'Registry-derived compiler diagnostic projection for integration fixtures.',
  ],
  [
    'packages/test/src/verifier-snapshots.ts#literal#9224c50f792a02912a3f2d0d36f4f011064979221208a2310cdb635a06023e82#cef07ca9ac80147617387ba25768bb9844f4e16727ce2193d75e8dda6b90fa01',
    'Registry-derived verifier diagnostic projection for snapshot output.',
  ],
]);
const protectedCoreBridgeExports = new Map([
  ['createRegisteredDiagnostic', coreDiagnosticsPath],
  ['diagnosticConstructors', generatedDiagnosticRegistryModulePath],
]);

// These are reviewed wrapper definitions, not spelling-based exemptions. A call is approved only
// when its lexical binding resolves to this exact file + symbol and the wrapper graph below proves
// that definition still reaches the root createRegisteredDiagnostic door.
const reviewedDiagnosticWrappers = new Map([
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
  'diagnosticAt',
  'diagnosticFor',
  'diagnosticMessage',
  'drizzleDiagnostic',
  'drizzleDiagnosticWithoutSite',
  'eventTriggerDiagnostic',
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
    '84dc401bbeceb1f53f4fa66cb6a8d253af9fa71434d19a60ae8e60b1984690a2',
  ],
  [
    'packages/core/src/internal/diagnostic-registry.generated.ts',
    '12a9d9dca676615f074ffd1206211e0e2dc401202a6b1afda68e016a8b968334',
  ],
  [
    'packages/core/src/internal/security-markers.ts',
    'b72797c2e10fb8ebb745c4b5d4d6db0be583e2d1f4f414c4d247957d2c75a92d',
  ],
  [
    'packages/core/src/internal/source-sink-registry.ts',
    '42ed3b6993876002d822eb2fc150660ea6c197ebc3a810debcf51f5bfa08338a',
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
      rows.push(`${code}\0${site.file}\0${site.line}\0${site.emitter}\0${site.ownerDigest}`);
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
  if (/\.tsx$/u.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(fileName)) return ts.ScriptKind.JSX;
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
  if (/\.ts$/u.test(resolved)) return resolved;
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
  return (
    references.length === 3 &&
    references.includes(diagnosticDeclaration.name) &&
    references.includes(argument) &&
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
            diagnosticLiteralShape(returned, nestedContext, new Set(seen)),
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
  const visit = (node) => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      returns.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
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
            : actual?.getText(sourceFile);
        if (
          actualText === undefined ||
          !diagnosticCodeExpressionMatchesWrapperSource(actual, expected, context)
        ) {
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
  if (starExports.length !== protectedCoreBridgeExports.size) {
    findings.push(
      `${coreInternalDiagnosticsPath}: bridge must contain only the two reviewed star re-exports`,
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
  const returns = directReturnExpressions(implementation.body);
  if (returns.length !== 1 || returns[0] === undefined) {
    findings.push(`${rootDiagnosticDoor}: root must return one frozen registered diagnostic`);
    return findings;
  }
  const value = unwrapTransparentExpression(returns[0]);
  const exactFreezeImport = sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '#security-witness-intrinsics' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          element.name.text === 'freezeSecurityValue' && element.propertyName === undefined,
      ),
  );
  if (
    !(
      exactFreezeImport &&
      ts.isCallExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === 'freezeSecurityValue' &&
      value.arguments.length === 1 &&
      ts.isIdentifier(value.arguments[0]) &&
      value.arguments[0].text === 'diagnostic'
    )
  ) {
    findings.push(
      `${rootDiagnosticDoor}: returned diagnostics must be frozen by the exact runtime witness`,
    );
  }
  return findings;
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
