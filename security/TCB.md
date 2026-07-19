# Kovo Security TCB Manifest

This manifest is the current A10/DEC-K substrate inventory for the security trusted computing
base. The compact finite-model proof harness for the `Secret`/`Untrusted` boxes, Kovo wire JSON,
and the typed `emitToWire` response choke lives in:

- `packages/core/src/secret.tcb-proof.test.ts`
- `packages/core/src/internal/wire-json.tcb-proof.test.ts`
- `scripts/tcb-proof-harness.test.ts`
- `packages/better-auth/src/internal.trusted-plaintext.test.ts`

Those tests enumerate the modeled JS coercion operations, JSON value shapes, poisoned-box depths,
`emitToWire` framework/raw response cases, and Better Auth request-reachable secret paths. They
prove the current runtime floor only: box non-coercibility, fixed redacted observation, wire-JSON
refusal for `Secret`/`Untrusted`, `emitToWire` refusal for typed framework response header egress,
and Better Auth non-egress for submitted credentials, request cookies, Set-Cookie forwarding, and
adapter `systemDb` stored-credential reads.

Entries classified as `tcb` count toward the size budget. Entries classified as
`delegating-wire-emitter`, `advisory-static-classifier`, or `inventory-classifier` are deliberately
listed so branded security-decision wrappers cannot appear without a manifest classification, but
they are not claimed as the verified TCB.

Per-entry ceilings are audit bands, not targets. When a security hardening pass adds validation to
an enrolled decision or enrolls a new decision, this manifest raises only the affected band and the
aggregate ceiling; `check:tcb-boundary` still fails on any unreviewed function or later span growth.

## Trusted dependency surfaces

The `trustedDependencySurfaces` section names the third-party dependency _behaviors_ that Kovo's
security guarantees rest on (plan `plans/threat-matrix-plan.md` M6). Kovo does not audit these
dependencies' internals; instead it pins them to an exact version and records which guarantee each
surface underpins so that any version bump touching the surface is a deliberate review trigger, not
a silent transitive change. Each surface records `{ dependency, packageJson, pinnedVersion,
guarantee, reviewTrigger }`.

This section is enforced by `check:tcb-boundary` (`scripts/check-tcb-boundary.mjs`): for every
surface the gate fails if the named `dependency` is not declared in `packageJson`, if its declared
specifier is not exactly `pinnedVersion` (a caret/range or a drifted pin fails), or if the structural
`pnpm-lock.yaml` package record does not match both `dependency@pinnedVersion` and the recorded
`resolution.integrity` sha512. What the gate does **not**
verify is the dependency's _actual runtime behavior_ (that node-pg really parameterizes, that
Postgres/PGlite really enforce RLS, that Better Auth/argon2 hashing parameters are sound) — that
review remains manual and is the point of the `reviewTrigger`. See `rules/dependency-policy.md`.

## Analysis-time closure and reproducible package subjects

`check:analysis-time-closure` discovers root and workspace check scripts plus the compiler entry
paths, walks their first-party static import graph, and derives the exact third-party roots. It then
closes those roots through the structural pnpm snapshot graph, including optional platform
packages, and requires an exact `name@version sha512-integrity` subject set below. Non-literal module
acquisitions are reviewed individually; the gate fails when one appears, disappears, or changes
without an exact manifest update. The size and entry budgets are monotone ratchets: an increase
requires one append-only marker binding the complete prior and next limits to a review record.

`check:publish` builds and packs under the declared deterministic environment, then canonicalizes
tar headers, gzip metadata, ownership, modes, mtimes, and bytewise path order. CI repeats that build
in two clean checkouts and compares the sha512 of every public tarball, retaining a
`kovo.reproducible-pack-attestation/v1` artifact with both build environments. This evidence binds
the package bytes produced by the enrolled toolchain; it does not establish runtime-host integrity
after publication or the behavioral correctness of the third-party tools themselves. Node, pnpm,
the operating system, and the checkout transport remain bootstrap/host inputs outside the pnpm-lock
subject closure; CI pins or records them in the attestation instead of claiming they were derived by
that closure.

```json tcb-manifest
{
  "schema": "kovo.security.tcb/v1",
  "source": "plans/fundamental-fixes-followup-3.md A10/DEC-K; plans/fundamental-fixes-followup-7.md DEC-A/DEC-C/DEC-D1; plans/fundamental-fixes-followup-7b.md DEC-A; plans/fundamental-fixes-followup-12.md DEC-D1",
  "budgets": {
    "entryMaxLines": 310,
    "totalTcbMaxLines": 2000
  },
  "securityRatchet": {
    "schema": "kovo.security.tcb-ratchet/v1",
    "limits": {
      "analysisClosureSize": 359,
      "entryCount": 134,
      "totalTcbMaxLines": 2000
    },
    "reviewedRaises": []
  },
  "analysisToolchain": [
    {
      "id": "analysis.typescript",
      "dependency": "typescript",
      "pinnedVersion": "6.0.3",
      "integrity": "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
      "role": "Compiler AST parsing, transforms, type checking, and security-gate source inspection.",
      "reviewTrigger": "Any TypeScript bump must re-run compiler analyzer/oracle, transform, diagnostic, and TCB-boundary mutation suites before merging."
    },
    {
      "id": "analysis.vite-plus",
      "dependency": "vite-plus",
      "pinnedVersion": "0.1.24",
      "integrity": "sha512-b3fr6WtCiEhetjuzW/4KcEMOAMuZxoxZATWaXKmPzOLf1upG+pzKJOFZTb94D6wiPBlwcjxoaUtF7C3uAN+VjQ==",
      "role": "Pinned task runner for build, test, typecheck, and conformance gate orchestration.",
      "reviewTrigger": "Any Vite+ bump must re-run the full check/build/publish task graph and re-confirm command dispatch and environment isolation."
    },
    {
      "id": "analysis.vitest",
      "dependency": "vitest",
      "pinnedVersion": "4.1.8",
      "integrity": "sha512-flY6ScbCIt9HThs+C5HS7jvGOB560DJtk/Z15IQROTA6zEy49Nh8T/dofWTQL+n3vswqn87sbJNiuqw1SDp5Ig==",
      "role": "Executable security proof, mutation, conformance, and regression harness.",
      "reviewTrigger": "Any Vitest bump must re-run gate mutation tests, isolation-sensitive suites, browser suites, and CI sharding evidence."
    },
    {
      "id": "analysis.esbuild",
      "dependency": "esbuild",
      "pinnedVersion": "0.28.1",
      "integrity": "sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==",
      "role": "CLI and starter build bundling used to produce executable framework artifacts.",
      "reviewTrigger": "Any esbuild bump must re-run CLI bundle, import-boundary, artifact-census, and reproducible-pack evidence."
    },
    {
      "id": "analysis.ts-morph",
      "dependency": "ts-morph",
      "pinnedVersion": "28.0.0",
      "integrity": "sha512-Wp3tnZ2bzwxyTZMtgWVzXDfm7lB1Drz+y9DmmYH/L702PQhPyVrp3pkou3yIz4qjS14GY9kcpmLiOOMvl8oG1g==",
      "role": "Drizzle schema extraction and source-model inspection used by the compile path.",
      "reviewTrigger": "Any ts-morph bump must re-run Drizzle extraction, schema identity, and compiler conformance suites."
    },
    {
      "id": "analysis.certificate-es-module-lexer",
      "dependency": "es-module-lexer",
      "pinnedVersion": "2.1.0",
      "integrity": "sha512-n27zTYMjYu1aj4MjCWzSP7G9r75utsaoc8m61weK+W8JMBGGQybd43GstCXZ3WNmSFtGT9wi59qQTW6mhTR5LQ==",
      "role": "Standalone certificate checker import and re-export extraction from exact published JavaScript bytes.",
      "reviewTrigger": "Any bump must re-run the certificate schema, three obligation-specific negative controls, lexical-authority audit, packed-package, and outside-process CLI verification."
    }
  ],
  "analysisDependencies": [
    {
      "id": "analysis.lucide-static",
      "dependency": "lucide-static",
      "pinnedVersion": "1.21.0",
      "integrity": "sha512-6248z2/4sEyKkYAPPUYxOPiB2RCfMmLdMHuoOhsTFnoD40ixAoHmTVhOPux8ADa1NTBmzpEKF7WNePm+Ms503Q==",
      "role": "Pinned icon-node corpus consumed by the generated icon package build.",
      "reviewTrigger": "Any bump must re-run icon generation, generated-file drift, package build, and reproducible-pack evidence."
    },
    {
      "id": "analysis.material-color-utilities",
      "dependency": "@material/material-color-utilities",
      "pinnedVersion": "0.3.0",
      "integrity": "sha512-ztmtTd6xwnuh2/xu+Vb01btgV8SQWYCaK56CkRK8gEkWe5TuDyBcYJ0wgkMRn+2VcE9KUmhvkz+N9GHrqw/C0g==",
      "role": "Static theme-token generation exercised by style and gallery conformance gates.",
      "reviewTrigger": "Any bump must re-run color derivation, generated-style, gallery, and package reproducibility evidence."
    },
    {
      "id": "analysis.model-context-protocol-sdk",
      "dependency": "@modelcontextprotocol/sdk",
      "pinnedVersion": "1.29.0",
      "integrity": "sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==",
      "role": "MCP schema and transport implementation loaded by CLI and devtool gate paths.",
      "reviewTrigger": "Any bump must re-run MCP schema, framing, stdio confinement, CLI, and devtool security suites."
    },
    {
      "id": "analysis.moo",
      "dependency": "moo",
      "pinnedVersion": "0.5.3",
      "integrity": "sha512-m2fmM2dDm7GZQsY7KK2cme8agi+AAljILjQnof7p1ZMDe6dQ4bdnSMx0cPppudoeNv5hEFQirN6u+O4fDE0IWA==",
      "role": "Lexer implementation loaded into the isolated SQL-parser VM by the security gate and runtime parser authority.",
      "reviewTrigger": "Any bump must re-run SQL parser isolation, write-classification, parser mutation, and reproducible-pack evidence."
    },
    {
      "id": "analysis.nearley",
      "dependency": "nearley",
      "pinnedVersion": "2.20.1",
      "integrity": "sha512-+Mc8UaAebFzgV+KpI5n7DasuuQCHA89dmwm7JXw3TV43ukfNQ9DnBH3Mdb2g/I4Fdxc26pwimBWvjIw0UAILSQ==",
      "role": "Parser runtime loaded into the isolated SQL-parser VM by the security gate and runtime parser authority.",
      "reviewTrigger": "Any bump must re-run SQL parser isolation, write-classification, parser mutation, and reproducible-pack evidence."
    }
  ],
  "analysisTimeClosure": {
    "schema": "kovo.security.analysis-time-closure/v1",
    "compileEntrypoints": [
      "packages/cli/src/commands/compile.ts",
      "packages/compiler/src/index.ts",
      "packages/drizzle/src/derive.ts"
    ],
    "roots": [
      "analysis.certificate-es-module-lexer",
      "analysis.esbuild",
      "analysis.lucide-static",
      "analysis.material-color-utilities",
      "analysis.model-context-protocol-sdk",
      "analysis.moo",
      "analysis.nearley",
      "analysis.ts-morph",
      "analysis.typescript",
      "analysis.vite-plus",
      "analysis.vitest",
      "dep.argon2.password-hashing",
      "dep.drizzle.sql-generation-parameterization",
      "dep.node-pg.query-parameterization",
      "dep.pglite.set-local-role-rls",
      "dep.pgsql-ast-parser.sql-boundary-classification",
      "dep.undici.egress-transport-dispatch"
    ],
    "dynamicAcquisitions": [
      {
        "id": "packages/browser/src/inline-loader.ts#import#import(/* @vite-ignore */ url)",
        "reason": "The browser runtime loads only the compiler-emitted, same-origin module URL after the inline-loader URL and Trusted Types gates validate it."
      },
      {
        "id": "packages/cli/src/artifact-provenance.ts#require.resolve#resolver.resolve(packageName)",
        "reason": "Artifact provenance resolves only package names from Kovo's finite first-party release inventory, then hashes their manifests and entry files."
      },
      {
        "id": "packages/cli/src/capability-closure-packages.ts#import.resolve#import.meta.resolve(specifier, parent)",
        "reason": "Capability closure resolves the statically extracted package specifier from the app import graph relative to its importer; the target is application dependency input."
      },
      {
        "id": "packages/cli/src/capability-closure-packages.ts#require.resolve#require.resolve(`${packageName}/package.json`)",
        "reason": "Capability closure resolves the package manifest for the statically extracted app dependency name before validating its exports."
      },
      {
        "id": "packages/cli/src/capability-closure-packages.ts#require.resolve#require.resolve(request)",
        "reason": "Capability closure resolves a normalized request derived from the statically extracted app package import; the target is application dependency input."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import( pathToFileURL(requireFromApp.resolve('@kovojs/server/internal/build')).href )",
        "reason": "The export path imports the fixed first-party server build export resolved from the app's installed Kovo server package."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import( pathToFileURL(requireFromApp.resolve('@kovojs/server/internal/data-plane-static-analysis')) .href )",
        "reason": "The export path imports the fixed first-party data-plane analyzer export resolved from the app's installed Kovo server package."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import( pathToFileURL(requireFromApp.resolve('@kovojs/server/internal/static-export')).href )",
        "reason": "The export path imports the fixed first-party static-export implementation resolved from the app's installed Kovo server package."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import( pathToFileURL(requireFromServer.resolve('@kovojs/compiler/internal/security-bootstrap')).href )",
        "reason": "The build path preloads the fixed first-party compiler security bootstrap resolved from the app's installed Kovo server package."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import(pathToFileURL(requireFromServer.resolve('@kovojs/compiler')).href)",
        "reason": "The build path imports the fixed first-party compiler entry resolved from the app's installed Kovo server package."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#import#import(pathToFileURL(resolvedAppModulePath).href)",
        "reason": "The build/export command imports the author-selected app entry after CLI path resolution; it is application input, not an undeclared third-party package edge."
      },
      {
        "id": "packages/cli/src/commands/build-export.ts#require.resolve#context.resolver.resolve(packageName)",
        "reason": "The source-root proof resolves only names from Kovo's finite first-party framework package inventory through a resolver captured before app evaluation."
      },
      {
        "id": "packages/cli/src/commands/db.ts#import#import(pathToFileURL(resolvedPath).href)",
        "reason": "The database command imports the author-selected schema module after CLI path resolution; it is application input, not an undeclared third-party package edge."
      },
      {
        "id": "packages/compiler/src/security-analyzer-soundness-oracle.ts#import#import(moduleUrl)",
        "reason": "The oracle imports its own freshly emitted temporary fixture URL to compare analyzer and runtime verdicts."
      },
      {
        "id": "packages/compiler/src/security-analyzer-soundness-oracle.ts#import#import(wrapperUrl)",
        "reason": "The oracle imports its own fixed wrapper fixture URL from the isolated temporary corpus."
      },
      {
        "id": "packages/compiler/src/vite-config-source.ts#import#import(sourceEntryUrl)",
        "reason": "The compile plugin imports the app-selected Vite config source entry; it is application input, not an undeclared third-party package edge."
      },
      {
        "id": "packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts#require#require(resolveDependencyRoot('pg'))",
        "reason": "The adversarial production-artifact test resolves the already enrolled pg root to copy a controlled dependency fixture."
      },
      {
        "id": "packages/server/src/egress-undici-runtime.ts#require#requireUndici(undiciPackageName)",
        "reason": "The egress runtime loads only the fixed enrolled undici package name through its captured module loader."
      },
      {
        "id": "scripts/check-spec-conformance-closure.mjs#import#import( pathToFileURL(path.join(root, 'packages/core/src/diagnostics.ts')).href )",
        "reason": "The conformance gate imports the fixed first-party diagnostics source path it has just validated."
      },
      {
        "id": "scripts/security-gate-mutations.mjs#import#import(`${pathToFileURL(mutantPath).href}?mutant=${Date.now()}`)",
        "reason": "The mutation harness imports a generated first-party gate mutant from its isolated temporary directory."
      },
      {
        "id": "scripts/security-gate-mutations.mjs#import#import(`${pathToFileURL(outputFile).href}?behavioral=${Date.now()}-${Math.random()}`)",
        "reason": "The behavioral mutation harness cache-busts a generated first-party mutant module in its isolated temporary directory."
      },
      {
        "id": "site/scripts/diagnostics-ref.mjs#import#import(CORE_DIAGNOSTICS_SOURCE.href)",
        "reason": "The docs gate imports the fixed repository diagnostics source URL used to derive the published diagnostic reference."
      }
    ],
    "maxPackageCount": 359,
    "subjects": [
      "@blazediff/core@1.9.1 sha512-ehg3jIkYKulZh+8om/O25vkvSsXXwC+skXmyA87FFx6A/45eqOkZsBltMw/TVteb0mloiGT8oGRTcjRAz66zaA==",
      "@electric-sql/pglite@0.5.1 sha512-h2Vc+qkQqsEL5kvyN5nBAxn3Vbyvka7QfDW7Io+CdcwU1+X8JbCAN2og+5dI11S3eJuDfroUCxzJaap6k+ezEw==",
      "@emnapi/core@1.10.0 sha512-yq6OkJ4p82CAfPl0u9mQebQHKPJkY7WrIuk205cTYnYe+k2Z8YBh11FrbRG/H6ihirqcacOgl2BIO8oyMQLeXw==",
      "@emnapi/runtime@1.10.0 sha512-ewvYlk86xUoGI0zQRNq/mC+16R1QeDlKQy21Ki3oSYXNgLb45GV1P6A0M+/s6nyCuNDqe5VpaY84BzXGwVbwFA==",
      "@emnapi/wasi-threads@1.2.1 sha512-uTII7OYF+/Mes/MrcIOYp5yOtSMLBWSIoLPpcgwipoiKbli6k322tcoFsxoIIxPDqW01SQGAgko4EzZi2BNv2w==",
      "@esbuild/aix-ppc64@0.28.1 sha512-Svl7tq8k/08+p6CXPpRjQ1fKX+1odH/BQbb48fV6fj3CWHhsoIOoY87w1oHXm0qEpkIK3ZfVgp0hed3XBXzXMQ==",
      "@esbuild/android-arm@0.28.1 sha512-0k2F129Xdio1TdJfzJ8sy1Q47vUD2NnwdhiAf7drUN1EBTfPf4hsFCtmMgu/6m8JSzsBrlmVjudMBQqOfG8usQ==",
      "@esbuild/android-arm64@0.28.1 sha512-34EGEbCIAgosYz6goLcopX6Mo7NyGv9tfwEM2/7Ce2VcVRk568iSvniGWcUXIy7wEDR1wzolcxcriFVrWYcwBg==",
      "@esbuild/android-x64@0.28.1 sha512-dbwY7ltSMDWsRatcRpCnES4F+im88OCUgGZjy52shC7GqHRE/cYlxNbB4Z4UpJswpcc4Qxd2oE/ufM0p61IKng==",
      "@esbuild/darwin-arm64@0.28.1 sha512-TZbWkQY7kvTAXbXUT7uVACR5cMHsDiSz9z7ZKAX/RTq/WJEk3QyRr0wZpNhBDX+/0CtdqUIJlOiodQcta6tY3Q==",
      "@esbuild/darwin-x64@0.28.1 sha512-zfdzgK9ACBNZLI/CyHTOx81SyNbM6YXn7rxSgX97VjyiPl9W1i4Ka4fgKECEoFCKGpvBj5qArWIGgQjOwkgskQ==",
      "@esbuild/freebsd-arm64@0.28.1 sha512-wG2EA8ENdEI0qhkSZMjfqrdY+ziCYCPMmtZjjIwOmXFjmyzEHn+UUxk5of+SYsjtfs3VpnlC7QLzSI5hY/rOAw==",
      "@esbuild/freebsd-x64@0.28.1 sha512-i7dZ9vQgnvSCzi/rYCXNgtF/U+eKZNJBzu3eTQbRgHnM7tNSizLOkRFAl3qzVc/Op/u5YkHHa4pf/3DOYHthLQ==",
      "@esbuild/linux-arm@0.28.1 sha512-qVXBOHQS+d5Y722GwJzJUtOLlX7km3CraOaGormF1pDtPd2C/l1SHRPgjLunLGe51Sh5YYWKMFDyV4SxgMQYTQ==",
      "@esbuild/linux-arm64@0.28.1 sha512-yHs+0uc8+nvEAfAfxrWQKK5peSNzBc4PegcMO0EJ2hT71uA7vB8Ihg2e77R2P7SG5uYjPbHlLLmve4LLLRCf0g==",
      "@esbuild/linux-ia32@0.28.1 sha512-d1z4ZuP0ajrfz/FhGT4vv278rX8KnPPJx8i5+AtK7TYbx9Le9F1hyzurZpkEyjkGa9dUGhQow4C1NmeGvqxN2w==",
      "@esbuild/linux-loong64@0.28.1 sha512-M5sRjUVZrkm1OAPR3dlOYzNmN+loZKGVi1VUQGrwuqLcbR6qeAz+famMhjASeH3YVKvZz+zT1jlh/keC3Rj/lg==",
      "@esbuild/linux-mips64el@0.28.1 sha512-mRObBZeHh2OxcBFPWE/FjylkRgZdYuiTR3vaTozquCGOH14iP9oN4x4Ge81CoIDYQrXmIxpFumJBu5MtZpnQJQ==",
      "@esbuild/linux-ppc64@0.28.1 sha512-slScBsMAb3GFDcdrCgLwZtPYRoH2H/youv10QiZyRjmsP48fznoveWytSgCI/R0ZcUgpc0ZhIUEx6LHts8yrfQ==",
      "@esbuild/linux-riscv64@0.28.1 sha512-kw0owk1o0GFETUJyW0jc0G4Yzs0BHZn0JDZ8JRT088vjJYX777BAs1fDGxAC+q831qOs2DTC96mNsG2opdfyyQ==",
      "@esbuild/linux-s390x@0.28.1 sha512-/lAIjX8aYFRByhh6L5rYtPEDRqa9de/4V/juOXcta5frjvzXO4/sqEtyytse0g3zZFuWu5cDN0MkLz2qRDD2Ag==",
      "@esbuild/linux-x64@0.28.1 sha512-u/anNYF2mmVOEDwLtnQ1wOr3EZ9sTNGLWrsYGYwHWzGA3Si84IOkHXlbWTD1NB+9/1lcnweYKO54uhxZydNzfA==",
      "@esbuild/netbsd-arm64@0.28.1 sha512-oks0DYbLwWMmaakTsCb+zL4E+aHRVLom9IJZOAthMQEPiQmydXHkziYEsGYRx0uNV/IjEKGAV941JzH02pflqw==",
      "@esbuild/netbsd-x64@0.28.1 sha512-aeL6lAnN89Hz43Mlh1G8ARasbuoYvSITDEx0tHh5b7jJnHcssqgjy9Yx430GDpmCa6OyrKoS0aNRjKundRizGg==",
      "@esbuild/openbsd-arm64@0.28.1 sha512-MEFJe5C3R8pwXdZ5Y21oo6m7ePiS0d9pWucn99O/wvyJZChoIQKrQDxKrGeW8F5+T0okTHesAmDeiHDTIq0V/Q==",
      "@esbuild/openbsd-x64@0.28.1 sha512-i/ZLIOafE0Z8cI/XANJAixoJL/uRAoS2xOA3rb0xN+KK0K177cMAsQYkzHtBrtMXAKuAc7HGgcWiZ/sRC1Nxgw==",
      "@esbuild/openharmony-arm64@0.28.1 sha512-ge+Z7EXFNt2BO1oAMsVpiQ8EwndV9i1xXerAeTIK7AtPs3bKFXQM7nlRxDSIUIMeueR1CNXxqztLzdNeReKBJg==",
      "@esbuild/sunos-x64@0.28.1 sha512-BEjgtECkL3vY+SaSQ6nzVfiALUeFxpawyp8Jmf5PtYhf1Ug40N1h/hxlhts+f1FvSvarEigdxS3BlSMI2PJLcQ==",
      "@esbuild/win32-arm64@0.28.1 sha512-lCv9eK/H6ZJWbE7bh2nw54CZ9M2nupBxJcTsdk/QQnWkdSjKGuxmmH8/GWrlT1eMmZfn4dGcCjRte397WqfQXA==",
      "@esbuild/win32-ia32@0.28.1 sha512-zvb/mB2bSCoJOpoCBgYKKpX6YM6mJBlBUVUtVj41DlZJVEB6/0CKlRYxP5wWl1C1ILiCoAU5wZZ4q1P3qeS6Eg==",
      "@esbuild/win32-x64@0.28.1 sha512-bm4Mowrv+GXMlpWX++EcXw/iLyd1o3+bJkC2DkWXYVvgZCqD/bSj9ctZeAMC3cIxgjRVR2Dufaiu4YPxr5gW1A==",
      "@hono/node-server@1.19.14 sha512-GwtvgtXxnWsucXvbQXkRgqksiH2Qed37H9xHZocE5sA3N8O8O8/8FA3uclQXxXVzc9XBZuEOMK7+r02FmSpHtw==",
      "@jridgewell/sourcemap-codec@1.5.5 sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "@material/material-color-utilities@0.3.0 sha512-ztmtTd6xwnuh2/xu+Vb01btgV8SQWYCaK56CkRK8gEkWe5TuDyBcYJ0wgkMRn+2VcE9KUmhvkz+N9GHrqw/C0g==",
      "@modelcontextprotocol/sdk@1.29.0 sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==",
      "@napi-rs/wasm-runtime@0.2.12 sha512-ZVWUcfwY4E/yPitQJl481FjFo3K22D6qF0DuFH6Y/nbnE11GY5uguDxZMGXPQ8WQ0128MXQD7TnfHyK4oWoIJQ==",
      "@napi-rs/wasm-runtime@1.1.5 sha512-AWPoBRJ9tsnVhor4sjO7rkni+7p+2IAEFj6cx06UgP10jkQHqay/36uRV/bFkgrh18D9vb4cr8Q0Pthskgzy+Q==",
      "@node-rs/argon2-android-arm-eabi@2.0.2 sha512-DV/H8p/jt40lrao5z5g6nM9dPNPGEHL+aK6Iy/og+dbL503Uj0AHLqj1Hk9aVUSCNnsDdUEKp4TVMi0YakDYKw==",
      "@node-rs/argon2-android-arm64@2.0.2 sha512-1LKwskau+8O1ktKx7TbK7jx1oMOMt4YEXZOdSNIar1TQKxm6isZ0cRXgHLibPHEcNHgYRsJWDE9zvDGBB17QDg==",
      "@node-rs/argon2-darwin-arm64@2.0.2 sha512-3TTNL/7wbcpNju5YcqUrCgXnXUSbD7ogeAKatzBVHsbpjZQbNb1NDxDjqqrWoTt6XL3z9mJUMGwbAk7zQltHtA==",
      "@node-rs/argon2-darwin-x64@2.0.2 sha512-vNPfkLj5Ij5111UTiYuwgxMqE7DRbOS2y58O2DIySzSHbcnu+nipmRKg+P0doRq6eKIJStyBK8dQi5Ic8pFyDw==",
      "@node-rs/argon2-freebsd-x64@2.0.2 sha512-M8vQZk01qojQfCqQU0/O1j1a4zPPrz93zc9fSINY7Q/6RhQRBCYwDw7ltDCZXg5JRGlSaeS8cUXWyhPGar3cGg==",
      "@node-rs/argon2-linux-arm-gnueabihf@2.0.2 sha512-7EmmEPHLzcu0G2GDh30L6G48CH38roFC2dqlQJmtRCxs6no3tTE/pvgBGatTp/o2n2oyOJcfmgndVFcUpwMnww==",
      "@node-rs/argon2-linux-arm64-gnu@2.0.2 sha512-6lsYh3Ftbk+HAIZ7wNuRF4SZDtxtFTfK+HYFAQQyW7Ig3LHqasqwfUKRXVSV5tJ+xTnxjqgKzvZSUJCAyIfHew==",
      "@node-rs/argon2-linux-arm64-musl@2.0.2 sha512-p3YqVMNT/4DNR67tIHTYGbedYmXxW9QlFmF39SkXyEbGQwpgSf6pH457/fyXBIYznTU/smnG9EH+C1uzT5j4hA==",
      "@node-rs/argon2-linux-x64-gnu@2.0.2 sha512-ZM3jrHuJ0dKOhvA80gKJqBpBRmTJTFSo2+xVZR+phQcbAKRlDMSZMFDiKbSTnctkfwNFtjgDdh5g1vaEV04AvA==",
      "@node-rs/argon2-linux-x64-musl@2.0.2 sha512-of5uPqk7oCRF/44a89YlWTEfjsftPywyTULwuFDKyD8QtVZoonrJR6ZWvfFE/6jBT68S0okAkAzzMEdBVWdxWw==",
      "@node-rs/argon2-wasm32-wasi@2.0.2 sha512-U3PzLYKSQYzTERstgtHLd4ZTkOF9co57zTXT77r0cVUsleGZOrd6ut7rHzeWwoJSiHOVxxa0OhG1JVQeB7lLoQ==",
      "@node-rs/argon2-win32-arm64-msvc@2.0.2 sha512-Eisd7/NM0m23ijrGr6xI2iMocdOuyl6gO27gfMfya4C5BODbUSP7ljKJ7LrA0teqZMdYHesRDzx36Js++/vhiQ==",
      "@node-rs/argon2-win32-ia32-msvc@2.0.2 sha512-GsE2ezwAYwh72f9gIjbGTZOf4HxEksb5M2eCaj+Y5rGYVwAdt7C12Q2e9H5LRYxWcFvLH4m4jiSZpQQ4upnPAQ==",
      "@node-rs/argon2-win32-x64-msvc@2.0.2 sha512-cJxWXanH4Ew9CfuZ4IAEiafpOBCe97bzoKowHCGk5lG/7kR4WF/eknnBlHW9m8q7t10mKq75kruPLtbSDqgRTw==",
      "@node-rs/argon2@2.0.2 sha512-t64wIsPEtNd4aUPuTAyeL2ubxATCBGmeluaKXEMAFk/8w6AJIVVkeLKMBpgLW6LU2t5cQxT+env/c6jxbtTQBg==",
      "@oxc-project/runtime@0.133.0 sha512-PkvjA1Lq5++V5S1E6Patr92ZVcieE6EalDr1VJTqv4BnjZdOUC4W3p8k1wMXSd5/2aFP4b/A6N5sg2Bkzcr9vQ==",
      "@oxc-project/types@0.133.0 sha512-KzkdCd6Uxqnf6l3HOw1xfatAlUURA0g14cvBYFyJ5SaNOQbOUvBr9PKArcPcrNIeRsBdgcUzOGrhKveVpvOIGA==",
      "@oxfmt/binding-android-arm-eabi@0.52.0 sha512-17EMSJnQ9g+upVHrAUYDMfH5lvRKQ9Nvg8WtEoH72oDr1VpWz+7/o3tD97U1EToen2YAQ/68JmtDYkQUi20dfQ==",
      "@oxfmt/binding-android-arm64@0.52.0 sha512-A2G1IdwGEW2lLJkIxcvuirRH1CzSl/e0NX11zTlW1gvxJThfwbI/BEoaKrTNpm7M2FchvIf6guvIQU7d5iz+OQ==",
      "@oxfmt/binding-darwin-arm64@0.52.0 sha512-f9+bLvOYxy7NttCLFTvQ7afmqDOWY4wIP9xdvfj5trQ1qj6f2UFAGwZESlfsMjvJNTyRpXfIlOanCI9FOvoeQA==",
      "@oxfmt/binding-darwin-x64@0.52.0 sha512-YSTB9sJ5nnQd/Q0ddHkgof0ZCHPAnWZT1IW2SJ8omz7CP7KluJhO1fNHrpqdxCtpztJwSs4hY1uAee35wKxxaw==",
      "@oxfmt/binding-freebsd-x64@0.52.0 sha512-NIrRNTTPCs4UbmVs0bxLSCDlLCtIRMJIXklNKaXa5Oj2/K1UIMBvgE8+uPVo01Io3N9HF0+GAX+aAHjUgZS7vA==",
      "@oxfmt/binding-linux-arm-gnueabihf@0.52.0 sha512-JXUCde8mn3GpgQouz2PXUokgy/uT1QrRJBL2s983VWcSQp62wTFYiNXgTKdeo1Jgbr0IgUnKKvzIk/YBlj/nVQ==",
      "@oxfmt/binding-linux-arm-musleabihf@0.52.0 sha512-psbUXaRZ+V8DaXz10Qf7LSHtdtdKAmC8fxXgeU608jjzrmWK4quamZMOpl6sf+dikoFHA85uE93Q0BqxrCdQrQ==",
      "@oxfmt/binding-linux-arm64-gnu@0.52.0 sha512-Jw7MgWUU9lcLCcy82updISP3EthTlfvAwR6gWNxPzqly7+fLvOi2gHQE9xXQjpqaVLm/8P+gOzlv9ODuoVlaaw==",
      "@oxfmt/binding-linux-arm64-musl@0.52.0 sha512-wZg6bLjDvh2KibyI3QFUYo8GTXneIFsd0JvehtvJiUmQ8WRPERgxd/VM4ctWb86U5FT1FkqgS8/wZKVB+AZScg==",
      "@oxfmt/binding-linux-ppc64-gnu@0.52.0 sha512-IngE8uxhNvxcMrLjZNDo9xNLY7rEK33AKnaMd2B46he1e/mz2CfcW6If/U1wUjdRZddm1QzQaciqZkuMkdh1FA==",
      "@oxfmt/binding-linux-riscv64-gnu@0.52.0 sha512-H3+DdFMv/efN3Efmhsv18jDrpiWWqKG7wsfAlQBqAt6z/E2Bx+TwEj2Nowe51CPOWB8/mFBC2dAMSgVFLvvowA==",
      "@oxfmt/binding-linux-riscv64-musl@0.52.0 sha512-zji+1kb7lJKohSDjzC1IsS+K/cKRs1hdVf0ZH0VbdbiakmtLvN9twBoXo/k8VdjFax7kfo+DyPxS7vv52br1aw==",
      "@oxfmt/binding-linux-s390x-gnu@0.52.0 sha512-hcLBYedpCy7ToUvvBidWk7+11Yhg1oAZ4+6hKPic/mQI6NaqXJSXMps5nFlwUuX2ewhtLZZDPg63TI042qGKBg==",
      "@oxfmt/binding-linux-x64-gnu@0.52.0 sha512-IDO2loXK2OtTOhSPchU9MW25mWL2QCDGdJbjN8MXKZVS80qXe5gMTwQWu/gMJ3juoBHbkuUZNB2N1LHzNT7DoA==",
      "@oxfmt/binding-linux-x64-musl@0.52.0 sha512-mAV2Hjn0SatJ+KoAzKUC3eJhdJ8wv+3m1KyuS0dTsbF0c5weq+QrCt/DRZZM+uj/XiKzCDEUKYsBF30e2qkcyw==",
      "@oxfmt/binding-openharmony-arm64@0.52.0 sha512-vd4npaUIwChxp7XzkqmepBWTT9YMcSe/NBApVGPC30/lLyOVaV3dvma1SKo03t8O73BPRAG7EyJzGlN5cJM5hQ==",
      "@oxfmt/binding-win32-arm64-msvc@0.52.0 sha512-k2sz6gWQdMfh5HPpIS+Bw/0UEV/kaK2xuqJRrWL233sEHx9WLlsmvlPFM4HUNThkYbSN0U0vPW7LVKZWDS8hPQ==",
      "@oxfmt/binding-win32-ia32-msvc@0.52.0 sha512-rhke69GTcArodLHpjMTfNnvjTEBryDeZcUCKK/VjXDMtfTULl6QRh0ymX5/hbCUv2WjYm9h/QbW++q2vE15gWQ==",
      "@oxfmt/binding-win32-x64-msvc@0.52.0 sha512-q5xL7oeXkZdEtNZWBdvehJcmt+GRu9l2bK40yJs1jJXlqq+r0Hygb1rTjq+FM2o/2xyt4cufH6KRplHp3Jjsvw==",
      "@oxlint-tsgolint/darwin-arm64@0.23.0 sha512-gOs9PVr2wEg4ox9z0aJo+RKhhImW86YL5N6yav8BK/rgPsIrwN/igSZ+pbRr723NFvUNKde9fgMhRA6JrXAOZw==",
      "@oxlint-tsgolint/darwin-x64@0.23.0 sha512-kjJ8B+7n4tB9VJdxS5A9GdJt6/bYpzbu4lXp2uO1S3sRmCB5gDEABlGoiePNApRWaW+xqL4b4xgiE727jSLhuA==",
      "@oxlint-tsgolint/linux-arm64@0.23.0 sha512-6dCZuKNu135seMXilkRk9SpCx6i1XgmiipYGalLij5WVRX6ZYS8c4xI7preN/zv9fCXhsQclTIMDu2Y/cytTjw==",
      "@oxlint-tsgolint/linux-x64@0.23.0 sha512-3bdilnyA7kmSTjK27rvjIjSxL5SIg3wt7vwNiRkouWB83ytssyKnuGvxSYJxgMEmFpSutzaBzcCUM2jDtPGcgA==",
      "@oxlint-tsgolint/win32-arm64@0.23.0 sha512-j+OEp44SVYiQ+ZD+uttsX7u6L9SvmbbQ77SO1pSFCcJlsVMeCk8qZsjhKfGKuT/jIA+ipOJMVs/+pqUfObBWNw==",
      "@oxlint-tsgolint/win32-x64@0.23.0 sha512-5MyjFuqf+g8OUPJBSGWHJtmoWnzFJYyOg4To9WMQshZYEWig/vtu7JtJ03VWnzHv9LJkAUeApY0gVCOywFR/iQ==",
      "@oxlint/binding-android-arm-eabi@1.67.0 sha512-VrSi571rDv1N8HaEDM+DEX8nmT0y9jJo8tzzW13vsOWTx59xQczCIJx68n2zWOXRT5YKZsOZXp4qkHN/10x4mw==",
      "@oxlint/binding-android-arm64@1.67.0 sha512-l6+NdYxMoRohix5r5bbigW16LPicceCwGcQ6LKKuE1kUdjgFfQolJjrJsQYPFetIs78Gxj/G/f5TEGoTCwj9nQ==",
      "@oxlint/binding-darwin-arm64@1.67.0 sha512-jOzXxS1AxFxhImLIRbtGIMrEwaXcgMw3gR57WB1cRk8ai+vpr6726kxXqVvlNsrXtJ/FrmOm8RxlC0m8SW24Qg==",
      "@oxlint/binding-darwin-x64@1.67.0 sha512-3DFAVY94OqjIZHXIPz37yGRSWwOFTAqChQ64/M69GYLawzP0KiwdhDNfqdKKYT0bTR/DNxmMnQsj3ns+8+X/Lg==",
      "@oxlint/binding-freebsd-x64@1.67.0 sha512-e4dDKZuLu8TR9DEBssWSDahlPgZBwojTTHZUvnjBRJfJJbpxYCjfjKfi0Z1+CSLMiJBwI2yCDtRM1XJQaARjmg==",
      "@oxlint/binding-linux-arm-gnueabihf@1.67.0 sha512-BKytFdcQzbITV3xlnzDUDTEDtbUMCCiC4EaNTDZ4FyT8gdNvBC4gfiLucXp/sQl0XU3p7syTlorUWVVVBZab2g==",
      "@oxlint/binding-linux-arm-musleabihf@1.67.0 sha512-XYAv0esBDX7BpTzRDjVX2Vdj+zndd8ll2dFQiaeQ6zTZr7A8GRDTN7fH3FP3jU+O0vCDx85oH/EtG7BzPgAXuw==",
      "@oxlint/binding-linux-arm64-gnu@1.67.0 sha512-zizRMjA0i6u/2B0evgda04iycu+MoNuf1pBy6Eh+1CjC5wMEG7qN5zdDKTCvFc0KSYSDM9QTG3gjZHirgtQuKg==",
      "@oxlint/binding-linux-arm64-musl@1.67.0 sha512-zB/Tf6sUjmmvvbva9Gj3JTJ8rJ9t4I8/U0o6vSRtd0DRIsIuyegBwJAzhSUFQHdMijIRJkW0exs/yBhpw2S20w==",
      "@oxlint/binding-linux-ppc64-gnu@1.67.0 sha512-kgU40Gt74CK0TCsF51KZymkIwN9U0BajKsMijB52zPqOeZU9NAHkA/NSQkZDHEaCakx42DxhXkODiAqf2b4Gug==",
      "@oxlint/binding-linux-riscv64-gnu@1.67.0 sha512-tOYhkk/iaG9aD3FvGpBFd1Lrw0x0RaVoJBxjUkfNzS50rC5NS5BteNCwgr8A2zCdADrIIoze6D7u6U5Ic++/iQ==",
      "@oxlint/binding-linux-riscv64-musl@1.67.0 sha512-sEtywrPb+0b+tHYl1SDCrw903fiC4eyKoNqzP3v+f2JT3Xcv4NEYG+P8rj+eEnX7IWhqV/xj8/JmcmVj21CXaA==",
      "@oxlint/binding-linux-s390x-gnu@1.67.0 sha512-BvR8Moa0zCLxroOx4vZaZN9nUfwAUpSTwjZdxZyKy4bv3PrzrXrxKR/ZQ0L9wNSvlPhnMJeZfa3q5w6ZCTuN6Q==",
      "@oxlint/binding-linux-x64-gnu@1.67.0 sha512-mm2cxM6fksOpq6l0uFws8BUGKAR4dNa/cZCn37Npq7PFbhD5HDJqWfnoIvTaeRKMy5XdS2tO0MA0qbHDrnXAAA==",
      "@oxlint/binding-linux-x64-musl@1.67.0 sha512-WmbMuLapKyDlobMkXAaAL0Y+Uczh4LETfIfQsUpbId4Ip8Ai82/jqeYTOoUCkuuhBFapgqP253+d83tLKOksJg==",
      "@oxlint/binding-openharmony-arm64@1.67.0 sha512-9g/PqxYJelzzTAOR5Y+RiRqdeydhEuXv2KxNeFcAKQ7UsvnWSY1OP4MsuPMbTO2Pf70tz7mFhl1j13H3fyh+8g==",
      "@oxlint/binding-win32-arm64-msvc@1.67.0 sha512-2VhwE6Gatb0vJGnN0TBuQMbKCOiZlSQ/zJvVWYLK4a9d4iDiJOen/yVQkGpmsJ90MuH66fzi0kEKI0jRQMDxGA==",
      "@oxlint/binding-win32-ia32-msvc@1.67.0 sha512-EQ3VExXfeM1InbE5+JjufhZZTWy+kHUwgt3yZR7gQ47Je/mE0WspQPan0OJznh493L5anM210YNJtH1PXjTSFg==",
      "@oxlint/binding-win32-x64-msvc@1.67.0 sha512-bw24y+/1MHS4QDkons3YyHkPT9uCMoLHHgQhb+mb8NOjTYwub1CZ+K9Ngr8aO5DMrDrkqHwTzlTwFP2vS8Y/ZQ==",
      "@oxlint/plugins@1.61.0 sha512-nkOyZEF1vH527CkdQtOp1HMrVFEM4ResURvI2JFeGoup+h+43J/k/FgdOR9b9Isxg+Yae7qVDa7y3nssE8b3TQ==",
      "@polka/url@1.0.0-next.29 sha512-wwQAWhWSuHaag8c4q/KN/vCoeOJYshAIvMQwD4GpSb3OiZklFfvAgmj0VCBBImRpuF/aFgIRzllXlVX93Jevww==",
      "@rolldown/binding-android-arm64@1.0.3 sha512-454rs7jHngixp/NMxd5srYD57OnzSlZ/eFTETjORQHLwJG1lRtmNOJcBerZlfu4GjKqeq8aCCIQrMdHyhI51Hw==",
      "@rolldown/binding-darwin-arm64@1.0.3 sha512-PcAhP+ynjURNyy8SKGl5DQP94aGuB/7JrXJb/t7P+hanXvQVMWzUvRRhBAcg/lNRadBhoUPqSoP4xw5tR/KBEA==",
      "@rolldown/binding-darwin-x64@1.0.3 sha512-9YpfeUvSE2RS7wysJ81uOZkXJz7f7Q55H2Gvp3VEw/EsahqDtrphrZ0EwDLK5vvKOzaCrBsjF8JmnMLcUt78Gg==",
      "@rolldown/binding-freebsd-x64@1.0.3 sha512-yB1IlAsSNHncV6SCTL27/MVGR5htvQsoGxIv5KMGXALp+Ll1wYsn+x98M9MW7qa+NdSbvrrY7ANI4wLJ0n1e6g==",
      "@rolldown/binding-linux-arm-gnueabihf@1.0.3 sha512-Yi30IVAAfLUCy2MseFjbB1jAMDl1VMCAas5StnYp8da9+CKvMd2H2cbEjWcw5NPaPqzvYkVIaF1nNUG+b7u/sw==",
      "@rolldown/binding-linux-arm64-gnu@1.0.3 sha512-jsO7R8To+AdlYgUmN5sHSCZbfhtMBkO0WUx8iORQnPcMMdgr7qM2DQmMwgabs3GhNztdmoKkMKQFHD6DTMCIQw==",
      "@rolldown/binding-linux-arm64-musl@1.0.3 sha512-VWkUHwWriDciit80wleYwKILoR/KMvxh/IdwS/paX+ZgpuRpCrKLUdadJbc0NpBEiyhpYawsJ73j9aCvOH+f7Q==",
      "@rolldown/binding-linux-ppc64-gnu@1.0.3 sha512-5f1laC0SlIR0yDbFCd8acUhvJIag6N3zC5P7oUPN6wX0aOma+uKJ0wBDH5aq7I1PVI2ttTlhJwzwRIBnLiSGEg==",
      "@rolldown/binding-linux-s390x-gnu@1.0.3 sha512-Iq4ko0r4XsgbrF/LunNgHtAGLRRVE2kXonAXQ/MV0mC6jQpMOhW1SvtZja2EhC/kd05++bP78dsqBeIQyYJ6Yg==",
      "@rolldown/binding-linux-x64-gnu@1.0.3 sha512-B8m6tD5+/N5FeNQFbKlLA/2yVq9ycQP1SeedyEYYKWBNR3ZQbkvIUcNnDNM03lO1l5F2roiiFJGgvoLLyZXtSg==",
      "@rolldown/binding-linux-x64-musl@1.0.3 sha512-pSdpdUJHkuCxun9LE7jvgUB9qsRgaiyNNCX7m/AvHTcq67AiT/Yhoxvw5zPfhrM8k/BfP8ce/hMOpthKDpEUow==",
      "@rolldown/binding-openharmony-arm64@1.0.3 sha512-OXXS3RKJgX2uLwM+gYyuH5omcH8fL1LJs96pZGgtetVCahON57+d4SJHzTgZiOjxgGkSnpXpOsWuPDGAKAigEg==",
      "@rolldown/binding-wasm32-wasi@1.0.3 sha512-JTtb8BWFynicNSoPrehsCzBtOKjZ6jhMiPFEmOiuXg1Fl8dn2KHQob+GuPSGR0dryQa1PQJbzjF3dqO/whhjLg==",
      "@rolldown/binding-win32-arm64-msvc@1.0.3 sha512-gEdFFEN70A/jxb2svrWsN3aDL7OUtmvlOy+6fa2jxG8K0wQ1ZbdeLGnidov6Yu5/733dI5ySfzFlQ/cb0bSz1g==",
      "@rolldown/binding-win32-x64-msvc@1.0.3 sha512-eXB7CHuaQdqmJcc3koCNtNPmT/bj2gc999kUFgBxG8Ac0NdgXc4rkCHhqrgrhN3zddvvvrgzj1e90SuSfmyIXA==",
      "@rolldown/pluginutils@1.0.1 sha512-2j9bGt5Jh8hj+vPtgzPtl72j0yRxHAyumoo6TNfAjsLB04UtpSvPbPcDcBMxz7n+9CYB0c1GxQFxYRg2jimqGw==",
      "@standard-schema/spec@1.1.0 sha512-l2aFy5jALhniG5HgqrD6jXLi/rUWrKvqN/qJx6yoJsgKhblVd+iqqU4RCXavm/jPityDo5TCvKMnpjKnOriy0w==",
      "@ts-morph/common@0.29.0 sha512-35oUmphHbJvQ/+UTwFNme/t2p3FoKiGJ5auTjjpNTop2dyREspirjMy82PLSC1pnDJ8ah1GU98hwpVt64YXQsg==",
      "@tybys/wasm-util@0.10.2 sha512-RoBvJ2X0wuKlWFIjrwffGw1IqZHKQqzIchKaadZZfnNpsAYp2mM0h36JtPCjNDAHGgYez/15uMBpfGwchhiMgg==",
      "@types/better-sqlite3@7.6.13 sha512-NMv9ASNARoKksWtsq/SHakpYAYnhBrQgGD8zkLYk/jaK8jUGn08CfEdTRgYhMypUQAfzSP8W6gNLe0q19/t4VA==",
      "@types/chai@5.2.3 sha512-Mw558oeA9fFbv65/y4mHtXDs9bPnFMZAL/jxdPFUpOHHIXX91mcgEHbS5Lahr+pwZFR8A7GQleRWeI6cGFC2UA==",
      "@types/deep-eql@4.0.2 sha512-c9h9dVVMigMPc4bwTvC5dxqtqJZwQPePsWjPlpSOnojbor6pGqdk541lfA7AqFQr5pB1BRdq0juY9db81BwyFw==",
      "@types/estree@1.0.9 sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
      "@types/node@25.9.2 sha512-G05zqtJhcDLb8uslf5EjCxXg9G1KQxiV8OS0R26IC//Eoyitzqe8z37I7cqvnZlrlSfgocQRfSn/AHBZJJFyGw==",
      "@types/pg@8.20.0 sha512-bEPFOaMAHTEP1EzpvHTbmwR8UsFyHSKsRisLIHVMXnpNefSbGA1bD6CVy+qKjGSqmZqNqBDV2azOBo8TgkcVow==",
      "@vitest/browser-playwright@4.1.8 sha512-SR7FqgegaexEg73xvf3ArtygXegagMdXnL0EZMpxrWvvhQxvicD/E8p0ib0J91riPRtQUViyh67Xjw3NqvyhVg==",
      "@vitest/browser@4.1.8 sha512-u21VzX07HzlJYpFgkxmjEXar/tG2UqWGgyGG/46SrrPc7rSdCTPw5vuowopO9CIqF8UCUQzDFdbVnNpw6N0BfQ==",
      "@vitest/expect@4.1.8 sha512-h3nDO677RDLEGlBxyQ5CW8RlMThSKSRLUePLOx09gNIWRL40edgA1GCZSZgf1W55MFAG6/Sw14KeaAnqv0NKdQ==",
      "@vitest/mocker@4.1.8 sha512-LEiN/xe4OSIbKe9HQIp5OC24agGD9J5CnmMgsLohVVoOPWL9a2sBoR6VBx43jQZb7Kr1l4RCuyCJzcAa0+dojw==",
      "@vitest/pretty-format@4.1.8 sha512-9GasEBxpZ1VYIpqHf/0+YGg121uSNwCKOJqIrTwWP/TB7DmFCiaBpNl3aPZzoLWfWkuqhbH8vJIVobZkvdo2cA==",
      "@vitest/runner@4.1.8 sha512-EmVxeBAfMJvycdjd6Hm+RbFBbA9fKvo0Kx37hNpBYoYeavH3RNsBXWDooR1mgD52dCrxIIuP7UotpfiwOikvcg==",
      "@vitest/snapshot@4.1.8 sha512-acfZboRmAIf05DEKcBQy33VXojFJjtUdLyo7oOmV9kebb2xdU01UknNiPuPZoJZQyO7DF0gZdTGTpeAzET9QPQ==",
      "@vitest/spy@4.1.8 sha512-6EevtBp6OZOPF7bmz36HrGMeP3txgVSrgebWxHOafDXGkhIzfXK14f8KF6MuFfgXXUeHxmpD3BQxkV00/3s5mA==",
      "@vitest/utils@4.1.8 sha512-uOJamYALNhfJ6iolExyQM40yIQwDqYnkKtQ5VCiSe17E33H0aQ/u+1GlRuz4LZBk6Mm3sg90G9hEbmEt37C1Zg==",
      "@voidzero-dev/vite-plus-core@0.1.24 sha512-iXPGBABnQnrDMx89H6MOCGcTZp+QW+3rY4YMVKdE6ydchSvPk2O3MI2vgaRVfOtWJ2IjnxSnf1n2yjP67ZBRFQ==",
      "@voidzero-dev/vite-plus-darwin-arm64@0.1.24 sha512-Hpo9W9piSFlEsJzGkwzfDXhJGrnYByxHXF7NVQZ7g+SLOprddtlfTeM8t+gq9dxcuq0RzM8ddMAhDQP/K3fZQA==",
      "@voidzero-dev/vite-plus-darwin-x64@0.1.24 sha512-SwnnnZrEFBiU5iKlh/CZAVwn0RFt/Udrvt3kFLtdRxMtN5bKaqTFVA2H8Y/FPCWp1QX9bs4V9ZIAeXAk06zLkw==",
      "@voidzero-dev/vite-plus-linux-arm64-gnu@0.1.24 sha512-ImM3eqDki4DpRuHjW6dEh4St8zvbcfOMR7KQZJX42ArriCLQ/QdaYhDRRbcDi27XsOBqRxm2eqUUEymPrYIHpA==",
      "@voidzero-dev/vite-plus-linux-arm64-musl@0.1.24 sha512-gj4mzbob/ls8Zs7iTuF9Gr0EFFF7tdpDiPxDPBkH8tJP5OkHABlzWUwJhU+9xxcUbTaXqpHDw68Mil7jm5dpMg==",
      "@voidzero-dev/vite-plus-linux-x64-gnu@0.1.24 sha512-x7IYK7lI+WuF1n3jSzEYU6FgJxPX/R0rDmTTsOutooGGCU7uShZvfZqIoiTXK0eFnJU5ij5BfBgenenUfsaT/A==",
      "@voidzero-dev/vite-plus-linux-x64-musl@0.1.24 sha512-JCy2w0eSVUlWQlggK5T47MnL+j0o4EY7hLskINVI8gi+aixQF4xnYBDobz0lbxkqz3/IfiLyXUx6TcU3thcsGQ==",
      "@voidzero-dev/vite-plus-test@0.1.24 sha512-9NiG6UadG0iOaPL1AMsO5sDKkx6MADHw4/mMOmHWZUhhUwqzfVtnnptMK37vD71e6KyR7yAscx19FrtOWWtjvA==",
      "@voidzero-dev/vite-plus-win32-arm64-msvc@0.1.24 sha512-G+/lhLKVjyn3FmgXX8jeWgq7RcE5O1kdR7QyFayQOdlMX/ZRkvUwQD7bFaqhKzgJM6Oj3a1FH3HQPYk5QOYuCQ==",
      "@voidzero-dev/vite-plus-win32-x64-msvc@0.1.24 sha512-b0e5XohEV1w/RdzAtv8/Hm6tvHPXouPtBNsljjW/lDJZq3NCLND5s6lqe8H4IenrgmKSoqakHWtlqJqM36cFbw==",
      "accepts@2.0.0 sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==",
      "ajv-formats@3.0.1 sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==",
      "ajv@8.20.0 sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==",
      "assertion-error@2.0.1 sha512-Izi8RQcffqCeNVgFigKli1ssklIbpHnCYc6AknXGYoB6grJqyeby7jv12JUQgmTAnIDnbck1uxksT4dzN3PWBA==",
      "balanced-match@4.0.4 sha512-BLrgEcRTwX2o6gGxGOCNyMvGSp35YofuYzw9h1IMTRmKqttAZZVU67bdb9Pr2vUHA8+j3i2tJfjO6C6+4myGTA==",
      "base64-js@1.5.1 sha512-AKpaYlHn8t4SVbOHCy+b5+KKgvR4vrsD8vbvrbiQJps7fKDTkjkDry6ji0rUJjC0kzbNePLwzxq8iypo41qeWA==",
      "better-sqlite3@12.11.1 sha512-dq9AtApgg5PGFtBzPFSBl3HZQjHok5gaQCM6zh2Yk0aSmDCs1CbnVI8/HgASQkNKsWFpseIO9beg5xxpYhbIfA==",
      "bindings@1.5.0 sha512-p2q/t/mhvuOj/UeLlV6566GD/guowlr0hHxClI0W9m7MWYkL1F0hLo+0Aexs9HSPCtR1SXQ0TD3MMKrXZajbiQ==",
      "bl@4.1.0 sha512-1W07cM9gS6DcLperZfFSj+bWLtaPGSOHWhPiGzXmvVJbRLdG82sH/Kn8EtW1VqWVA54AKf2h5k5BbnIbwF3h6w==",
      "body-parser@2.2.2 sha512-oP5VkATKlNwcgvxi0vM0p/D3n2C3EReYVX+DNYs5TjZFn/oQt2j+4sVJtSMr18pdRr8wjTcBl6LoV+FUwzPmNA==",
      "brace-expansion@5.0.6 sha512-kLpxurY4Z4r9sgMsyG0Z9uzsBlgiU/EFKhj/h91/8yHu0edo7XuixOIH3VcJ8kkxs6/jPzoI6U9Vj3WqbMQ94g==",
      "buffer@5.7.1 sha512-EHcyIPBQ4BSGlvjB16k5KgAJ27CIsHY/2JBmCRReo48y9rQ3MaUzWX3KVlBa4U7MyX02HdVj0K7C3WaB3ju7FQ==",
      "bytes@3.1.2 sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg==",
      "call-bind-apply-helpers@1.0.2 sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==",
      "call-bound@1.0.4 sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==",
      "chai@6.2.2 sha512-NUPRluOfOiTKBKvWPtSD4PhFvWCqOi0BGStNWs57X9js7XGTprSmFoz5F0tWhR4WPjNeR9jXqdC7/UpSJTnlRg==",
      "chownr@1.1.4 sha512-jJ0bqzaylmJtVnNgzTeSOs8DPavpbYgEr/b0YL8/2GO3xJEhInFmhKMUnEJQjZumK7KXGFhUy89PrsJWlakBVg==",
      "code-block-writer@13.0.3 sha512-Oofo0pq3IKnsFtuHqSF7TqBfr71aeyZDVJ0HpmqB7FBM2qEigL0iPONSCZSO9pE9dZTAxANe5XHG9Uy0YMv8cg==",
      "commander@2.20.3 sha512-GpVkmM8vF2vQUkj2LvZmD35JxeJOLCwJ9cUkugyk2nuhbv3+mJvpLYYt+0+USMxE+oj+ey/lJEnhZw75x/OMcQ==",
      "content-disposition@1.1.0 sha512-5jRCH9Z/+DRP7rkvY83B+yGIGX96OYdJmzngqnw2SBSxqCFPd0w2km3s5iawpGX8krnwSGmF0FW5Nhr0Hfai3g==",
      "content-type@1.0.5 sha512-nTjqfcBFEipKdXCv4YDQWCfmcLZKm81ldF0pAopTvyrFGVbcR6P/VAAd5G7N+0tTr8QqiU0tFadD6FK4NtJwOA==",
      "content-type@2.0.0 sha512-j/O/d7GcZCyNl7/hwZAb606rzqkyvaDctLmckbxLzHvFBzTJHuGEdodATcP3yIRoDrLHkIATJuvzbFlp/ki2cQ==",
      "convert-source-map@2.0.0 sha512-Kvp459HrV2FEJ1CAsi1Ku+MY3kasH19TFykTz2xWmMeq6bk2NU3XXvfJ+Q61m0xktWwt+1HSYf3JZsTms3aRJg==",
      "cookie-signature@1.2.2 sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==",
      "cookie@0.7.2 sha512-yki5XnKuf750l50uGTllt6kKILY4nQ1eNIQatoXEByZ5dWgnKqbnqmTrBE5B4N7lrMJKQ2ytWMiTO2o0v6Ew/w==",
      "cors@2.8.6 sha512-tJtZBBHA6vjIAaF6EnIaq6laBBP9aq/Y3ouVJjEfoHbRBcHBAHYcMh/w8LDrk2PvIMMq8gmopa5D4V8RmbrxGw==",
      "cross-spawn@7.0.6 sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
      "debug@4.4.3 sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "decompress-response@6.0.0 sha512-aW35yZM6Bb/4oJlZncMH2LCoZtJXTRxES17vE3hoRiowU2kWHaJKFkSBDnDR+cm9J+9QhXmREyIfv0pji9ejCQ==",
      "deep-extend@0.6.0 sha512-LOHxIOaPYdHlJRtCQfDIVZtfw/ufM8+rVj649RIHzcm/vGwQRXFt6OPqIFWsm2XEMrNIEtWR64sY1LEKD2vAOA==",
      "depd@2.0.0 sha512-g7nH6P6dyDioJogAAGprGpCtVImJhpPk/roCzdb3fIh61/s/nPsfR6onyMwkCAR/OlC3yBC0lESvUoQEAssIrw==",
      "detect-libc@2.1.2 sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
      "discontinuous-range@1.0.0 sha512-c68LpLbO+7kP/b1Hr1qs8/BJ09F5khZGTxqxZuhzxpmwJKOgRFHJWIb9/KmqnqHhLdO55aOxFH/EGBvUQbL/RQ==",
      "drizzle-orm@1.0.0-rc.4 sha512-BT+pf+qoiYHqltoA88Jmf6ilGMXPlpfE0hEJKc2adRtMCAl25Swk/t5gXcWxZNAwdtf3F5gCd2FpeOyP/pT0Hw==",
      "dunder-proto@1.0.1 sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==",
      "ee-first@1.1.1 sha512-WMwm9LhRUo+WUaRN+vRuETqG89IgZphVSNkdFgeb6sS/E4OrDIN7t48CAewSHXc6C8lefD8KKfr5vY61brQlow==",
      "encodeurl@2.0.0 sha512-Q0n9HRi4m6JuGIV1eFlmvJB7ZEVxu93IrMyiMsGC0lrMJMWzRgx6WGquyfQgZVb31vhGgXnfmPNNXmxnOkRBrg==",
      "end-of-stream@1.4.5 sha512-ooEGc6HP26xXq/N+GCGOT0JKCLDGrq2bQUZrQ7gyrJiZANJ/8YDTxTpQBXGMn+WbIQXNVpyWymm7KYVICQnyOg==",
      "es-define-property@1.0.1 sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==",
      "es-errors@1.3.0 sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
      "es-module-lexer@1.7.0 sha512-jEQoCwk8hyb2AZziIOLhDqpm5+2ww5uIE6lkO/6jcOCusfk6LhMHpXXfBLXTZ7Ydyt0j4VoUQv6uGNYbdW+kBA==",
      "es-module-lexer@2.1.0 sha512-n27zTYMjYu1aj4MjCWzSP7G9r75utsaoc8m61weK+W8JMBGGQybd43GstCXZ3WNmSFtGT9wi59qQTW6mhTR5LQ==",
      "es-object-atoms@1.1.2 sha512-HWcBoN6NileqtSydK2FqHbS/LoDd2pqrnQHLyJzBj4kOp/ky2MWMN694xOfkK8/SnUsW2DH7EfyVlydKCsm1Zw==",
      "esbuild@0.28.1 sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==",
      "escape-html@1.0.3 sha512-NiSupZ4OeuGwr68lGIeym/ksIZMJodUGOSCZ/FSnTxcrekbvqrgdUxlJOMpijaKZVjAJrWrGs/6Jy8OMuyj9ow==",
      "estree-walker@3.0.3 sha512-7RUKfXgSMMkzt6ZuXmqapOurLGPPfgj6l9uRZ7lRGolvk0y2yocc35LdcxKC5PQZdn2DMqioAQ2NoWcrTKmm6g==",
      "etag@1.8.1 sha512-aIL5Fx7mawVa300al2BnEE4iNvo1qETxLrPI/o05L7z6go7fCw1J6EQmbK4FmJ2AS7kgVF/KEZWufBfdClMcPg==",
      "eventsource-parser@3.1.0 sha512-kJezFj9YFAMLeORyi7aCLxLbD5/qWMQnoMVlVPyHIll7lgRJCc3JVln9Vgl9nwQi0YkMnhdGTMNn7CkRRAptMg==",
      "eventsource@3.0.7 sha512-CRT1WTyuQoD771GW56XEZFQ/ZoSfWid1alKGDYMmkt2yl8UXrVR4pspqWNEcqKvVIzg6PAltWjxcSSPrboA4iA==",
      "expand-template@2.0.3 sha512-XYfuKMvj4O35f/pOXLObndIRvyQ+/+6AhODh+OKWj9S9498pHHn/IMszH+gt0fBCRWMNfk1ZSp5x3AifmnI2vg==",
      "expect-type@1.3.0 sha512-knvyeauYhqjOYvQ66MznSMs83wmHrCycNEN6Ao+2AeYEfxUIkuiVxdEa1qlGEPK+We3n0THiDciYSsCcgW/DoA==",
      "express-rate-limit@8.5.2 sha512-5Kb34ipNX694DH48vN9irak1Qx30nb0PLYHXfJgw4YEjiC3ZEmZJhwOp+VfiCYwFzvFTdB9QkArYS5kXa2cx2A==",
      "express@5.2.1 sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==",
      "fast-deep-equal@3.1.3 sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
      "fast-uri@3.1.2 sha512-rVjf7ArG3LTk+FS6Yw81V1DLuZl1bRbNrev6Tmd/9RaroeeRRJhAt7jg/6YFxbvAQXUCavSoZhPPj6oOx+5KjQ==",
      "fdir@6.5.0 sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "file-uri-to-path@1.0.0 sha512-0Zt+s3L7Vf1biwWZ29aARiVYLx7iMGnEUl9x33fbB/j3jR81u/O2LbqK+Bm1CDSNDKVtJ/YjwY7TUd5SkeLQLw==",
      "finalhandler@2.1.1 sha512-S8KoZgRZN+a5rNwqTxlZZePjT/4cnm0ROV70LedRHZ0p8u9fRID0hJUZQpkKLzro8LfmC8sx23bY6tVNxv8pQA==",
      "forwarded@0.2.0 sha512-buRG0fpBtRHSTCOASe6hD258tEubFoRLb4ZNA6NxMVHNw2gOcwHo9wyablzMzOA5z9xA9L1KNjk/Nt6MT9aYow==",
      "fresh@2.0.0 sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==",
      "fs-constants@1.0.0 sha512-y6OAwoSIf7FyjMIv94u+b5rdheZEjzR63GTyZJm5qh4Bi+2YgwLCcI/fPFZkL5PSixOt6ZNKm+w+Hfp/Bciwow==",
      "fsevents@2.3.2 sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==",
      "fsevents@2.3.3 sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "function-bind@1.1.2 sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
      "get-intrinsic@1.3.0 sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==",
      "get-proto@1.0.1 sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==",
      "github-from-package@0.0.0 sha512-SyHy3T1v2NUXn29OsWdxmK6RwHD+vkj3v8en8AOBZ1wBQ/hCAQ5bAQTD02kW4W9tUp/3Qh6J8r9EvntiyCmOOw==",
      "gopd@1.2.0 sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==",
      "has-symbols@1.1.0 sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==",
      "hasown@2.0.4 sha512-T2UbfbBEF32wiepXIsMlTW9+dDYC6wMh/t/vYA4tuOMKqWz/n3vr1NFSxQiyP+zk2mXsoMA/i/7qV6LKut1t1A==",
      "hono@4.12.25 sha512-2NFaIyNVgJmBs/ecmtGzlmluTFs5cHEWGTdu0t1HBwYzoGXOL5nUQBRMXsXWla5i4KkG//QMzVP88m1+I3fdAQ==",
      "http-errors@2.0.1 sha512-4FbRdAX+bSdmo4AUFuS0WNiPz8NgFt+r8ThgNWmlrjQjt1Q7ZR9+zTlce2859x4KSXrwIsaeTqDoKQmtP8pLmQ==",
      "iconv-lite@0.7.2 sha512-im9DjEDQ55s9fL4EYzOAv0yMqmMBSZp6G0VvFyTMPKWxiSBHUj9NW/qqLmXUwXrrM7AvqSlTCfvqRb0cM8yYqw==",
      "ieee754@1.2.1 sha512-dcyqhDvX1C46lXZcVqCpK+FtMRQVdIMN6/Df5js2zouUsqG7I6sFxitIC+7KYK29KdXOLHdu9zL4sFnoVQnqaA==",
      "inherits@2.0.4 sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "ini@1.3.8 sha512-JV/yugV2uzW5iMRSiZAyDtQd+nxtUnjeLt0acNdw98kKLrvuRVyB80tsREOE7yvGVgalhZ6RNXCmEHkUKBKxew==",
      "ip-address@10.2.0 sha512-/+S6j4E9AHvW9SWMSEY9Xfy66O5PWvVEJ08O0y5JGyEKQpojb0K0GKpz/v5HJ/G0vi3D2sjGK78119oXZeE0qA==",
      "ipaddr.js@1.9.1 sha512-0KI/607xoxSToH7GjN1FfSbLoU0+btTicjsQSWQlh/hZykN8KpmMf7uYwPW3R+akZ6R/w18ZlXSHBYXiYUPO3g==",
      "is-promise@4.0.0 sha512-hvpoI6korhJMnej285dSg6nu1+e6uxs7zG3BYAm5byqDsgJNWwxzM6z6iZiAgQR4TJ30JmBTOwqZUw3WlyH3AQ==",
      "isexe@2.0.0 sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
      "jiti@2.7.0 sha512-AC/7JofJvZGrrneWNaEnJeOLUx+JlGt7tNa0wZiRPT4MY1wmfKjt2+6O2p2uz2+skll8OZZmJMNqeke7kKbNgQ==",
      "jose@6.2.3 sha512-YYVDInQKFJfR/xa3ojUTl8c2KoTwiL1R5Wg9YCydwH0x0B9grbzlg5HC7mMjCtUJjbQ/YnGEZIhI5tCgfTb4Hw==",
      "json-schema-traverse@1.0.0 sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==",
      "json-schema-typed@8.0.2 sha512-fQhoXdcvc3V28x7C7BMs4P5+kNlgUURe2jmUT1T//oBRMDrqy1QPelJimwZGo7Hg9VPV3EQV5Bnq4hbFy2vetA==",
      "lightningcss-android-arm64@1.32.0 sha512-YK7/ClTt4kAK0vo6w3X+Pnm0D2cf2vPHbhOXdoNti1Ga0al1P4TBZhwjATvjNwLEBCnKvjJc2jQgHXH0NEwlAg==",
      "lightningcss-darwin-arm64@1.32.0 sha512-RzeG9Ju5bag2Bv1/lwlVJvBE3q6TtXskdZLLCyfg5pt+HLz9BqlICO7LZM7VHNTTn/5PRhHFBSjk5lc4cmscPQ==",
      "lightningcss-darwin-x64@1.32.0 sha512-U+QsBp2m/s2wqpUYT/6wnlagdZbtZdndSmut/NJqlCcMLTWp5muCrID+K5UJ6jqD2BFshejCYXniPDbNh73V8w==",
      "lightningcss-freebsd-x64@1.32.0 sha512-JCTigedEksZk3tHTTthnMdVfGf61Fky8Ji2E4YjUTEQX14xiy/lTzXnu1vwiZe3bYe0q+SpsSH/CTeDXK6WHig==",
      "lightningcss-linux-arm-gnueabihf@1.32.0 sha512-x6rnnpRa2GL0zQOkt6rts3YDPzduLpWvwAF6EMhXFVZXD4tPrBkEFqzGowzCsIWsPjqSK+tyNEODUBXeeVHSkw==",
      "lightningcss-linux-arm64-gnu@1.32.0 sha512-0nnMyoyOLRJXfbMOilaSRcLH3Jw5z9HDNGfT/gwCPgaDjnx0i8w7vBzFLFR1f6CMLKF8gVbebmkUN3fa/kQJpQ==",
      "lightningcss-linux-arm64-musl@1.32.0 sha512-UpQkoenr4UJEzgVIYpI80lDFvRmPVg6oqboNHfoH4CQIfNA+HOrZ7Mo7KZP02dC6LjghPQJeBsvXhJod/wnIBg==",
      "lightningcss-linux-x64-gnu@1.32.0 sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA==",
      "lightningcss-linux-x64-musl@1.32.0 sha512-bYcLp+Vb0awsiXg/80uCRezCYHNg1/l3mt0gzHnWV9XP1W5sKa5/TCdGWaR/zBM2PeF/HbsQv/j2URNOiVuxWg==",
      "lightningcss-win32-arm64-msvc@1.32.0 sha512-8SbC8BR40pS6baCM8sbtYDSwEVQd4JlFTOlaD3gWGHfThTcABnNDBda6eTZeqbofalIJhFx0qKzgHJmcPTnGdw==",
      "lightningcss-win32-x64-msvc@1.32.0 sha512-Amq9B/SoZYdDi1kFrojnoqPLxYhQ4Wo5XiL8EVJrVsB8ARoC1PWW6VGtT0WKCemjy8aC+louJnjS7U18x3b06Q==",
      "lightningcss@1.32.0 sha512-NXYBzinNrblfraPGyrbPoD19C1h9lfI/1mzgWYvXUTe414Gz/X1FD2XBZSZM7rRTrMA8JL3OtAaGifrIKhQ5yQ==",
      "lucide-static@1.21.0 sha512-6248z2/4sEyKkYAPPUYxOPiB2RCfMmLdMHuoOhsTFnoD40ixAoHmTVhOPux8ADa1NTBmzpEKF7WNePm+Ms503Q==",
      "magic-string@0.30.21 sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
      "math-intrinsics@1.1.0 sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
      "media-typer@1.1.0 sha512-aisnrDP4GNe06UcKFnV5bfMNPBUw4jsLGaWwWfnH3v02GnBuXX2MCVn5RbrWo0j3pczUilYblq7fQ7Nw2t5XKw==",
      "merge-descriptors@2.0.0 sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==",
      "mime-db@1.54.0 sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==",
      "mime-types@3.0.2 sha512-Lbgzdk0h4juoQ9fCKXW4by0UJqj+nOOrI9MJ1sSj4nI8aI2eo1qmvQEie4VD1glsS250n15LsWsYtCugiStS5A==",
      "mimic-response@3.1.0 sha512-z0yWI+4FDrrweS8Zmt4Ej5HdJmky15+L2e6Wgn3+iK5fWzb6T3fhNFq2+MeTRb064c6Wr4N/wv0DzQTjNzHNGQ==",
      "minimatch@10.2.5 sha512-MULkVLfKGYDFYejP07QOurDLLQpcjk7Fw+7jXS2R2czRQzR56yHRveU5NDJEOviH+hETZKSkIk5c+T23GjFUMg==",
      "minimist@1.2.8 sha512-2yyAR8qBkN3YuheJanUpWC5U3bb5osDywNB8RzDVlDwDHbocAJveqqj1u8+SVD7jkWT4yvsHCpWqqWqAxb0zCA==",
      "mkdirp-classic@0.5.3 sha512-gKLcREMhtuZRwRAfqP3RFW+TK4JqApVBtOIftVgjuABpAtpxhPGaDcfvbhNvD0B8iD1oUr/txX35NjcaY6Ns/A==",
      "moo@0.5.3 sha512-m2fmM2dDm7GZQsY7KK2cme8agi+AAljILjQnof7p1ZMDe6dQ4bdnSMx0cPppudoeNv5hEFQirN6u+O4fDE0IWA==",
      "mrmime@2.0.1 sha512-Y3wQdFg2Va6etvQ5I82yUhGdsKrcYox6p7FfL1LbK2J4V01F9TGlepTIhnK24t7koZibmg82KGglhA1XK5IsLQ==",
      "ms@2.1.3 sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "nanoid@3.3.12 sha512-ZB9RH/39qpq5Vu6Y+NmUaFhQR6pp+M2Xt76XBnEwDaGcVAqhlvxrl3B2bKS5D3NH3QR76v3aSrKaF/Kiy7lEtQ==",
      "napi-build-utils@2.0.0 sha512-GEbrYkbfF7MoNaoh2iGG84Mnf/WZfB0GdGEsM8wz7Expx/LlWf5U8t9nvJKXSp3qr5IsEbK04cBGhol/KwOsWA==",
      "nearley@2.20.1 sha512-+Mc8UaAebFzgV+KpI5n7DasuuQCHA89dmwm7JXw3TV43ukfNQ9DnBH3Mdb2g/I4Fdxc26pwimBWvjIw0UAILSQ==",
      "negotiator@1.0.0 sha512-8Ofs/AUQh8MaEcrlq5xOX0CQ9ypTF5dl78mjlMNfOK08fzpgTHQRQPBxcPlEtIw0yRpws+Zo/3r+5WRby7u3Gg==",
      "node-abi@3.92.0 sha512-KdHvFWZjEKDf0cakgFjebl371GPsISX2oZHcuyKqM7DtogIsHrqKeLTo8wBHxaXRAQlY2PsPlZmfo+9ZCxEREQ==",
      "object-assign@4.1.1 sha512-rJgTQnkUnH1sFw8yT6VSU3zD3sWmu6sZhIseY8VX+GRu3P6F7Fu+JNDoXfklElbLJSnc3FUQHVe4cU5hj+BcUg==",
      "object-inspect@1.13.4 sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==",
      "obug@2.1.2 sha512-AWGB9WFcRXOQs48Z/udjI5ZcZMHXwX8XPByNpOydgcGsDLIzjGizhoMWJyKAWze7AVW/2W1i+/gPX4YtKe5cyg==",
      "on-finished@2.4.1 sha512-oVlzkg3ENAhCk2zdv7IJwd/QUD4z2RxRwpkcGY8psCVcCYZNq4wYnVWALHM+brtuJjePWiYF/ClmuDr8Ch5+kg==",
      "once@1.4.0 sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==",
      "oxfmt@0.52.0 sha512-nJlYM35F64zTDMecCNhoHNkf+D/eHv7xcjj9XDSj+bFAVtN93m7v8DQMdHd6nDG6Akf/kEYYHmDUBs2Dz27Sug==",
      "oxlint-tsgolint@0.23.0 sha512-3mBv3CoPbh8dFbzfDGIWa2ytZjn2v+3EX4aKRXjIhsoGFzG8GCjfRirz3rwZf1wYbZzsNLTSgpw8VjQuWdp/jA==",
      "oxlint@1.67.0 sha512-blwwaHPdoH8piQ5/z0KHeoHFR7FZgl12WluKJfu4qFLPkZl6mK04PkLE45Fw1NxfBRSlh40Gu7MkxHUw++ociQ==",
      "parseurl@1.3.3 sha512-CiyeOxFT/JZyN5m0z9PfXw4SCBJ6Sygz1Dpl0wqjlhDEGGBP1GnsUVEL0p63hoG1fcj3fHynXi9NYO4nWOL+qQ==",
      "path-browserify@1.0.1 sha512-b7uo2UCUOYZcnF/3ID0lulOJi/bafxa1xPe7ZPsammBSpjSWQkjNxlt635YGS2MiR9GjvuXCtz2emr3jbsz98g==",
      "path-key@3.1.1 sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
      "path-to-regexp@8.4.2 sha512-qRcuIdP69NPm4qbACK+aDogI5CBDMi1jKe0ry5rSQJz8JVLsC7jV8XpiJjGRLLol3N+R5ihGYcrPLTno6pAdBA==",
      "pathe@2.0.3 sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
      "pg-cloudflare@1.4.0 sha512-Vo7z/6rrQYxpNRylp4Tlob2elzbh+N/MOQbxFVWCxS7oEx6jF53GTJFxK2WWpKuBRkmiin4Mt+xofFDjx09R0A==",
      "pg-connection-string@2.14.0 sha512-XwWDGcLRGCXAR8F/AM5bG7Q+A3Wm2s6QeEjlOKZLlH3UYcguiqCWKyWXVag5TLTIjR7oOJUY8kcADaZgWPyLeg==",
      "pg-int8@1.0.1 sha512-WCtabS6t3c8SkpDBUlb1kjOs7l66xsGdKpIPZsg4wR+B3+u9UAum2odSsF9tnvxg80h4ZxLWMy4pRjOsFIqQpw==",
      "pg-pool@3.14.0 sha512-gKtPkFdQPU3DksooVLi9LsjZxrsBUZIpa+7aVx+LV5pNh0KzP4Zleud2po+ConrxbuXGBJ6Hfer6hdgpIBpBaw==",
      "pg-protocol@1.15.0 sha512-cq9sECI5s0+uPUXjbz8ioyPJni6RzsRib0US67i5IoTZKw8fNeYlVE7u8F4dG7vEJJtc5wdD1K189lCCUwqWTQ==",
      "pg-types@2.2.0 sha512-qTAAlrEsl8s4OiEQY69wDvcMIdQN6wdz5ojQiOy6YRMuynxenON0O5oCpJI6lshc6scgAY8qvJ2On/p+CXY0GA==",
      "pg@8.22.0 sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==",
      "pgpass@1.0.5 sha512-FdW9r/jQZhSeohs1Z3sI1yxFQNFvMcnmfuj4WBMUTxOrAyLMaTcE1aAMBiTlbMNaXvBCQuVi0R7hd8udDSP7ug==",
      "pgsql-ast-parser@12.0.2 sha512-1WWa96Sw6h4uv9GLw98EzH/+xoBTC8j2TwV/AMW3E+Ir/fHOu/jLLbj6kPiz3y2bGISTKNYvKWwHoqvQ5FLuAw==",
      "picocolors@1.1.1 sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "picomatch@4.0.4 sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==",
      "pixelmatch@7.2.0 sha512-xhcb4yHu9sM/G7foGzoLtXYcC0zHEaOXXjRKhGup0fw78Nf2Tkiapv4EQyMzrbcmQPsllAI7DbFY2UT7PlI9Pg==",
      "pkce-challenge@5.0.1 sha512-wQ0b/W4Fr01qtpHlqSqspcj3EhBvimsdh0KlHhH8HRZnMsEa0ea2fTULOXOS9ccQr3om+GcGRk4e+isrZWV8qQ==",
      "playwright-core@1.60.0 sha512-9bW6zvX/m0lEbgTKJ6YppOKx8H3VOPBMOCFh2irXFOT4BbHgrx5hPjwJYLT40Lu+4qtD36qKc/Hn56StUW57IA==",
      "playwright@1.60.0 sha512-hheHdokM8cdqCb0lcE3s+zT4t4W+vvjpGxsZlDnikarzx8tSzMebh3UiFtgqwFwnTnjYQcsyMF8ei2mCO/tpeA==",
      "pngjs@7.0.0 sha512-LKWqWJRhstyYo9pGvgor/ivk2w94eSjE3RGVuzLGlr3NmD8bf7RcYGze1mNdEHRP6TRP6rMuDHk5t44hnTRyow==",
      "postcss@8.5.15 sha512-FfR8sjd4em2T6fb3I2MwAJU7HWVMr9zba+enmQeeWFfCbm+UOC/0X4DS8XtpUTMwWMGbjKYP7xjfNekzyGmB3A==",
      "postgres-array@2.0.0 sha512-VpZrUqU5A69eQyW2c5CA1jtLecCsN2U/bD6VilrFDWq5+5UIEVO7nazS3TEcHf1zuPYO/sqGvUvW62g86RXZuA==",
      "postgres-bytea@1.0.1 sha512-5+5HqXnsZPE65IJZSMkZtURARZelel2oXUEO8rH83VS/hxH5vv1uHquPg5wZs8yMAfdv971IU+kcPUczi7NVBQ==",
      "postgres-date@1.0.7 sha512-suDmjLVQg78nMK2UZ454hAG+OAW+HQPZ6n++TNDUX+L0+uUlLywnoxJKDou51Zm+zTCjrCl0Nq6J9C5hP9vK/Q==",
      "postgres-interval@1.2.0 sha512-9ZhXKM/rw350N1ovuWHbGxnGh/SNJ4cnxHiM0rxE4VN41wsg8P8zWn9hv/buK00RP4WvlOyr/RBDiptyxVbkZQ==",
      "prebuild-install@7.1.3 sha512-8Mf2cbV7x1cXPUILADGI3wuhfqWvtiLA1iclTDbFRZkgRQS0NqsPZphna9V+HyTEadheuPmjaJMsbzKQFOzLug==",
      "proxy-addr@2.0.7 sha512-llQsMLSUDUPT44jdrU/O37qlnifitDP+ZwrmmZcoSKyLKvtZxpyV0n2/bD/N4tBAAZ/gJEdZU7KMraoK1+XYAg==",
      "pump@3.0.4 sha512-VS7sjc6KR7e1ukRFhQSY5LM2uBWAUPiOPa/A3mkKmiMwSmRFUITt0xuj+/lesgnCv+dPIEYlkzrcyXgquIHMcA==",
      "qs@6.15.2 sha512-Rzq0KEyX/w/tEybncDgdkZrJgVUsUMk3xjh3t5bv3S1HTAtg+uOYt72+ZfwiQwKdysThkTBdL/rTi6HDmX9Ddw==",
      "railroad-diagrams@1.0.0 sha512-cz93DjNeLY0idrCNOH6PviZGRN9GJhsdm9hpn1YCS879fj4W+x5IFJhhkRZcwVgMmFF7R82UA/7Oh+R8lLZg6A==",
      "randexp@0.4.6 sha512-80WNmd9DA0tmZrw9qQa62GPPWfuXJknrmVmLcxvq4uZBdYqb1wYoKTmnlGUchvVWe0XiLupYkBoXVOxz3C8DYQ==",
      "range-parser@1.2.1 sha512-Hrgsx+orqoygnmhFbKaHE6c296J+HTAQXoxEF6gNupROmmGJRoyzfG3ccAveqCBrwr/2yxQ5BVd/GTl5agOwSg==",
      "raw-body@3.0.2 sha512-K5zQjDllxWkf7Z5xJdV0/B0WTNqx6vxG70zJE4N0kBs4LovmEYWJzQGxC9bS9RAKu3bgM40lrd5zoLJ12MQ5BA==",
      "rc@1.2.8 sha512-y3bGgqKj3QBdxLbLkomlohkvsA8gdAiUQlSBJnBhfn+BPxg4bc62d8TcBW15wavDfgexCgccckhcZvywyQYPOw==",
      "readable-stream@3.6.2 sha512-9u/sniCrY3D5WdsERHzHE4G2YCXqoG5FTHUiCC4SIbr6XcLZBY05ya9EKjYek9O5xOAwjGq+1JdGBAS7Q9ScoA==",
      "require-from-string@2.0.2 sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==",
      "ret@0.1.15 sha512-TTlYpa+OL+vMMNG24xSlQGEJ3B/RzEfUlLct7b5G/ytav+wPrplCpVMFuwzXbkecJrb6IYo1iFb0S9v37754mg==",
      "rolldown@1.0.3 sha512-i00lAJ2ks1BYr7rjNjKC7BcqAS7nVfiT3QX1SI5aY+AFHblCmaUf9OE9dbdzDvW6dJxbi2ZCZiy9v3CcwOiX3g==",
      "router@2.2.0 sha512-nLTrUKm2UyiL7rlhapu/Zl45FwNgkZGaCpZbIHajDYgwlJCOzLSk+cIPAnsEqV955GjILJnKbdQC1nVPz+gAYQ==",
      "safe-buffer@5.2.1 sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
      "safer-buffer@2.1.2 sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "semver@7.8.5 sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
      "send@1.2.1 sha512-1gnZf7DFcoIcajTjTwjwuDjzuz4PPcY2StKPlsGAQ1+YH20IRVrBaXSWmdjowTJ6u8Rc01PoYOGHXfP1mYcZNQ==",
      "serve-static@2.2.1 sha512-xRXBn0pPqQTVQiC8wyQrKs2MOlX24zQ0POGaj0kultvoOCstBQM5yvOhAVSUwOMjQtTvsPWoNCHfPGwaaQJhTw==",
      "setprototypeof@1.2.0 sha512-E5LDX7Wrp85Kil5bhZv46j8jOeboKq5JMmYM3gVGdGH8xFpPWXUMsNrlODCrkoxMEeNi/XZIwuRvY4XNwYMJpw==",
      "shebang-command@2.0.0 sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "shebang-regex@3.0.0 sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "side-channel-list@1.0.1 sha512-mjn/0bi/oUURjc5Xl7IaWi/OJJJumuoJFQJfDDyO46+hBWsfaVM65TBHq2eoZBhzl9EchxOijpkbRC8SVBQU0w==",
      "side-channel-map@1.0.1 sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==",
      "side-channel-weakmap@1.0.2 sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==",
      "side-channel@1.1.1 sha512-6x6dK6zJdpTzF4sQeNYxwtvBzf6Eg4GtlesS94HOvTudUeyK2WXAaIfmDgsyslYrRBeFIlsi54AYsFGUuhmvrQ==",
      "siginfo@2.0.0 sha512-ybx0WO1/8bSBLEWXZvEd7gMW3Sn3JFlW3TvX1nREbDLRNQNaeNN8WK0meBwPdAaOI7TtRRRJn/Es1zhrrCHu7g==",
      "simple-concat@1.0.1 sha512-cSFtAPtRhljv69IK0hTVZQ+OfE9nePi/rtJmw5UjHeVyVroEqJXP1sFztKUy1qU+xvz3u/sfYJLa947b7nAN2Q==",
      "simple-get@4.0.1 sha512-brv7p5WgH0jmQJr1ZDDfKDOSeWWg+OVypG99A/5vYGPqJ6pxiaHLy8nxtFjBA7oMa01ebA9gfh1uMCFqOuXxvA==",
      "sirv@3.0.2 sha512-2wcC/oGxHis/BoHkkPwldgiPSYcpZK3JU28WoMVv55yHJgcZ8rlXvuG9iZggz+sU1d4bRgIGASwyWqjxu3FM0g==",
      "source-map-js@1.2.1 sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "split2@4.2.0 sha512-UcjcJOWknrNkF6PLX83qcHM6KHgVKNkV62Y8a5uYDVv9ydGQVwAHMKqHdJje1VTWpljG0WYpCDhrCdAOYH4TWg==",
      "stackback@0.0.2 sha512-1XMJE5fQo1jGH6Y/7ebnwPOBEkIEnT4QF32d5R1+VXdXveM0IBMJt8zfaxX1P3QhVwrYe+576+jkANtSS2mBbw==",
      "statuses@2.0.2 sha512-DvEy55V3DB7uknRo+4iOGT5fP1slR8wQohVdknigZPMpMstaKJQWhwiYBACJE3Ul2pTnATihhBYnRhZQHGBiRw==",
      "std-env@4.1.0 sha512-Rq7ybcX2RuC55r9oaPVEW7/xu3tj8u4GeBYHBWCychFtzMIr86A7e3PPEBPT37sHStKX3+TiX/Fr/ACmJLVlLQ==",
      "string_decoder@1.3.0 sha512-hkRX8U1WjJFd8LsDJ2yQ/wWWxaopEsABU1XfkM8A+j0+85JAGppt16cr1Whg6KIbb4okU6Mql6BOj+uup/wKeA==",
      "strip-json-comments@2.0.1 sha512-4gB8na07fecVVkOI6Rs4e7T6NOTki5EmL7TUduTs6bu3EdnSycntVJ4re8kgZA+wx9IueI2Y11bfbgwtzuE0KQ==",
      "tar-fs@2.1.4 sha512-mDAjwmZdh7LTT6pNleZ05Yt65HC3E+NiQzl672vQG38jIrehtJk/J3mNwIg+vShQPcLF/LV7CMnDW6vjj6sfYQ==",
      "tar-stream@2.2.0 sha512-ujeqbceABgwMZxEJnk2HDY2DlnUZ+9oEcb1KzTVfYHio0UE6dG71n60d8D2I4qNvleWrrXpmjpt7vZeF1LnMZQ==",
      "tinybench@2.9.0 sha512-0+DUvqWMValLmha6lr4kD8iAMK1HzV0/aKnCtWb9v9641TnP/MFb7Pc2bxoxQjTXAErryXVgUOfv2YqNllqGeg==",
      "tinyexec@1.2.4 sha512-SHf/r48b7vOrjve9PxJo3MN5v5yuyjHvdUcrQffT3WXMUfnGmHDVbC4k3sHJaJTgZCwpUplIaAo5ANtMyp3YHg==",
      "tinyglobby@0.2.17 sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "tinypool@2.1.0 sha512-Pugqs6M0m7Lv1I7FtxN4aoyToKg1C4tu+/381vH35y8oENM/Ai7f7C4StcoK4/+BSw9ebcS8jRiVrORFKCALLw==",
      "tinyrainbow@3.1.0 sha512-Bf+ILmBgretUrdJxzXM0SgXLZ3XfiaUuOj/IKQHuTXip+05Xn+uyEYdVg0kYDipTBcLrCVyUzAPz7QmArb0mmw==",
      "toidentifier@1.0.1 sha512-o5sSPKEkg/DIQNmH43V0/uerLrpzVedkUh8tGNvaeXpfpuwjKenlSox/2O/BTlZUtEe+JG7s5YhEz608PlAHRA==",
      "totalist@3.0.1 sha512-sf4i37nQ2LBx4m3wB74y+ubopq6W/dIzXg0FDGjsYnZHVa1Da8FH853wlL2gtUhg+xJXjfk3kUZS3BRoQeoQBQ==",
      "ts-morph@28.0.0 sha512-Wp3tnZ2bzwxyTZMtgWVzXDfm7lB1Drz+y9DmmYH/L702PQhPyVrp3pkou3yIz4qjS14GY9kcpmLiOOMvl8oG1g==",
      "tslib@2.8.1 sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "tunnel-agent@0.6.0 sha512-McnNiV1l8RYeY8tBgEpuodCC1mLUdbSN+CYBL7kJsJNInOP8UjDDEwdk6Mw60vdLLrr5NHKZhMAOSrR2NZuQ+w==",
      "type-is@2.1.0 sha512-faYHw0anBbc/kWF3zFTEnxSFOAGUX9GFbOBthvDdLsIlEoWOFOtS0zgCiQYwIskL9iGXZL3kAXD8OoZ4GmMATA==",
      "typescript@6.0.3 sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
      "undici-types@7.24.6 sha512-WRNW+sJgj5OBN4/0JpHFqtqzhpbnV0GuB+OozA9gCL7a993SmU+1JBZCzLNxYsbMfIeDL+lTsphD5jN5N+n0zg==",
      "undici@7.28.0 sha512-cRZYrTDwWznlnRiPjggAGxZXanty6M8RV1ff8Wm4LWXBp7/IG8v5DnOm74DtUBp9OONpK75YlPnIjQqX0dBDtA==",
      "unpipe@1.0.0 sha512-pjy2bYhSsufwWlKwPc+l3cN7+wuJlK6uz0YdJEOlQDbl6jo/YlPi4mb8agUkVC8BF7V8NuzeyPNqRksA3hztKQ==",
      "util-deprecate@1.0.2 sha512-EPD5q1uXyFxJpCrLnCc1nHnq3gOa6DZBocAIiI2TaSCA7VCJ1UJDMagCzIkXNsUYfD1daK//LTEQ8xiIbrHtcw==",
      "vary@1.1.2 sha512-BNGbWLfd0eUPabhkXUVm0j8uuvREyTh5ovRa/dyow/BqAbZJyC+5fU+IzQOzmAKzYqYRAISoRhdQr3eIZ/PXqg==",
      "vite-plus@0.1.24 sha512-b3fr6WtCiEhetjuzW/4KcEMOAMuZxoxZATWaXKmPzOLf1upG+pzKJOFZTb94D6wiPBlwcjxoaUtF7C3uAN+VjQ==",
      "vite@8.0.16 sha512-h9bXPmJichP5fLmVQo3PyaGSDE2n3aPuomeAlVRm0JLmt4rY6zmPKd59HYI4LNW8oTK7tlTsuC7l/m7awx9Jcw==",
      "vitest@4.1.8 sha512-flY6ScbCIt9HThs+C5HS7jvGOB560DJtk/Z15IQROTA6zEy49Nh8T/dofWTQL+n3vswqn87sbJNiuqw1SDp5Ig==",
      "which@2.0.2 sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "why-is-node-running@2.3.0 sha512-hUrmaWBdVDcxvYqnyh09zunKzROWjbZTiNy8dBEjkS7ehEDQibXJ7XvlmtbwuTclUiIyN+CyXQD4Vmko8fNm8w==",
      "wrappy@1.0.2 sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
      "ws@8.21.0 sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==",
      "xtend@4.0.2 sha512-LKYU1iAXJXUgAXn9URjiu+MWhyUXHsvfp7mcuYm9dSUKK0/CjtrUwFAxD82/mCWbtLsGjFIad0wIsod4zrTAEQ==",
      "zod-to-json-schema@3.25.2 sha512-O/PgfnpT1xKSDeQYSCfRI5Gy3hPf91mKVDuYLUHZJMiDFptvP41MSnWofm8dnCm0256ZNfZIM7DSzuSMAFnjHA==",
      "zod@4.4.3 sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ=="
    ]
  },
  "trustedDependencySurfaces": [
    {
      "id": "dep.node-pg.query-parameterization",
      "surface": "node-pg query parameterization",
      "dependency": "pg",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "8.22.0",
      "integrity": "sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==",
      "guarantee": "Data-plane query values travel as bound parameters over the extended-query protocol and are never interpolated into SQL text, so app-supplied values cannot escape a value position (SPEC §10.3 confidentiality/integrity).",
      "reviewTrigger": "Any bump of pg must re-confirm the node-postgres parameterized/extended-query path still binds values out-of-band before merging."
    },
    {
      "id": "dep.drizzle.sql-generation-parameterization",
      "surface": "Drizzle SQL-generation parameterization",
      "dependency": "drizzle-orm",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "1.0.0-rc.4",
      "integrity": "sha512-BT+pf+qoiYHqltoA88Jmf6ilGMXPlpfE0hEJKc2adRtMCAl25Swk/t5gXcWxZNAwdtf3F5gCd2FpeOyP/pT0Hw==",
      "guarantee": "Drizzle query builders emit parameterized SQL with placeholders for every interpolated value, keeping Kovo's managed-DB query surface injection-safe.",
      "reviewTrigger": "Any bump of drizzle-orm must re-confirm the SQL generator still parameterizes interpolated values and that the sql`` template escaping contract is unchanged."
    },
    {
      "id": "dep.pglite.set-local-role-rls",
      "surface": "PGlite SET LOCAL ROLE / RLS enforcement",
      "dependency": "@electric-sql/pglite",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "0.5.1",
      "integrity": "sha512-h2Vc+qkQqsEL5kvyN5nBAxn3Vbyvka7QfDW7Io+CdcwU1+X8JbCAN2og+5dI11S3eJuDfroUCxzJaap6k+ezEw==",
      "guarantee": "The embedded Postgres build honors SET LOCAL ROLE and FORCE ROW LEVEL SECURITY inside a request-scoped transaction, so the least-privilege runtime role cannot read or write beyond its grants.",
      "reviewTrigger": "Any bump of @electric-sql/pglite must re-confirm the bundled Postgres engine still enforces SET LOCAL ROLE and row-level-security policies identically."
    },
    {
      "id": "dep.postgres.set-role-force-rls",
      "surface": "Postgres SET ROLE / FORCE RLS enforcement",
      "dependency": "pg",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "8.22.0",
      "integrity": "sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==",
      "guarantee": "The node-postgres driver faithfully issues Kovo's SET ROLE / RESET / DISCARD ALL and RLS statements against the deployer's Postgres, so per-request principal scoping holds. The Postgres server itself is the deployer's responsibility and out of scope; the pinned surface is the driver that carries these statements.",
      "reviewTrigger": "Any bump of pg must re-confirm session/role statement and connection-reset (DISCARD ALL) semantics are unchanged, since they carry the per-request role boundary."
    },
    {
      "id": "dep.pgsql-ast-parser.sql-boundary-classification",
      "surface": "runtime SQL target and capability-closure parsing",
      "dependency": "pgsql-ast-parser",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "12.0.2",
      "integrity": "sha512-1WWa96Sw6h4uv9GLw98EzH/+xoBTC8j2TwV/AMW3E+Ir/fHOu/jLLbj6kPiz3y2bGISTKNYvKWwHoqvQ5FLuAw==",
      "guarantee": "Kovo's managed SQL write allowlist and Postgres capability-closure audit consume the parser's reviewed AST shapes to enumerate statement kinds, target tables, relations, and attached code paths; unsupported or malformed SQL remains a fail-closed parse result rather than being treated as safe.",
      "reviewTrigger": "Any bump of pgsql-ast-parser must re-run the SQL classifier and Postgres closure corpora, re-confirm the AST shapes for CTEs, UPDATE FROM, DELETE USING, quoted/schema-qualified identifiers, views, triggers, and functions, and verify every unsupported or parse-error path still fails closed."
    },
    {
      "id": "dep.undici.egress-transport-dispatch",
      "surface": "Undici outbound transport egress enforcement",
      "dependency": "undici",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "7.28.0",
      "integrity": "sha512-cRZYrTDwWznlnRiPjggAGxZXanty6M8RV1ff8Wm4LWXBp7/IG8v5DnOm74DtUBp9OONpK75YlPnIjQqX0dBDtA==",
      "guarantee": "While Kovo's egress floor is installed, framework-owned and ambient Undici fetch traffic is routed through Kovo's per-request dispatcher. The dispatcher validates every request and pooled redirect hop; the net layer validates and pins every address Node may select for a new dial. The bootstrap integrity check detects a later global-dispatcher replacement according to the configured hardening posture.",
      "reviewTrigger": "Any bump of undici must re-confirm Agent dispatch and global-dispatcher semantics, redirect and pooled-request dispatch through the installed policy, the net-layer DNS/IP pin before socket selection, abort/error propagation, and the egress bootstrap/runtime adversarial suites."
    },
    {
      "id": "dep.better-auth.password-hashing",
      "surface": "Better Auth password hashing",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "Submitted passwords are hashed with a memory-hard KDF and verified in the trusted zone; plaintext credentials never egress (proven in packages/better-auth/src/internal.trusted-plaintext.test.ts).",
      "reviewTrigger": "Any bump of better-auth must re-confirm the password hashing algorithm/parameters and that credential handling stays request-reachable-only with no new egress path."
    },
    {
      "id": "dep.better-auth.session-cookie-integrity",
      "surface": "Better Auth session/cookie integrity",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "Session tokens and cookies are signed and verified with integrity protection, and Set-Cookie is emitted with HttpOnly/SameSite/Secure defaults, so a session cannot be forged or leaked.",
      "reviewTrigger": "Any bump of better-auth must re-confirm cookie signing, session-token verification, and Set-Cookie attribute defaults are unchanged."
    },
    {
      "id": "dep.better-auth.reset-and-verification-token-lifecycle",
      "surface": "Better Auth password-reset and email-verification token lifecycle",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "If an app enables Better Auth password-reset or email-verification flows, the reset/verification tokens remain Better Auth protocol state: Kovo confines submitted secrets and proves non-egress, but token single-use, expiry, and uniform non-enumerating reset/verify responses are delegated to Better Auth rather than enforced by Kovo.",
      "reviewTrigger": "Any bump of better-auth, or any new Kovo wrapper around reset/verify flows, must re-confirm single-use + expiry semantics and that reset/verification responses do not introduce account-enumeration body/timing oracles."
    },
    {
      "id": "dep.better-auth.two-factor-replay-resistance",
      "surface": "Better Auth two-factor and backup-code replay resistance",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "If an app enables Better Auth two-factor flows, Kovo's wrapper treats two-factor-pending responses as not authenticated, but TOTP/backup-code replay resistance, backup-code burn-on-use semantics, and second-factor challenge expiry remain Better Auth-enforced protocol behavior.",
      "reviewTrigger": "Any bump of better-auth, or any new Kovo wrapper around two-factor enrollment/challenge APIs, must re-confirm that second-factor challenges and backup codes are single-use or otherwise replay-resistant and that pending-factor responses still cannot be misclassified as an authenticated session."
    },
    {
      "id": "dep.better-auth.account-linking-state-binding",
      "surface": "Better Auth account-linking callback state binding",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "If an app enables Better Auth social/account-linking flows, Kovo mounts the callback protocol as a public Better Auth-owned endpoint and keeps the app session out of the handler, but the proof that a provider callback cannot bind an attacker-controlled identity to the victim account rests on Better Auth's callback-state, nonce, and identity-binding checks.",
      "reviewTrigger": "Any bump of better-auth, or any Kovo change that wraps provider callback/linking flows more deeply than mount/session delegation, must re-confirm callback state/nonce validation and that account linking is bound to the initiating browser identity rather than ambient session confusion."
    },
    {
      "id": "dep.better-auth.atomic-rate-limit-custom-storage",
      "surface": "Better Auth custom rate-limit storage and route-rule dispatch",
      "dependency": "better-auth",
      "packageJson": "packages/better-auth/package.json",
      "pinnedVersion": "1.6.17",
      "integrity": "sha512-M0XMJ9/KE9hlmuN2Zha1VayShZW5CQifAMPaoz41gtao2la6YpT5KrnL5MAeIAM/3d4DkdYA2BVMY1Gt4iEzHw==",
      "guarantee": "Better Auth gives customStorage precedence over native storage, invokes atomic consume instead of the get/set fallback, applies exact customRules before the catch-all rule, preserves retryAfter on denials, and turns storage faults into a routed 5xx that Kovo rethrows.",
      "reviewTrigger": "Any bump of better-auth must re-run the bounded limiter's real-router, fallback-failure, concurrency, path-variant, and retry-after tests and re-confirm customStorage/customRules precedence in the pinned implementation."
    },
    {
      "id": "dep.argon2.password-hashing",
      "surface": "argon2 password hashing",
      "dependency": "@node-rs/argon2",
      "packageJson": "packages/server/package.json",
      "pinnedVersion": "2.0.2",
      "integrity": "sha512-t64wIsPEtNd4aUPuTAyeL2ubxATCBGmeluaKXEMAFk/8w6AJIVVkeLKMBpgLW6LU2t5cQxT+env/c6jxbtTQBg==",
      "guarantee": "The argon2id native binding provides the memory-hard hash/verify primitive underpinning Kovo's password hashing, with constant-time verification.",
      "reviewTrigger": "Any bump of @node-rs/argon2 must re-confirm argon2id defaults (memory/iterations/parallelism) and constant-time verify behavior before merging."
    }
  ],
  "plannedEntries": [
    {
      "id": "server.declared-write.authorize",
      "file": "packages/server/src/declared-write-boundary.ts",
      "name": "assertDeclaredWriteAllowed",
      "kind": "db-write-scope-refusal",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.declared-write.authorize"
    },
    {
      "id": "server.readonly-query.assert",
      "file": "packages/server/src/readonly-query-boundary.ts",
      "name": "assertReadonlyQueryAllowed",
      "kind": "db-read-only-refusal",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.readonly-query.assert"
    }
  ],
  "entries": [
    {
      "id": "server.postgres-runtime.production-driver-floor",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "assertProductionRuntimeDriver",
      "kind": "pglite-production-refusal",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "server.postgres-runtime.capability-closure-audit",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "auditPostgresReachableClosure",
      "kind": "postgres-capability-closure-audit",
      "classification": "tcb",
      "lineBudget": 150
    },
    {
      "id": "server.postgres-runtime.reachable-view-audit",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "auditPostgresReachableView",
      "kind": "postgres-view-capability-closure-audit",
      "classification": "tcb",
      "lineBudget": 60
    },
    {
      "id": "server.postgres-runtime.request-scoped-db",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "createRuntimeClient",
      "kind": "postgres-runtime-client-dispatch",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "server.postgres-runtime.pglite-request-scoped-db",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "createPgliteRuntimeClient",
      "kind": "pglite-least-privilege-runtime-path",
      "classification": "tcb",
      "lineBudget": 40
    },
    {
      "id": "server.postgres-runtime.node-request-scoped-db",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "createNodePostgresRuntimeClient",
      "kind": "node-postgres-least-privilege-runtime-path",
      "classification": "tcb",
      "lineBudget": 95
    },
    {
      "id": "server.postgres-runtime.node-client-close",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "closeNodePostgresRuntimeClients",
      "kind": "node-postgres-close-and-egress-unregister",
      "classification": "tcb",
      "lineBudget": 35
    },
    {
      "id": "server.postgres-runtime.internal-framework-capability",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "assertInternalPostgresRuntimeDbCapability",
      "kind": "pglite-superuser-capability-token-gate",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "core.security-markers.security-classifier",
      "file": "packages/core/src/internal/security-markers.ts",
      "name": "securityClassifier",
      "kind": "brand-constructor",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "core.security-markers.wire-emitter",
      "file": "packages/core/src/internal/security-markers.ts",
      "name": "wireEmitter",
      "kind": "brand-constructor",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "core.security-markers.metadata",
      "file": "packages/core/src/internal/security-markers.ts",
      "name": "securityDecisionMetadata",
      "kind": "brand-inspector",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "core.security-markers.mark",
      "file": "packages/core/src/internal/security-markers.ts",
      "name": "markSecurityDecision",
      "kind": "brand-constructor",
      "classification": "tcb",
      "lineBudget": 30
    },
    {
      "id": "core.secret.poison-box",
      "file": "packages/core/src/secret.ts",
      "name": "KovoPoisonBox",
      "kind": "secret-box",
      "classification": "tcb",
      "lineBudget": 90
    },
    {
      "id": "core.secret.secret",
      "file": "packages/core/src/secret.ts",
      "name": "secret",
      "kind": "secret-box-constructor",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.is-secret",
      "file": "packages/core/src/secret.ts",
      "name": "isSecret",
      "kind": "secret-box-guard",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.reveal-secret",
      "file": "packages/core/src/secret.ts",
      "name": "revealSecret",
      "kind": "audited-reveal",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.untrusted",
      "file": "packages/core/src/secret.ts",
      "name": "untrusted",
      "kind": "untrusted-box-constructor",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.is-untrusted",
      "file": "packages/core/src/secret.ts",
      "name": "isUntrusted",
      "kind": "untrusted-box-guard",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.reveal-untrusted",
      "file": "packages/core/src/secret.ts",
      "name": "revealUntrusted",
      "kind": "audited-reveal",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.validate-reveal-reason",
      "file": "packages/core/src/secret.ts",
      "name": "validateRevealReason",
      "kind": "audited-reveal-helper",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "core.secret.non-coercible-error",
      "file": "packages/core/src/secret.ts",
      "name": "nonCoercibleError",
      "kind": "secret-box-coercion-error",
      "classification": "tcb",
      "lineBudget": 10
    },
    {
      "id": "server.secret-egress.error",
      "file": "packages/server/src/secret-egress.ts",
      "name": "SecretEgressError",
      "kind": "secret-egress-refusal",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "server.secret-egress.assert-no-secret",
      "file": "packages/server/src/secret-egress.ts",
      "name": "assertNoSecretEgressValue",
      "kind": "secret-egress-refusal",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "server.secret-read.box-rows",
      "file": "packages/server/src/secret-read-boundary.ts",
      "name": "boxSecretReadRows",
      "kind": "secret-read-refusal",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.secret-read.box-rows",
      "lineBudget": 80
    },
    {
      "id": "server.secret-read.sqlite-boundary",
      "file": "packages/server/src/secret-read-boundary.ts",
      "name": "sqliteSecretReadBoundaryForStatement",
      "kind": "secret-read-refusal-experimental-sqlite-runtime-box-not-engine-confidentiality",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.secret-read.sqlite-boundary",
      "lineBudget": 80
    },
    {
      "id": "server.request-ingress.classifier",
      "file": "packages/server/src/request-ingress-policy.ts",
      "name": "createRequestIngressClassifier",
      "kind": "finite-request-source-method-authority-scheme-target-provenance-refusal",
      "classification": "tcb",
      "proof": "packages/server/src/request-ingress-policy.test.ts; packages/server/src/request-ingress-c13.test.ts; packages/server/src/__bugz_remote_ingress.test.ts; packages/server/src/node.test.ts; packages/server/src/build.test.ts",
      "lineBudget": 310
    },
    {
      "id": "better-auth.request-secret-surface.manifest",
      "file": "packages/better-auth/src/internal/non-egress-proof.ts",
      "name": "betterAuthRequestSecretPaths",
      "kind": "request-reachable-auth-secret-path-inventory",
      "classification": "inventory-classifier",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "paths": [
        "better-auth.sign-in.submitted-password",
        "better-auth.sign-up.submitted-password",
        "better-auth.sign-out.request-cookie",
        "better-auth.get-session.request-cookie",
        "better-auth.get-session.response-secret-projection",
        "better-auth.set-cookie.forwarding",
        "better-auth.session-refresh.set-cookie",
        "better-auth.adapter.sign-in.account-password",
        "better-auth.adapter.session-token-lookup",
        "better-auth.mount.handler-delegation",
        "better-auth.mount.set-cookie-forwarding",
        "better-auth.binding.signing-secret",
        "better-auth.rate-limit.signing-secret"
      ]
    },
    {
      "id": "better-auth.request-secret-surface.proof",
      "file": "packages/better-auth/src/internal/non-egress-proof.ts",
      "name": "proveBetterAuthRequestSecretNonEgress",
      "kind": "request-reachable-auth-secret-non-egress-proof",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 45
    },
    {
      "id": "better-auth.credential-consumer.contracts",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "betterAuthCredentialConsumerContracts",
      "kind": "better-auth-credential-consumer-census",
      "classification": "inventory-classifier",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts"
    },
    {
      "id": "better-auth.credential-runtime-gate.census-validation",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "validateCredentialConsumerCensus",
      "kind": "better-auth-credential-consumer-census-closure",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 55
    },
    {
      "id": "better-auth.credential-runtime-gate.contract-validation",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "validateConsumerContract",
      "kind": "better-auth-credential-consumer-contract-refusal",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 55
    },
    {
      "id": "better-auth.credential-runtime-gate.constructor",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "createBetterAuthCredentialConsumer",
      "kind": "better-auth-exact-consumer-constructor",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 30
    },
    {
      "id": "better-auth.credential-runtime-gate.contract-selection",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "contractById",
      "kind": "better-auth-exact-consumer-contract-selection",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 20
    },
    {
      "id": "better-auth.credential-runtime-gate.consumers",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "betterAuthCredentialConsumers",
      "kind": "better-auth-exact-consumer-token-inventory",
      "classification": "inventory-classifier",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts"
    },
    {
      "id": "better-auth.credential-runtime-gate.run-sync",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "runBetterAuthCredentialConsumer",
      "kind": "better-auth-credential-non-egress-door",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 30
    },
    {
      "id": "better-auth.credential-runtime-gate.source-callable-sync",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "runBetterAuthCredentialSourceCallable",
      "kind": "better-auth-exact-source-callable-door",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 35
    },
    {
      "id": "better-auth.credential-runtime-gate.source-callable-async",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "runBetterAuthCredentialSourceCallableAsync",
      "kind": "better-auth-exact-source-callable-door",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 35
    },
    {
      "id": "better-auth.credential-runtime-gate.source-callable-preparation",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "prepareCredentialSourceCallable",
      "kind": "better-auth-exact-source-callable-refusal",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 65
    },
    {
      "id": "better-auth.credential-runtime-gate.transform-refusal",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "requirePackageOwnedTransform",
      "kind": "better-auth-owner-callback-refusal",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 15
    },
    {
      "id": "better-auth.credential-runtime-gate.source-normalization",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "normalizeCredentialSourceResult",
      "kind": "better-auth-source-result-normalization",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 45
    },
    {
      "id": "better-auth.credential-runtime-gate.consumer-refusal",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "requireConsumer",
      "kind": "better-auth-exact-consumer-refusal",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 35
    },
    {
      "id": "better-auth.credential-runtime-gate.result-validation",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "validateConsumerResult",
      "kind": "better-auth-credential-result-validator",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 85
    },
    {
      "id": "better-auth.credential-runtime-gate.consume",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "consumeBetterAuthCredentialResult",
      "kind": "better-auth-credential-result-refusal",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 35
    },
    {
      "id": "better-auth.credential-runtime-gate.result-registration",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "registerResult",
      "kind": "better-auth-credential-result-registration",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 20
    },
    {
      "id": "better-auth.credential-runtime-gate.error-redaction",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "sanitizedConsumerFailure",
      "kind": "better-auth-credential-error-redaction",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 25
    },
    {
      "id": "better-auth.credential-runtime-gate.failure-status",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "credentialFailureStatus",
      "kind": "better-auth-opaque-credential-failure-classifier",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 20
    },
    {
      "id": "better-auth.credential-runtime-gate.failure-field",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "hasCredentialFailureStatus",
      "kind": "better-auth-own-data-credential-failure-field",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 15
    },
    {
      "id": "better-auth.credential-runtime-gate.failure-consume",
      "file": "packages/better-auth/src/internal/credential-runtime-gate.ts",
      "name": "isBetterAuthCredentialGateFailure",
      "kind": "better-auth-one-shot-credential-failure-verdict",
      "classification": "tcb",
      "proof": "packages/better-auth/src/internal.trusted-plaintext.test.ts",
      "lineBudget": 10
    },
    {
      "id": "better-auth.rate-limit.storage",
      "file": "packages/better-auth/src/internal/rate-limit-storage.ts",
      "name": "createBetterAuthBoundedRateLimitStorage",
      "kind": "bounded-hmac-credential-rate-limit-storage",
      "classification": "tcb",
      "lineBudget": 100
    },
    {
      "id": "better-auth.rate-limit.key",
      "file": "packages/better-auth/src/internal/rate-limit-storage.ts",
      "name": "assertCredentialRateLimitKey",
      "kind": "credential-rate-limit-key-refusal",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "server.better-auth.rate-limit.postgres-consume",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "createBetterAuthPostgresRateLimitBucketConsumer",
      "kind": "postgres-atomic-db-clock-rate-limit-consumer",
      "classification": "tcb",
      "lineBudget": 35
    },
    {
      "id": "server.better-auth.rate-limit.sqlite-consume",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "createBetterAuthSqliteRateLimitBucketConsumer",
      "kind": "sqlite-atomic-db-clock-rate-limit-consumer",
      "classification": "tcb",
      "lineBudget": 35
    },
    {
      "id": "server.better-auth.rate-limit.bucket-input",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "assertBetterAuthRateLimitBucketInput",
      "kind": "fixed-rate-limit-bucket-refusal",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "server.better-auth.rate-limit.postgres-table",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "requirePostgresRateLimitTable",
      "kind": "postgres-rate-limit-table-refusal",
      "classification": "tcb",
      "lineBudget": 15
    },
    {
      "id": "server.better-auth.rate-limit.sqlite-table",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "requireSqliteRateLimitTable",
      "kind": "sqlite-rate-limit-table-refusal",
      "classification": "tcb",
      "lineBudget": 15
    },
    {
      "id": "server.better-auth.rate-limit.columns",
      "file": "packages/server/src/internal/better-auth.ts",
      "name": "requireRateLimitColumns",
      "kind": "rate-limit-column-shape-refusal",
      "classification": "tcb",
      "lineBudget": 25
    },
    {
      "id": "drizzle.runtime-metadata.extract",
      "file": "packages/drizzle/src/runtime-metadata.ts",
      "name": "extractKovoRuntimeDbMetadata",
      "kind": "metadata-extractor",
      "classification": "inventory-classifier",
      "decision": "drizzle.runtime.extract-kovo-runtime-db-metadata"
    },
    {
      "id": "server.response-posture.emit-to-wire",
      "file": "packages/server/src/response-posture.ts",
      "name": "emitToWire",
      "kind": "wire-emitter",
      "classification": "tcb",
      "wrapper": "wireEmitter",
      "decision": "server.response.emit-to-wire",
      "lineBudget": 50
    },
    {
      "id": "server.managed-db.readonly-db",
      "file": "packages/server/src/managed-db.ts",
      "name": "readonlyDb",
      "kind": "db-read-only-wrapper",
      "classification": "tcb",
      "lineBudget": 20
    },
    {
      "id": "server.managed-db.readonly-capability",
      "file": "packages/server/src/managed-db.ts",
      "name": "readonlyCapabilityDb",
      "kind": "db-read-only-wrapper",
      "classification": "tcb",
      "lineBudget": 30
    },
    {
      "id": "server.managed-db.managed-db",
      "file": "packages/server/src/managed-db.ts",
      "name": "managedDb",
      "kind": "db-managed-wrapper",
      "classification": "tcb",
      "lineBudget": 50
    },
    {
      "id": "server.managed-db.declared-write-db",
      "file": "packages/server/src/managed-db.ts",
      "name": "createDeclaredWriteDb",
      "kind": "db-declared-write-wrapper",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.declared-write-db",
      "lineBudget": 55
    },
    {
      "id": "server.managed-db.declared-write-tables",
      "file": "packages/server/src/managed-db.ts",
      "name": "assertDeclaredWriteTablesAllowed",
      "kind": "db-declared-write-classifier",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.declared-write-tables",
      "lineBudget": 30
    },
    {
      "id": "server.managed-db.sqlite-declared-write-authorizer",
      "file": "packages/server/src/managed-db.ts",
      "name": "assertSqliteDeclaredWriteStatementAllowed",
      "kind": "db-declared-write-authorizer",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.sqlite-declared-write-authorizer",
      "lineBudget": 70
    },
    {
      "id": "server.managed-db.authorization-census-db",
      "file": "packages/server/src/managed-db.ts",
      "name": "createAuthorizationCensusDb",
      "kind": "db-authorization-census-wrapper",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.authorization-census-db",
      "lineBudget": 20
    },
    {
      "id": "server.managed-db.framework-authorization-census-db",
      "file": "packages/server/src/managed-db.ts",
      "name": "createFrameworkAuthorizationCensusDb",
      "kind": "framework-db-authorization-census-wrapper",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.framework-authorization-census-db",
      "lineBudget": 40
    },
    {
      "id": "server.managed-db.register-framework-hooks",
      "file": "packages/server/src/managed-db.ts",
      "name": "registerFrameworkManagedDbHooks",
      "kind": "framework-db-adapter-hook-registration",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.register-framework-hooks",
      "lineBudget": 35
    },
    {
      "id": "server.managed-db.postgres-readonly-client",
      "file": "packages/server/src/managed-db.ts",
      "name": "createPostgresReadonlyClient",
      "kind": "db-read-only-wrapper",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.postgres-readonly-client",
      "lineBudget": 20
    },
    {
      "id": "server.managed-db.postgres-scoped-client",
      "file": "packages/server/src/managed-db.ts",
      "name": "createPostgresScopedClient",
      "kind": "postgres-engine-choke-role-rls-current-principal-authorization",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.managed-db.postgres-scoped-client",
      "lineBudget": 25
    },
    {
      "id": "server.postgres-runtime.provision",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "provisionPostgresAppDb",
      "kind": "postgres-rls-policy-grant-provisioner",
      "classification": "inventory-classifier"
    },
    {
      "id": "server.postgres-runtime.migrate",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "migratePostgresAppDb",
      "kind": "postgres-reviewed-migration-runner",
      "classification": "inventory-classifier"
    },
    {
      "id": "server.postgres-runtime.generate-migration",
      "file": "packages/server/src/postgres-runtime.ts",
      "name": "planPostgresAppDbMigration",
      "kind": "postgres-reviewed-migration-generator",
      "classification": "inventory-classifier"
    },
    {
      "id": "server.sql-safe-handle.enforce-managed-sql",
      "file": "packages/server/src/sql-safe-handle.ts",
      "name": "enforceManagedSql",
      "kind": "classifier",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.sql.enforce-managed-sql",
      "lineBudget": 20
    },
    {
      "id": "server.sql-safe-handle.write-table-allowlist",
      "file": "packages/server/src/sql-safe-handle.ts",
      "name": "assertSqlWriteTablesAllowed",
      "kind": "classifier",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.sql.write-table-allowlist",
      "lineBudget": 60
    },
    {
      "id": "server.sql-safe-handle.read-only-statement",
      "file": "packages/server/src/sql-safe-handle.ts",
      "name": "assertReadSqlStatement",
      "kind": "classifier",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.sql.read-only-statement",
      "lineBudget": 30
    },
    {
      "id": "server.sql-safe-handle.managed-safety-mode",
      "file": "packages/server/src/sql-safe-handle.ts",
      "name": "managedSqlSafetyMode",
      "kind": "classifier",
      "classification": "inventory-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.managed-safety-mode"
    },
    {
      "id": "server.sql-safe-handle.classify-managed-sql",
      "file": "packages/server/src/sql-safe-handle.ts",
      "name": "classifyManagedSql",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.classify-managed-sql"
    },
    {
      "id": "server.sql-write-allowlist.parse-sql-write-tables",
      "file": "packages/server/src/sql-write-allowlist.ts",
      "name": "parseSqlWriteTables",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.parse-write-tables"
    },
    {
      "id": "server.sql-write-allowlist.classify-statement",
      "file": "packages/server/src/sql-write-allowlist.ts",
      "name": "classifyStatement",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.classify-statement"
    },
    {
      "id": "server.sql-write-allowlist.classify-parsed-statement",
      "file": "packages/server/src/sql-write-allowlist.ts",
      "name": "classifyParsedStatement",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.classify-write-statement"
    },
    {
      "id": "server.sql-write-allowlist.unparsed-sqlite-write-statement",
      "file": "packages/server/src/sql-write-allowlist.ts",
      "name": "unparsedSqliteWriteStatement",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.sql.unparsed-sqlite-write"
    },
    {
      "id": "server.auth-principal.is-proven-principal",
      "file": "packages/server/src/auth-principal.ts",
      "name": "isProvenPrincipal",
      "kind": "classifier",
      "classification": "inventory-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.auth.proven-principal"
    },
    {
      "id": "server.auth-principal.posture-from-request",
      "file": "packages/server/src/auth-principal.ts",
      "name": "principalPostureFromRequest",
      "kind": "classifier",
      "classification": "inventory-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.auth.request-principal-posture"
    },
    {
      "id": "server.capability-url.sign",
      "file": "packages/server/src/capability-url.ts",
      "name": "signCapability",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.capability-url"
    },
    {
      "id": "server.capability-url.verify",
      "file": "packages/server/src/capability-url.ts",
      "name": "verifyCapability",
      "kind": "classifier",
      "classification": "inventory-classifier",
      "wrapper": "securityClassifier",
      "decision": "server.auth.verify-capability-url"
    },
    {
      "id": "server.app-system-response",
      "file": "packages/server/src/app-system-response.ts",
      "name": "appSystemResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.system-response"
    },
    {
      "id": "server.document-core.render-document",
      "file": "packages/server/src/document-core.ts",
      "name": "renderDocument",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.ssr-document"
    },
    {
      "id": "server.document-core.render-route-document-response",
      "file": "packages/server/src/document-core.ts",
      "name": "renderRouteDocumentResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.route-document"
    },
    {
      "id": "server.document-core.render-error-document",
      "file": "packages/server/src/document-core.ts",
      "name": "renderErrorDocument",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.error-document-shell"
    },
    {
      "id": "server.mutation.streaming",
      "file": "packages/server/src/mutation/streaming.ts",
      "name": "renderStreamingMutationWireResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-stream"
    },
    {
      "id": "server.mutation.wire-response.lifecycle",
      "file": "packages/server/src/mutation/wire-response.ts",
      "name": "renderMutationWireLifecycleResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-lifecycle"
    },
    {
      "id": "server.mutation.wire-response.success",
      "file": "packages/server/src/mutation/wire-response.ts",
      "name": "renderSuccessfulMutationWireResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-success-delta"
    },
    {
      "id": "server.mutation.wire-response.failure",
      "file": "packages/server/src/mutation/wire-response.ts",
      "name": "mutationWireFailureResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-failure"
    },
    {
      "id": "server.mutation.wire-response.headers",
      "file": "packages/server/src/mutation/wire-response.ts",
      "name": "mutationWireResponseHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-headers"
    },
    {
      "id": "server.mutation.wire-response.reauth",
      "file": "packages/server/src/mutation/wire-response.ts",
      "name": "enhancedMutationReauthResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.mutation-reauth"
    },
    {
      "id": "server.query.endpoint-response",
      "file": "packages/server/src/query.ts",
      "name": "renderQueryEndpointResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.query-endpoint"
    },
    {
      "id": "server.query.registry-endpoint-response",
      "file": "packages/server/src/query.ts",
      "name": "renderQueryRegistryEndpointResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.query-registry-endpoint"
    },
    {
      "id": "server.query.endpoint-chunk",
      "file": "packages/server/src/query.ts",
      "name": "renderQueryEndpointChunk",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.query-endpoint-chunk"
    },
    {
      "id": "server.query.json-headers",
      "file": "packages/server/src/query.ts",
      "name": "queryJsonHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.query-json-headers"
    },
    {
      "id": "server.query.cache-headers",
      "file": "packages/server/src/query.ts",
      "name": "withQueryCacheHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.query-cache-headers"
    },
    {
      "id": "server.response.route-outcome",
      "file": "packages/server/src/response.ts",
      "name": "routeOutcomeResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.route-outcome-response"
    },
    {
      "id": "server.response.html-server-error",
      "file": "packages/server/src/response.ts",
      "name": "htmlServerErrorResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.html-server-error"
    },
    {
      "id": "server.response.route-to-web",
      "file": "packages/server/src/response.ts",
      "name": "routeResponseToWebResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.route-to-web-response"
    },
    {
      "id": "server.response.server-to-web",
      "file": "packages/server/src/response.ts",
      "name": "serverResponseToWebResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.server-to-web-response"
    },
    {
      "id": "server.response.redirect-location-header",
      "file": "packages/server/src/response.ts",
      "name": "redirectLocationHeader",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.redirect-location-header"
    },
    {
      "id": "server.response.bless-redirect",
      "file": "packages/server/src/response.ts",
      "name": "blessRedirectResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.bless-redirect-response"
    },
    {
      "id": "server.response.redirect-location-value",
      "file": "packages/server/src/response.ts",
      "name": "redirectLocationHeaderValue",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.redirect-location-header-value"
    },
    {
      "id": "server.response.route-document",
      "file": "packages/server/src/response.ts",
      "name": "routeResponseToDocumentResponse",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.route-to-document-response"
    },
    {
      "id": "server.response.route-headers",
      "file": "packages/server/src/response.ts",
      "name": "routeOutcomeHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.route-outcome-headers"
    },
    {
      "id": "server.static-export-headers.create-sink",
      "file": "packages/server/src/static-export-headers.ts",
      "name": "createStaticExportHeaderSink",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.static-export-header-sink"
    },
    {
      "id": "server.static-export-headers.headers",
      "file": "packages/server/src/static-export-headers.ts",
      "name": "staticExportHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.static-export-headers"
    },
    {
      "id": "server.static-export-headers.framework-document-headers",
      "file": "packages/server/src/static-export-headers.ts",
      "name": "staticExportFrameworkDocumentHeaders",
      "kind": "wire-emitter",
      "classification": "delegating-wire-emitter",
      "wrapper": "wireEmitter",
      "decision": "server.wire.static-export-framework-document-headers"
    },
    {
      "id": "compiler.component-event-boundary.is-reviewed",
      "file": "packages/compiler/src/component-event-boundary-registry.ts",
      "name": "isReviewedComponentEventBoundary",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.component-event-boundary.is-reviewed"
    },
    {
      "id": "compiler.component-event-props.validate",
      "file": "packages/compiler/src/validate/component-event-props.ts",
      "name": "validateComponentEventProps",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.component-event-props.validate"
    },
    {
      "id": "compiler.client-handler-import.reviewed-target",
      "file": "packages/compiler/src/client-handler-import-policy.ts",
      "name": "reviewedClientHandlerImportTarget",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.client-handler-import.reviewed-target"
    },
    {
      "id": "compiler.client-handler-import.reviewed-canonical-target",
      "file": "packages/compiler/src/client-handler-import-policy.ts",
      "name": "reviewedCanonicalClientHandlerImportTarget",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.client-handler-import.reviewed-canonical-target"
    },
    {
      "id": "compiler.client-handler-import.validate",
      "file": "packages/compiler/src/validate/client-capture.ts",
      "name": "validateClientHandlerImportPolicy",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.client-handler-import.validate"
    },
    {
      "id": "compiler.client-handler-execution.validate",
      "file": "packages/compiler/src/validate/client-capture.ts",
      "name": "validateClientHandlerExecutionPolicy",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.client-handler-execution.validate"
    },
    {
      "id": "compiler.trusted-html.validate",
      "file": "packages/compiler/src/validate/trusted-html-provenance.ts",
      "name": "validateTrustedHtmlProvenance",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.trusted-html.validate-provenance"
    },
    {
      "id": "compiler.trusted-html.raw-trust-call",
      "file": "packages/compiler/src/validate/trusted-html-provenance.ts",
      "name": "rawTrustSinkForCall",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.trusted-html.raw-trust-call"
    },
    {
      "id": "compiler.trusted-html.raw-trust-expression",
      "file": "packages/compiler/src/validate/trusted-html-provenance.ts",
      "name": "rawTrustSinkForExpression",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.trusted-html.raw-trust-expression"
    },
    {
      "id": "compiler.trusted-html.classify-expression",
      "file": "packages/compiler/src/validate/trusted-html-provenance.ts",
      "name": "classifyExpression",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.trusted-html.classify-expression"
    },
    {
      "id": "compiler.confidentiality.validate-secret-query-wire",
      "file": "packages/compiler/src/validate/confidentiality.ts",
      "name": "validateSecretQueryWire",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.confidentiality.validate-secret-query-wire"
    },
    {
      "id": "compiler.confidentiality.secret-query-shape-paths",
      "file": "packages/compiler/src/validate/confidentiality.ts",
      "name": "secretQueryShapePaths",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.confidentiality.secret-query-paths"
    },
    {
      "id": "compiler.confidentiality.table-row-query-shape-paths",
      "file": "packages/compiler/src/validate/confidentiality.ts",
      "name": "tableRowQueryShapePaths",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "compiler.confidentiality.table-row-query-paths"
    },
    {
      "id": "drizzle.query-shapes.is-query-shape-wrapper",
      "file": "packages/drizzle/src/static/query-shapes.ts",
      "name": "isQueryShapeWrapper",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.query-shapes.is-wrapper"
    },
    {
      "id": "drizzle.query-shapes.select-shape-from-query-body",
      "file": "packages/drizzle/src/static/query-shapes.ts",
      "name": "selectShapeFromQueryBody",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.query-shapes.select-shape-from-body"
    },
    {
      "id": "drizzle.query-shapes.source-destructured-receiver",
      "file": "packages/drizzle/src/static/query-shapes.ts",
      "name": "sourceDestructuredQueryReceiverDiagnostics",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.query-shapes.source-destructured-receiver-diagnostics"
    },
    {
      "id": "drizzle.query-shapes.is-opaque-projection",
      "file": "packages/drizzle/src/static/query-shapes.ts",
      "name": "isOpaqueProjection",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.query-shapes.is-opaque-projection"
    },
    {
      "id": "drizzle.query-shapes.typed-sql-projection",
      "file": "packages/drizzle/src/static/query-shapes.ts",
      "name": "typedSqlProjectionShape",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.query-shapes.typed-sql-projection-shape"
    },
    {
      "id": "drizzle.framework-identity.expression-kind",
      "file": "packages/drizzle/src/static/framework-identity.ts",
      "name": "frameworkIdentityExpressionKindResolution",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.framework-identity.expression-kind-resolution"
    },
    {
      "id": "drizzle.framework-identity.canonical-export",
      "file": "packages/drizzle/src/static/framework-identity.ts",
      "name": "canonicalFrameworkExportForExpression",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.framework-identity.canonical-expression"
    },
    {
      "id": "drizzle.framework-identity.canonical-expression",
      "file": "packages/drizzle/src/static/framework-identity.ts",
      "name": "canonicalExpression",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.framework-identity.expression"
    },
    {
      "id": "drizzle.framework-identity.namespace-member",
      "file": "packages/drizzle/src/static/framework-identity.ts",
      "name": "namespaceMemberIdentityForIdentifier",
      "kind": "classifier",
      "classification": "advisory-static-classifier",
      "wrapper": "securityClassifier",
      "decision": "drizzle.framework-identity.namespace-member"
    }
  ]
}
```
