# Kovo Security TCB Manifest

This manifest is the current A10/DEC-K substrate inventory for the security trusted computing
base. The compact finite-model proof harness for the `Secret`/`Untrusted` boxes, Kovo wire JSON,
and the typed `emitToWire` response choke lives in:

- `packages/core/src/secret.tcb-proof.test.ts`
- `packages/core/src/internal/wire-json.tcb-proof.test.ts`
- `scripts/tcb-proof-harness.test.ts`

Those tests enumerate the modeled JS coercion operations, JSON value shapes, poisoned-box depths,
and `emitToWire` framework/raw response cases. They prove the current runtime floor only: box
non-coercibility, fixed redacted observation, wire-JSON refusal for `Secret`/`Untrusted`, and
`emitToWire` refusal for typed framework response header egress.

Entries classified as `tcb` count toward the size budget. Entries classified as
`delegating-wire-emitter`, `advisory-static-classifier`, or `inventory-classifier` are deliberately
listed so branded security-decision wrappers cannot appear without a manifest classification, but
they are not claimed as the verified TCB.

```json tcb-manifest
{
  "schema": "kovo.security.tcb/v1",
  "source": "plans/fundamental-fixes-followup-3.md A10/DEC-K",
  "budgets": {
    "entryMaxLines": 150,
    "totalTcbMaxLines": 600
  },
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
      "lineBudget": 60
    },
    {
      "id": "server.secret-read.sqlite-boundary",
      "file": "packages/server/src/secret-read-boundary.ts",
      "name": "sqliteSecretReadBoundaryForStatement",
      "kind": "secret-read-refusal",
      "classification": "tcb",
      "wrapper": "securityClassifier",
      "decision": "server.secret-read.sqlite-boundary",
      "lineBudget": 80
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
      "lineBudget": 30
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
