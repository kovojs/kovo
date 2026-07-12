# Security Bug Ledger (`bugz-27`)

**Date:** 2026-07-11

**Scope:** Adversarial closure rounds run while implementing `bugz-26`, followed by a fresh
three-way runtime/compiler/data sweep of the fixed integration tree through `bf1a3b81a` (with the
generated inline-loader refresh at `e2922cfac`). `SPEC.md` remains normative. Findings were carried
only after executable reproduction and an independent cross-check; dependency presence or a
source-only concern was insufficient.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| Critical |     1 | C1    |
| High     |     8 | H1-H8 |
| Medium   |     6 | M1-M6 |

## Critical

- [ ] **C1 - Mutable collection prototypes can forge Kovo's private security witnesses.**
      `packages/browser/src/security-output.ts`, `packages/core/src/internal/{sink-policy,sql-safety}.ts`,
      `packages/core/src/verifier.ts`, and server access/auth/request/SQL proof modules
  - Selective `WeakSet.prototype.has` and `WeakMap.prototype.has/get` overrides made an ordinary
    object pass HTML trust and real SSR emitted raw event-bearing markup. The same primitive forged
    a safe guard audit for a custom victim-authority guard; adjacent Map/Set-backed receipts cover
    endpoint verification, request neutralization, SQL policy, principal, command, and app closure.
  - **Impact:** direct XSS plus cross-boundary authorization/CSRF/SQL proof forgery from one shared
    proof-currency failure.
  - **SPEC:** sections 5.2, 6.6, 9.1, and 10.2 require private, non-copyable proof and exact
    classify-then-consume behavior.
  - **Acceptance:** every authority-bearing Map/Set/WeakMap/WeakSet operation must use boot-pinned,
    semantically checked intrinsics (including import-order hostile controls), and a regression
    census must reject new ambient witness calls. Forged positives must fail closed across output,
    guards, endpoints, request views, SQL, verifier, app, and command surfaces.

## High

- [ ] **H1 - Node SSR trusts an app-installed `globalThis.TrustedHTML` constructor.**
      `packages/browser/src/security-output.ts`
  - On a platform with no native Trusted Types constructor, installing a late class with hostile
    `Symbol.hasInstance` made a plain object raw HTML and produced a real `<svg onload>` response.
  - **Acceptance:** capture the genuine platform constructor and `Function@@hasInstance` before app
    evaluation; an absent native constructor remains absent, and late/fake constructors stay escaped.

- [ ] **H2 - Nested rendered-output sinks re-read mutable public `.html` fields.**
      `packages/server/src/{html,renderable,app-document,component-render,deferred-region,route}.ts`
  - Poisoning ambient `Object.freeze` while minting a genuine `RenderedHtml`, then replacing its
    public field, left the direct snapshot sink safe but nested JSX emitted the attacker replacement.
  - **Acceptance:** pin a validated freeze intrinsic and consume only module-private byte snapshots
    at every nested/document/fragment sink; public mutation cannot alter emitted bytes.

- [ ] **H3 - KV418 treats inline handlers with mutable module/global captures as authority-free.**
      `packages/compiler/src/scan/parse.ts`
  - A normal GET cached victim authority in module scope; a real production build accepted a
    `csrf:false` handler closing over it, and a tokenless cross-origin POST committed the victim write.
  - **Acceptance:** fail closed on every free capture unless recursively proven handler-local and
    immutable; preserve direct non-ambient machine-header controls and bind proof to runtime handler.

- [ ] **H4 - `createApp()` retains mutable CSRF verification authority after app closure.**
      `packages/server/src/{app,app-snapshot,csrf}.ts`
  - Mutating the retained secret, session-id callback, and `trustedOrigins` changed an identical
    forged victim-cookie mutation from 422/no calls to 303/handler execution.
  - **Acceptance:** descriptor-snapshot and freeze secret/keyring posture, callbacks, field,
    anonymous-cookie options, and trusted origins so form minting and verification share one closed fact.

- [x] **H5 - Better Auth browser credential mutations admitted a forged `csrf:false` posture.**
      `packages/better-auth/src/{credential-options,mutations}.ts`
  - Sign-in/sign-up/sign-out could be converted into login/logout-CSRF surfaces despite relying on
    browser cookie state.
  - **Evidence:** 37 focused Better Auth credential/trusted-boundary tests pass; all three mutations
    retain mandatory default CSRF and reject runtime/typed exemption attempts.

- [x] **H6 - CSRF-exempt mutation/endpoint paths retained browser authorization or could emit
      browser state without executed machine verification.**
      `packages/server/src/{app-mutation-request,endpoint,response-posture,mutation}.ts`
  - Cookie/Authorization/Proxy-Authorization and `Set-Cookie`/`Clear-Site-Data` crossed exempt
    lifecycle, replay, error, or endpoint boundaries despite an explicit non-browser posture.
  - **Evidence:** the 345-test mutation/endpoint integration selection passes, proving neutral
    request views/clones and private executed-verifier receipts at every browser-state response choke.

- [ ] **H7 - Raw Node request targets normalize into another mutation or attacker authority.**
      `packages/server/src/{node,build}.ts`
  - Dot-prefix, encoded-dot-prefix, multiple-slash, and backslash targets reached canonical `/_m`
    handlers; an absolute-form `//host` path could also replace a configured Web Request origin.
  - **Acceptance:** lex and reject every ambiguous reserved target before Web Request construction in
    live/emitted Node and Vercel, while URL construction pins the configured/default authority.

- [x] **H8 - KV418/guard audit proof could bind mutable, opaque, or decoy application facts.**
      `packages/compiler/src/scan/parse.ts`, `packages/server/src/guards.ts`,
      `packages/cli/src/commands/build-export.ts`
  - Mutable rate options, unaudited composite children, proxy/accessor facts, nonliteral keys, and a
    same-key decoy handler could create a green audit unrelated to the executable guard/handler.
  - **Evidence:** guard/compiler real-build fixtures plus the 363-file fail-closed and verdict-routing
    gates pass; exact runtime handler fingerprints and frozen opaque facts now dominate.

## Medium

- [ ] **M1 - PostgreSQL posture ignores future-object authority from schema/database ACLs.**
      `packages/server/src/postgres-runtime.ts`
  - Writer/PUBLIC/custom-member schema `CREATE`, database `CREATE`, and default database `TEMP`
    remained green. Shared roles then created unprotected cross-principal relations or new schemas.
  - **Acceptance:** provision and audit effective privilege closure, ownership, PUBLIC, and transitive
    membership for every non-system schema plus database CREATE/TEMP; retain only required CONNECT/USAGE.

- [x] **M2 - Unexpected Better Auth errors can carry submitted plaintext passwords to diagnostics.**
      `packages/better-auth/src/{mutations,session}.ts`
  - Provider-echoed sign-in/sign-up errors reached app `onError` and default stderr verbatim.
  - **Evidence:** 37 focused tests prove typed 400/401/403 failures remain declared outcomes while
    unexpected sign-in/sign-up errors become fresh cause-free generic errors and status accessors are
    never invoked; sign-out/session provider calls use the same cause-free boundary.

- [x] **M3 - Diagnostic sanitization missed nested/constructor-poisoned carriers and queryless URL
      userinfo.** `packages/server/src/{diagnostics,logging}.ts`
  - Request/Headers/URL/Map/Set/accessor/abort/error-constructor carriers and control characters could
    reintroduce credentials; `https://user:password@host/path` was skipped without query/hash.
  - **Evidence:** 42 logging/diagnostic/generated-Node tests pass with recursive descriptor-safe
    sanitization, captured platform brands, value-free URLs, userinfo removal, and stderr neutralization.

- [x] **M4 - Pre-dispatch callbacks observed authority/body state before stable limits and errors.**
      `packages/server/src/{app-load-shed,app-request,request-carrier,reporting}.ts`
  - Oversized streams reached lifecycle providers, cancellation promises could pin a request, callback
    metadata retained query/header secrets, and callback/accessor throws escaped stable surface errors.
  - **Evidence:** app/request/reporting tests prove pre-provider byte limits, non-blocking cancel,
    bodyless value-free callback views, narrowed client-IP headers, and stable per-surface 500 responses.

- [x] **M5 - Incomplete Node transports pinned sockets and generated outer logging retained secrets.**
      `packages/server/src/{node,build}.ts`
  - Content-Length/chunked rejections did not reliably close incomplete requests, while adapter-level
    errors could log credential/query material and terminal controls outside the main diagnostic choke.
  - **Evidence:** 50 live/emitted Node/Vercel tests pass for close-after-flush behavior, keep-alive
    controls, credential-neutral logging, and raw-target suffix rejection.

- [x] **M6 - Mutation error/replay/startup responses could mutate browser state after failed or
      exempt requests.** `packages/server/src/{app-request,mutation,response-posture,replay}.ts`
  - Unknown mutation, startup/DB failure, no-JS/enhanced replay, and custom error-shell paths could
    retain `Set-Cookie` or `Clear-Site-Data` without a successful protected lifecycle.
  - **Evidence:** the 345-test mutation/endpoint selection passes with one final browser-state choke
    for unknown, error, replay, no-JS, enhanced, and successful control responses.

## Refuted or bounded

- The only package advisory is the low-severity esbuild Windows `servedir` traversal; Kovo does not
  invoke the affected standalone serve/servedir path, so dependency presence was not carried.
- A Vite-manifest asset symlink escaping export `--dist` was rejected with KV229 and copied nothing.
- Endpoint auth ordering, CSP report body bounds, replay upload bytes, per-hop egress, stored passive
  file rendering, filesystem exact-key identity, and the PostgreSQL policy/operator closure held in
  the fresh cross-checks.

## Latest verification

The first fresh post-`bugz-26` pass intentionally ended non-zero and produced C1, H1-H4, H7, and
M1-M3. Fixed items above have focused evidence; C1/H1-H4/H7/M1 remain open until their worker commits
are integrated and independently rerun. A second complete fresh sweep is required after that merge.
