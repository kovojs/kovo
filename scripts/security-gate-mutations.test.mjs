import { describe, expect, it } from 'vitest';

import {
  SECURITY_GATE_BEHAVIORAL_MUTANT_BATCH_SIZE,
  SECURITY_GATE_MUTANTS,
  applyExactMutation,
  planSecurityGateBehavioralMutationBatches,
  runSecurityGateMutationHarness,
} from './security-gate-mutations.mjs';

describe('security-gate-mutations', () => {
  it('pins the exact forcing denominator across the complete security gate', () => {
    expect(SECURITY_GATE_MUTANTS).toHaveLength(492);
  });

  it('enrolls the self-contained verifier parser pack forcing mutant', () => {
    const mutant = SECURITY_GATE_MUTANTS.find(
      (candidate) => candidate.name === 'verifier-pack/drop-runtime-parser-dependency-closure',
    );

    expect(mutant).toMatchObject({
      expectedKiller:
        'the verifier pack must resolve its exact-pinned parser only from authenticated dist bytes',
      sourceOnly: true,
    });
  });

  it('enrolls finite structured-opacity summary forcing mutants', () => {
    const names = [
      'dependency-loader/collapse-structured-opacity-provenance-phase',
      'dependency-loader/drop-direct-local-callable-cache-recheck',
      'dependency-loader/drop-returned-function-self-capture',
      'dependency-loader/drop-structured-opacity-cache-hit-pruning',
      'dependency-loader/drop-structured-opacity-callable-free-captures',
      'dependency-loader/drop-structured-opacity-static-path-identity',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('enrolls computed registry identity and complete TASK B correspondence forcing mutants', () => {
    const expected = [
      'cli-build/drop-pre-evaluation-kv235-enrollment',
      'compiler-authoring/drop-computed-registry-key-closure',
      'drizzle-task-b/drop-complete-terminal-correspondence',
      'drizzle-task-b/drop-duplicate-terminal-trace-closure',
      'drizzle-task-b/drop-same-file-root-reference',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => expected.includes(mutant.name));
    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(expected.sort());
    expect(
      mutants.filter((mutant) => mutant.behavioralTypeScript === true).map((mutant) => mutant.name),
    ).toEqual(
      expect.arrayContaining([
        'compiler-authoring/drop-computed-registry-key-closure',
        'drizzle-task-b/drop-same-file-root-reference',
      ]),
    );
  });

  it('enrolls the CSS-only client artifact boundary forcing mutants', () => {
    const expected = [
      'cli-build/restore-css-collector-server-plugin',
      'cli-build/restore-css-modulepreload-polyfill',
      'compiler-vite/allow-css-collector-server-owner',
      'compiler-vite/drop-css-collector-inert-transform',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => expected.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(expected.sort());
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('enrolls the dependency-loader and Metric E exact-evidence closure mutants', () => {
    const names = [
      'dependency-loader/drop-configured-alias-identity-join',
      'dependency-loader/drop-ambient-global-member-provenance',
      'dependency-loader/drop-callable-module-meta-capture',
      'dependency-loader/drop-authority-escape-closure',
      'dependency-loader/drop-class-superclass-authority-closure',
      'dependency-loader/drop-closed-receiver-constructor-bridge',
      'dependency-loader/drop-constructor-value-call-closure',
      'dependency-loader/drop-dynamic-code-carrier-closure',
      'dependency-loader/drop-direct-safe-timer-precision',
      'dependency-loader/drop-imperative-event-registration-closure',
      'dependency-loader/drop-known-callable-constructor-bridge',
      'dependency-loader/drop-module-meta-url-projection',
      'dependency-loader/drop-module-meta-member-provenance',
      'dependency-loader/drop-module-meta-structured-closure',
      'dependency-loader/drop-superclass-invocation-authority-closure',
      'dependency-loader/drop-structured-return-origin-closure',
      'dependency-loader/drop-structured-opacity-value-reference-filter',
      'dependency-loader/drop-unresolved-ambient-global-provenance',
      'dependency-loader/drop-proved-timer-callback-closure',
      'dependency-loader/drop-url-constructor-alias-closure',
      'dependency-loader/drop-url-base-constructor-join',
      'dependency-loader/drop-url-spread-argument-expansion',
      'dependency-loader/weaken-callable-recursion-closure',
      'dependency-loader/weaken-opaque-template-literal-closure',
      'dependency-loader/widen-browser-carrier-to-server-lane',
      'dependency-loader/widen-browser-static-evaluation-budget',
      'escape-census-baseline/drop-independent-producer-oracle',
      'escape-census-baseline/drop-artifact-subject-recomputation',
      'escape-census-baseline/drop-semantic-root-surplus-closure',
      'escape-census-baseline/read-legacy-handler-root-field',
      'escape-census-gate/drop-audit-identity-control-closure',
      'escape-census-gate/drop-colon-path-closure',
      'escape-census-gate/drop-invisible-path-closure',
      'escape-census-gate/drop-json-report-identity-quoting',
      'escape-census-gate/drop-semantic-root-surplus-closure',
      'escape-census-gate/drop-sink-target-identity-closure',
      'escape-census-gate/read-legacy-handler-root-field',
      'escape-census-gate/weaken-identity-boundary-whitespace',
      'escape-census-emitter/drop-semantic-root-surplus-closure',
      'escape-census-emitter/read-legacy-handler-root-field',
      'escape-census-emitter/drop-closed-root-disposition',
      'escape-census-emitter/widen-sites-across-counted-roots',
      'escape-census-review/drop-duplicate-root-identity-closure',
      'escape-census-review/drop-producer-site-bound',
      'cli-task-b-build/drop-finite-diagnostic-carrier',
      'cli-task-b-build/drop-kv449-finite-diagnostic',
      'cli-task-b-build/drop-kv450-finite-diagnostic',
      'cli-task-b-build/drop-kv452-finite-diagnostic',
      'cli-task-b-build/drop-route-finite-diagnostic-carrier',
      'cli-task-b-build/drop-route-ordinary-diagnostic-carrier',
      'cli-task-b-compile/drop-finite-diagnostic-carrier',
      'cli-task-b-compile/drop-kv449-finite-diagnostic',
      'cli-task-b-compile/drop-kv450-finite-diagnostic',
      'cli-task-b-compile/drop-kv452-finite-diagnostic',
      'cli-task-b-compile/drop-route-finite-diagnostic-carrier',
      'metric-e/trust-embedded-anchor-over-external-policy',
      'metric-e/drop-aggregate-review-verifier',
      'metric-e/drop-aggregate-root-anchor-join',
      'metric-e/drop-external-policy-exact-shape',
      'metric-e/drop-aggregate-evidence-reuse-closure',
      'metric-e/drop-root-evidence-reuse-closure',
      'metric-e/eagerly-stamp-pending-comparability',
      'metric-e/drop-pending-series-null-join',
      'metric-e/allow-nonempty-null-series-lock',
      'metric-e/reuse-pending-null-locks-on-first-append',
      'metric-e/drop-app-package-root-join',
      'metric-e/drop-build-export-comparability-input',
      'metric-e/drop-ceiling-package-denominator',
      'metric-e/drop-code-subject-ancestry-closure',
      'metric-e/drop-compiler-source-tree-comparability',
      'metric-e/drop-core-door-comparability-input',
      'metric-e/drop-runtime-review-verifier',
      'metric-e/drop-exact-series-shape-closure',
      'metric-e/drop-real-calendar-date-closure',
      'metric-e/drop-retained-source-hash-binding',
      'metric-e/drop-retained-source-length-binding',
      'metric-e/drop-retained-source-slice-binding',
      'metric-e/drop-retained-source-verification-wiring',
      'metric-e/qualify-unauthenticated-independent-review',
      'metric-e/weaken-timestamp-order-to-lexicographic',
      'runtime-review/drop-ed25519-key-type-closure',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('bounds behavioral bundle retention without dropping a forcing mutant', () => {
    const expected = SECURITY_GATE_MUTANTS.filter((mutant) => mutant.behavioralTypeScript === true);
    const batches = planSecurityGateBehavioralMutationBatches(SECURITY_GATE_MUTANTS);
    const planned = batches.flat();

    expect(
      batches.every((batch) => batch.length <= SECURITY_GATE_BEHAVIORAL_MUTANT_BATCH_SIZE),
    ).toBe(true);
    expect(planned).toEqual(expected);
    expect(new Set(planned.map((mutant) => mutant.name)).size).toBe(expected.length);
  });

  it('enrolls the dependency-loader graph, HTML, and artifact closure mutants', () => {
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('dependency-loader/'),
    );

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(
      [
        'dependency-loader/allow-bare-bundle-key-collision',
        'dependency-loader/drop-ambient-global-member-provenance',
        'dependency-loader/collapse-structured-opacity-provenance-phase',
        'dependency-loader/drop-authority-escape-closure',
        'dependency-loader/drop-configured-alias-identity-join',
        'dependency-loader/drop-artifact-url-ambiguity-closure',
        'dependency-loader/drop-array-join-coercion-closure',
        'dependency-loader/drop-cjs-loader-alias-closure',
        'dependency-loader/drop-class-superclass-authority-closure',
        'dependency-loader/drop-callable-module-meta-capture',
        'dependency-loader/drop-closed-carrier-constructor-closure',
        'dependency-loader/drop-closed-receiver-constructor-bridge',
        'dependency-loader/drop-constructor-value-call-closure',
        'dependency-loader/drop-constructor-affected-argument-closure',
        'dependency-loader/drop-direct-export-ownership-closure',
        'dependency-loader/drop-direct-local-callable-cache-recheck',
        'dependency-loader/drop-direct-safe-timer-precision',
        'dependency-loader/drop-direct-ssr-external-overlap-closure',
        'dependency-loader/drop-executable-asset-carrier-closure',
        'dependency-loader/drop-dynamic-code-carrier-closure',
        'dependency-loader/drop-external-html-module-closure',
        'dependency-loader/drop-html-base-target-closure',
        'dependency-loader/drop-html-element-control-closure',
        'dependency-loader/drop-html-nested-document-closure',
        'dependency-loader/drop-html-public-shadow-closure',
        'dependency-loader/drop-html-smil-closure',
        'dependency-loader/drop-imperative-event-registration-closure',
        'dependency-loader/drop-invocation-receiver-effect-closure',
        'dependency-loader/drop-known-callable-constructor-bridge',
        'dependency-loader/drop-iteration-assignment-effect-closure',
        'dependency-loader/drop-local-callable-effect-closure',
        'dependency-loader/drop-module-meta-url-projection',
        'dependency-loader/drop-module-meta-member-provenance',
        'dependency-loader/drop-module-meta-structured-closure',
        'dependency-loader/drop-nested-package-boundary-closure',
        'dependency-loader/drop-nonliteral-artifact-closure',
        'dependency-loader/drop-owned-chunk-import-live-identity',
        'dependency-loader/drop-owned-chunk-import-result-closure',
        'dependency-loader/drop-retained-artifact-target-closure',
        'dependency-loader/drop-returned-callable-capture-closure',
        'dependency-loader/drop-returned-function-self-capture',
        'dependency-loader/drop-proved-timer-callback-closure',
        'dependency-loader/drop-reviewed-child-alias-closure',
        'dependency-loader/drop-reviewed-extension-order-closure',
        'dependency-loader/drop-reviewed-module-suffix-closure',
        'dependency-loader/drop-reviewed-worker-constructor-closure',
        'dependency-loader/drop-setter-affected-argument-closure',
        'dependency-loader/drop-ssr-pre-evaluation-module-census',
        'dependency-loader/drop-structured-return-origin-closure',
        'dependency-loader/drop-structured-opacity-cache-hit-pruning',
        'dependency-loader/drop-structured-opacity-callable-free-captures',
        'dependency-loader/drop-structured-opacity-static-path-identity',
        'dependency-loader/drop-structured-opacity-value-reference-filter',
        'dependency-loader/drop-superclass-invocation-authority-closure',
        'dependency-loader/drop-url-constructor-alias-closure',
        'dependency-loader/drop-url-base-constructor-join',
        'dependency-loader/drop-url-spread-argument-expansion',
        'dependency-loader/drop-unsupported-subgraph-suffix-closure',
        'dependency-loader/drop-unsupported-call-target-effect-closure',
        'dependency-loader/drop-unresolved-ambient-global-provenance',
        'dependency-loader/overclose-owned-chunk-import-at-load',
        'dependency-loader/restore-proxy-constructor-argument-exemption',
        'dependency-loader/weaken-callable-recursion-closure',
        'dependency-loader/weaken-opaque-template-literal-closure',
        'dependency-loader/widen-browser-carrier-to-server-lane',
        'dependency-loader/widen-browser-static-evaluation-budget',
        'dependency-loader/widen-bundle-owned-chunk-kind',
      ].sort(),
    );
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('executes the lifecycle private-scope pin mutant against a behavioral runtime oracle', () => {
    const names = [
      'server-lifecycle/allow-mutable-date-guard-args-receipt',
      'server-lifecycle/drop-guard-args-receipt',
      'server-lifecycle/drop-private-scope-carrier-pin',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
  });

  it('enrolls behavioral request-body shape, allocation, and FormData mutants', () => {
    const names = [
      'request-body/drop-formdata-foreach-provenance',
      'request-body-provenance/restore-eager-scalar-boxing',
      'request-body/drop-json-pretag-shape-budget',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('enrolls behavioral replay-isolation and task-authority forcing mutants', () => {
    const names = [
      'mutation-replay/abort-deterministic-nojs-failure',
      'mutation-replay/drop-rejected-selector-promise-drain',
      'mutation-replay/drop-enhanced-delivery-marker-seal',
      'mutation-replay/drop-enhanced-delivery-match',
      'mutation-replay/drop-enhanced-failure-abort-boundary',
      'mutation-replay/drop-explicit-stream-iterator-close',
      'mutation-replay/hash-machine-principal-as-utf8',
      'mutation-replay/release-stream-terminal-before-settlement',
      'mutation-replay/restore-machine-wide-principal-fallback',
      'mutation-replay/restore-nojs-prefixed-namespace',
      'mutation-replay/restore-request-bit-only-stream-delivery',
      'server-task/replace-canonical-internal-origin',
      'server-task/restore-mutation-session-provider',
      'server-task/restore-query-session-provider',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('forces full ingress admission at every pre-app Vite door', () => {
    const names = [
      'server-vite/bypass-graph-full-ingress-admission',
      'server-vite/bypass-live-full-ingress-admission',
      'server-vite/bypass-preload-full-ingress-admission',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('forces full ingress admission before every supported dev-host URL parser', () => {
    const names = [
      'cli-dev/bypass-host-http-full-ingress-admission',
      'cli-dev/bypass-host-websocket-full-ingress-admission',
      'cli-dev/bypass-source-fallback-full-ingress-admission',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.sourceOnly === true)).toBe(true);
  });

  it('executes every finite security-IR mutant against a behavioral compiler oracle', () => {
    const finiteIrMutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('compiler-finite-ir/'),
    );

    expect(finiteIrMutants).toHaveLength(23);
    expect(finiteIrMutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(finiteIrMutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('executes every Drizzle analyzer-summary mutant against a behavioral verdict oracle', () => {
    const analyzerSummaryMutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('drizzle-analyzer-summary/'),
    );

    expect(analyzerSummaryMutants).toHaveLength(32);
    expect(analyzerSummaryMutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(
      true,
    );
    expect(analyzerSummaryMutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('executes framework-identity and compiler-resolution mutants against behavioral verdicts', () => {
    const behavioralNames = [
      'compiler-capability-closure/drop-import-equals-closure',
      'compiler-capability-closure/drop-import-equals-namespace-member-projection',
      'compiler-capability-closure/drop-accessor-invocation-effects',
      'compiler-capability-closure/drop-candidate-overflow-root-widening',
      'compiler-capability-closure/drop-catch-block-lexical-scope',
      'compiler-capability-closure/drop-constructor-and-tag-enrollment',
      'compiler-capability-closure/drop-implicit-execution-fallback',
      'compiler-capability-closure/drop-implicit-invocation-lexical-provenance',
      'compiler-capability-closure/drop-lexical-budget-overflow-roots',
      'compiler-capability-closure/drop-mutable-lexical-root-closure',
      'compiler-capability-closure/drop-opaque-call-result-root-propagation',
      'compiler-capability-closure/drop-transferred-callable-invocation',
      'compiler-capability-closure/drop-unmodeled-call-effects',
      'compiler-capability-closure/drop-webrtc-network-global',
      'compiler-capability-closure/merge-sequential-lexical-writes',
      'compiler-capability-closure/truncate-computed-global-authority',
      'compiler-capability-closure/trust-all-framework-import-call-effects',
      'compiler-capability-closure/widen-relative-data-to-root-carrier',
      'compiler-compile/drop-framework-identity-project-registration',
      'compiler-render-equivalence/drop-project-identity-files',
      'compiler-vite/drop-js-to-ts-sibling-candidates',
      'core-framework-identity/drop-element-access-canonicalization',
      'core-framework-identity/drop-element-access-kind-resolution',
      'core-framework-identity/drop-export-star-resolution',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => behavioralNames.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(behavioralNames.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('enrolls the finite active-content and effective-element-context closure mutants', () => {
    const behavioralNames = [
      'browser-fragment/drop-declarative-shadow-dom-classifier',
      'compiler-output-context/drop-declarative-shadow-dom-closure',
      'compiler-output-context/drop-effective-element-context-closure',
      'runtime-sink/drop-active-embed-denominator-entry',
      'runtime-sink/drop-active-frame-denominator-entry',
      'runtime-sink/drop-active-frameset-denominator-entry',
      'runtime-sink/drop-active-object-denominator-entry',
      'runtime-sink/drop-shadowrootclonable-denominator-entry',
      'runtime-sink/drop-shadowrootdelegatesfocus-denominator-entry',
      'runtime-sink/drop-shadowrootmode-denominator-entry',
      'runtime-sink/drop-shadowrootserializable-denominator-entry',
      'server-jsx/drop-declarative-shadow-dom-runtime-floor',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => behavioralNames.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(behavioralNames.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
    expect(
      SECURITY_GATE_MUTANTS.find(
        (mutant) => mutant.name === 'inline-runtime/drop-declarative-shadow-dom-classifier',
      ),
    ).toEqual(expect.objectContaining({ sourceOnly: true }));
  });

  it('executes opaque form and submitter spread decisions against behavioral oracles', () => {
    const names = [
      'compiler-output-context/drop-reconstructed-submitter-spread-boundary',
      'compiler-output-context/widen-mutation-form-spread-provenance',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => names.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(names.sort());
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('enrolls finite browser-control deletion, inversion, compiler, and runtime mutants', () => {
    const tupleKeys = [
      'script[src]',
      'script[href]',
      'script[xlink:href]',
      'script[type]',
      'script[nomodule]',
      'script[integrity]',
      'script[crossorigin]',
      'script[referrerpolicy]',
      'script[charset]',
      'script[nonce]',
      'script[language]',
      'script[attributionsrc]',
      'style[type]',
      'style[media]',
      'style[nonce]',
      'link[href]',
      'link[rel]',
      'link[type]',
      'link[media]',
      'link[disabled]',
      'link[integrity]',
      'link[crossorigin]',
      'link[referrerpolicy]',
      'link[as]',
      'link[nonce]',
      'iframe[src]',
      'iframe[sandbox]',
      'iframe[allow]',
      'iframe[allowfullscreen]',
      'iframe[allowpaymentrequest]',
      'iframe[browsingtopics]',
      'iframe[credentialless]',
      'iframe[sharedstoragewritable]',
      'iframe[csp]',
      'iframe[referrerpolicy]',
      'iframe[name]',
      'annotation-xml[encoding]',
      'geolocation[autolocate]',
      'geolocation[watch]',
      'geolocation[accuracymode]',
      'a[target]',
      'a[rel]',
      'a[referrerpolicy]',
      'a[ping]',
      'a[attributionsrc]',
      'a[attributiondestination]',
      'a[attributionsourceid]',
      'a[attributionsourcenonce]',
      'area[target]',
      'area[rel]',
      'area[referrerpolicy]',
      'area[ping]',
      'area[attributionsrc]',
      'form[target]',
      'form[rel]',
      'button[formtarget]',
      'input[formtarget]',
      'img[referrerpolicy]',
      'img[crossorigin]',
      'img[attributionsrc]',
      'img[sharedstoragewritable]',
      'audio[crossorigin]',
      'video[crossorigin]',
      'image[crossorigin]',
      'feimage[crossorigin]',
      'meta[name]',
      'meta[http-equiv]',
    ];
    const tupleNames = tupleKeys.map(
      (key) =>
        `runtime-sink/drop-finite-browser-${key
          .replaceAll(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}-tuple`,
    );
    const behavioralNames = [
      'compiler-output-context/drop-iframe-source-sandbox-boundary',
      ...tupleNames,
      'runtime-sink/invert-disabled-browser-control-closure',
      'runtime-sink/drop-iframe-sandbox-allow-forms-token',
      'runtime-sink/drop-iframe-sandbox-combination-closure',
      'runtime-sink/drop-iframe-source-sandbox-boundary',
      'runtime-sink/invert-iframe-sandbox-unknown-token-closure',
    ];
    const mutants = SECURITY_GATE_MUTANTS.filter((mutant) => behavioralNames.includes(mutant.name));

    expect(mutants.map((mutant) => mutant.name).sort()).toEqual(behavioralNames.sort());
    expect(tupleNames).toHaveLength(67);
    expect(mutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(mutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
    const inline = SECURITY_GATE_MUTANTS.find(
      (mutant) => mutant.name === 'inline-runtime/drop-iframe-sandbox-token-vocabulary',
    );
    expect(inline).toEqual(expect.objectContaining({ sourceOnly: true }));
    expect(inline?.behavioralTypeScript).not.toBe(true);
  });

  it('kills every enrolled security gate branch deletion mutant', async () => {
    const results = await runSecurityGateMutationHarness();

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'drizzle-semantic-v2/drop-source-byte-equality',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-semantic-v2/drop-factory-root-reconstruction',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-semantic-v2/drop-helper-callable-span-reconstruction',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-semantic-v2/drop-operation-inventory-reconstruction',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-semantic-v2/drop-closed-sibling-quarantine',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-capability-closure/delete-installed-implementation-digest-comparison',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-capability-closure/invert-installed-implementation-digest-comparison',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-capability-closure/drop-import-equals-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-capability-closure/drop-import-equals-namespace-member-projection',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-capability-closure/drop-webrtc-network-global',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-runtime-executable-reference-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-authored-executable-reference-provenance',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'runtime-sink/drop-dynamic-binding-control-plane-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-output-context/drop-dynamic-generated-control-target-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'inline-runtime/drop-dynamic-binding-control-plane-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'semantic-attributes/drop-generated-mutation-control-entry',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'semantic-attributes/drop-generated-deferred-style-control-entry',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-reviewed-command-door',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-module-storage-factory-provenance',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-storage-stat-read',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/allow-spelled-trusted-assign',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-ambient-error-stability',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/drop-random-uuid-stability',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/allow-unknown-managed-db-continuation',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/allow-foreign-managed-db-argument',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/allow-foreign-project-schema-factory',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-finite-ir/allow-reassigned-project-schema',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-render-equivalence/drop-project-identity-files',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-task-b/restore-static-build-analysis-bypass',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-task-b/drop-raw-registration-closure',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-task-b/drop-capability-root-correspondence',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-task-b/drop-semantic-root-correspondence',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'drizzle-task-b/drop-package-root-correspondence',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'threat-matrix-gate/drop-missing-sink-denominator',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'threat-matrix-gate/drop-missing-audited-escape-denominator',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'threat-matrix-gate/drop-missing-public-surface-denominator',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-missing-real-build-proof',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-security-certification-marker-extractor',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-stale-proof-row-rejection',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-production-build-invocation-check',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'trusted-html-provenance/weaken-call-result-taint-fail-closed',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-required-proof-file-evidence',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-js-to-ts-sibling-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-kv311-island-derive-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-kv435-safe-sibling-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-kv426-trusted-output-safe-sibling-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-kv426-generated-sink-position-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-generated-read-source-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-generated-wrapping-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-generated-paranoid-acceptance-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-sql-guard-env-detector',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-managed-db-throw-invariant',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'sql-safe-handle/drop-managed-raw-driver-escape-denial',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-response-fragment-trustedhtml-route-count',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'server-wire-html/drop-query-wire-body-escaping',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-m5-forbidden-status-enforcement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-closed-row-m1-evidence-enforcement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-dialect-matrix-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drift-resolver-expression-kind-denominator',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-resolver-status-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-resolver-coverage-expectation-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-unknown-resolver-expression-kind-rejection',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-element-access-kind-resolution',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-element-access-canonicalization',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-export-star-resolution',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-compile/drop-framework-identity-project-registration',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-vite/drop-js-to-ts-sibling-candidates',
          status: 'killed',
        }),
      ]),
    );
    expect(results.every((result) => result.status === 'killed')).toBe(true);
    expect(results.length).toBe(SECURITY_GATE_MUTANTS.length);
  }, 900_000);

  it('executes semantic-v2 consumer mutants instead of source-text assertions', () => {
    const semanticV2Mutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('drizzle-semantic-v2/'),
    );

    expect(semanticV2Mutants).toHaveLength(12);
    expect(
      semanticV2Mutants.every(
        (mutant) => mutant.behavioralTypeScript === true && mutant.sourceOnly !== true,
      ),
    ).toBe(true);
  });

  it('executes normalized semantic-graph mutants instead of source-text assertions', () => {
    const semanticGraphMutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('compiler-semantic-graph/'),
    );

    expect(semanticGraphMutants).toHaveLength(13);
    expect(
      semanticGraphMutants.every(
        (mutant) => mutant.behavioralTypeScript === true && mutant.sourceOnly !== true,
      ),
    ).toBe(true);
  });

  it('executes OPP and TASK B boundary mutants instead of source-text assertions', () => {
    const behavioralNames = [
      'drizzle-analyzer-summary/allow-extra-carrier-argument',
      'drizzle-analyzer-summary/allow-accepted-guard-alias-chain',
      'drizzle-analyzer-summary/allow-opaque-accepted-guard-sibling',
      'drizzle-analyzer-summary/allow-opp-alias-chain',
      'drizzle-analyzer-summary/allow-server-value-whole-carrier',
      'drizzle-analyzer-summary/drop-carrier-integrity-proof',
      'drizzle-analyzer-summary/drop-owner-accepted-guard-intersection',
      'drizzle-owner-scope/drop-final-accepted-guard-consumer',
      'drizzle-task-b/drop-capability-root-correspondence',
      'drizzle-task-b/drop-package-root-correspondence',
      'drizzle-task-b/drop-raw-registration-closure',
      'drizzle-task-b/drop-semantic-root-correspondence',
      'drizzle-task-b/restore-static-build-analysis-bypass',
    ];

    for (const name of behavioralNames) {
      const mutant = SECURITY_GATE_MUTANTS.find((candidate) => candidate.name === name);
      expect(mutant).toEqual(expect.objectContaining({ behavioralTypeScript: true, name }));
      expect(mutant?.sourceOnly).not.toBe(true);
    }
  });

  it('executes runtime-boundary mutants instead of source-text assertions', () => {
    const behavioralNames = [
      'better-auth-credential-gate/drop-result-consumer-identity',
      'certificate-verifier/allow-case-folded-node-modules',
      'certificate-verifier/allow-executable-types-condition',
      'certificate-verifier/allow-nested-package-manifest',
      'certificate-verifier/allow-percent-encoded-artifact-path',
      'certificate-verifier/allow-publish-lifecycle',
      'certificate-verifier/drop-analysis-finding-budget-verdict',
      'certificate-verifier/drop-artifact-byte-bound',
      'certificate-verifier/drop-directory-entry-bound',
      'certificate-verifier/drop-artifact-list-bound',
      'certificate-verifier/drop-artifact-total-byte-bound',
      'certificate-verifier/drop-module-reference-budget-verdict',
      'certificate-verifier/drop-portable-bin-shim-closure',
      'certificate-verifier/drop-portable-package-name-closure',
      'certificate-verifier/downgrade-template-import-to-opaque',
      'certificate-verifier/allow-portable-first-party-specifier-alias',
      'certificate-verifier/restore-prefix-only-module-parse',
      'certificate-verifier/restore-conventional-package-resolution',
      'certificate-verifier/restore-iterable-byte-copy',
      'certificate-verifier/restore-source-spelling-artifact-identity',
      'cli-update-docs/restore-live-agent-instruction-fetch',
      'generated-client/drop-security-operation-own-data-boundary',
      'better-auth-credential-gate/drop-source-identity',
      'drizzle-egress/allow-inexact-context-fetch-call',
      'finite-mcp/drop-ready-lifecycle-closure',
      'postgres-authorization-correspondence/allow-null-owner-via-edge',
      'request-ingress/recompute-vercel-prepared-verdict',
      'server-response-posture/drop-endpoint-verification-choke',
      'server-response-posture/drop-revalidated-cache-verdict',
      'server-response-posture/drop-text-media-type-verdict',
      'server-response-posture/restore-substring-cache-directive',
      'server-response-posture/restore-word-boundary-media-type',
      'server-response-posture/weaken-plain-text-media-type-verdict',
      'server-method/restore-endpoint-extension-uppercase-alias',
      'server-method/restore-shell-extension-uppercase-alias',
      'server-egress/drop-dispatcher-pin',
      'server-egress/drop-framework-owned-connect-carrier-snapshot',
      'server-egress/drop-implicit-localhost-carrier-classification',
      'server-egress/drop-native-agent-options-overlay',
      'server-egress/drop-origin-before-dns',
      'server-egress/drop-task-context-fetch-seal',
      'server-egress/drop-webhook-context-fetch-seal',
      'server-egress/restore-caller-owned-agent-request-forward',
      'server-egress/restore-hostname-host-classification-mismatch',
      'server-egress/restore-resolver-owned-lookup-result-forward',
      'server-wire-html/drop-query-wire-body-escaping',
      'sql-safe-handle/drop-managed-raw-driver-escape-denial',
      'trusted-html-provenance/weaken-call-result-taint-fail-closed',
    ];

    for (const name of behavioralNames) {
      const mutant = SECURITY_GATE_MUTANTS.find((candidate) => candidate.name === name);
      expect(mutant).toEqual(expect.objectContaining({ behavioralTypeScript: true, name }));
      expect(mutant?.sourceOnly).not.toBe(true);
    }
  });

  it('reports a surviving mutant when the branch mutation is a no-op', async () => {
    const noopMutant = {
      ...SECURITY_GATE_MUTANTS[0],
      name: 'security-test-build-gate/noop-missing-real-build-proof',
      replacement: SECURITY_GATE_MUTANTS[0].search,
    };

    await expect(runSecurityGateMutationHarness({ mutants: [noopMutant] })).resolves.toEqual([
      expect.objectContaining({
        name: 'security-test-build-gate/noop-missing-real-build-proof',
        status: 'survived',
      }),
    ]);
  });

  it('requires exact mutation targets so branch drift is not silently skipped', () => {
    expect(() =>
      applyExactMutation('const notTheBranch = true;', SECURITY_GATE_MUTANTS[0]),
    ).toThrow('mutation target was not found');
  });
});
