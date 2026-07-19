import { describe, expect, it } from 'vitest';

import {
  SECURITY_GATE_MUTANTS,
  applyExactMutation,
  runSecurityGateMutationHarness,
} from './security-gate-mutations.mjs';

describe('security-gate-mutations', () => {
  it('pins the exact forcing denominator after finite browser-control enrollment', () => {
    expect(SECURITY_GATE_MUTANTS).toHaveLength(246);
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

  it('executes every finite security-IR mutant against a behavioral compiler oracle', () => {
    const finiteIrMutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('compiler-finite-ir/'),
    );

    expect(finiteIrMutants).toHaveLength(20);
    expect(finiteIrMutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(true);
    expect(finiteIrMutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('executes every Drizzle analyzer-summary mutant against a behavioral verdict oracle', () => {
    const analyzerSummaryMutants = SECURITY_GATE_MUTANTS.filter((mutant) =>
      mutant.name.startsWith('drizzle-analyzer-summary/'),
    );

    expect(analyzerSummaryMutants).toHaveLength(28);
    expect(analyzerSummaryMutants.every((mutant) => mutant.behavioralTypeScript === true)).toBe(
      true,
    );
    expect(analyzerSummaryMutants.some((mutant) => mutant.sourceOnly === true)).toBe(false);
  });

  it('executes framework-identity and compiler-resolution mutants against behavioral verdicts', () => {
    const behavioralNames = [
      'compiler-capability-closure/drop-webrtc-network-global',
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
    expect(tupleNames).toHaveLength(66);
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
  }, 180_000);

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
      'drizzle-analyzer-summary/allow-opp-alias-chain',
      'drizzle-analyzer-summary/drop-carrier-integrity-proof',
      'drizzle-task-b/drop-raw-registration-closure',
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
      'better-auth-credential-gate/drop-source-identity',
      'drizzle-egress/allow-inexact-context-fetch-call',
      'request-ingress/recompute-vercel-prepared-verdict',
      'server-response-posture/drop-endpoint-verification-choke',
      'server-egress/drop-dispatcher-pin',
      'server-egress/drop-origin-before-dns',
      'server-egress/drop-task-context-fetch-seal',
      'server-egress/drop-webhook-context-fetch-seal',
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
