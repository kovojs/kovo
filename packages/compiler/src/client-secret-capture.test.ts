import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import { parseComponentModule } from './scan/parse.js';
import { analyzeClientCaptures } from './validate/client-capture.js';

// SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: the named-import handler-closure
// secret-emit channel. A client handler capturing a cross-module import in VALUE position re-emits
// `import { X } from "…"` into `*.client.js`, so the bundler inlines the evaluated secret. The gate
// is whole-channel fail-closed: refuse to emit any value-position captured import (KV437) unless it
// is callee-only client code or wrapped in publishToClient. KV435 covers only the query wire.

function compile(source: string) {
  return compileComponentModule({ fileName: 'pay-button.tsx', source });
}

function clientSource(source: string): string {
  return compile(source).files.find((file) => file.kind === 'client')?.source ?? '';
}

function codes(source: string): string[] {
  return compile(source).diagnostics.map((diagnostic) => diagnostic.code);
}

describe('KV437 client-handler secret-capture gate', () => {
  describe('NEGATIVE: a value-position cross-module capture is refused (KV437) and not emitted', () => {
    it('fires KV437 for a captured NAMED import in call-argument (value) position', () => {
      const source = `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from '../../config/secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      // The secret IMPORT must NOT reach the client bundle: with no `import { STRIPE_SECRET_KEY }`
      // line the bundler cannot resolve/inline the evaluated secret value (the closed channel). The
      // identifier text may survive as a now-unbound reference in the body — but the build fails on
      // the KV437 error, so the broken module never ships, and the secret value is never inlined.
      const client = clientSource(source);
      expect(client).not.toContain('import { STRIPE_SECRET_KEY }');
      expect(client).not.toContain('../../config/secrets');
      // sendPayment is callee-position → still client-safe to emit.
      expect(client).toContain('import { sendPayment } from "./payments";');
    });

    it('fires KV437 for a captured DEFAULT import in value position', () => {
      const source = `
import { component } from '@kovojs/core';
import secrets from '../../config/secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => fetch('/pay', { body: secrets })}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      // Default imports are never modeled into clientImports, so the bundle stays clean either way,
      // but the diagnostic must still fire (the channel is covered, not just the named form).
      expect(clientSource(source)).not.toContain("from '../../config/secrets'");
    });

    it('fires KV437 for a captured NAMESPACE import in value position', () => {
      const source = `
import { component } from '@kovojs/core';
import * as secrets from '../../config/secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => fetch('/pay', { body: secrets })}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
    });

    it('fires KV437 through a barrel/re-export (resolved binding, not surface specifier)', () => {
      // The import laundered through a barrel still produces a captured local binding here.
      const source = `
import { component } from '@kovojs/core';
import { STRIPE_SECRET_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => charge(STRIPE_SECRET_KEY)}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      expect(clientSource(source)).not.toContain('import { STRIPE_SECRET_KEY }');
    });

    it('refuses even a call-wrapped secret (no CallExpression provenance → whole-channel)', () => {
      // The narrow process.env/brand approach is unsound: `loadSecret()` hides the secret behind a
      // call. The whole-channel gate refuses the captured `loadSecret` value-position use anyway.
      const source = `
import { component } from '@kovojs/core';
import { loadSecret } from './secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => publishKey(loadSecret)}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      expect(clientSource(source)).not.toContain('import { loadSecret }');
    });

    it('fires KV437 for a same-file serializable module constant and withholds it', () => {
      const source = `
import { component } from '@kovojs/core';

const LABEL = 'cart';

export const Badge = component({
  render: () => (
    <button onClick={() => log(LABEL)}>Track</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      expect(clientSource(source)).not.toContain("const LABEL = 'cart';");
    });
  });

  describe('POSITIVE: client-safe captures still compile and emit', () => {
    it('emits a callee-position import (ordinary client util) without KV437', () => {
      const source = `
import { component } from '@kovojs/core';
import { track } from './analytics';

export const Badge = component({
  render: () => (
    <button onClick={() => track('click')}>Track</button>
  ),
});
`;
      expect(codes(source)).not.toContain('KV437');
      expect(clientSource(source)).toContain('import { track } from "./analytics";');
    });

    it('allows a publishToClient-wrapped same-file module constant escape', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';

const LABEL = 'cart';

export const Badge = component({
  render: () => (
    <button onClick={() => log(publishToClient(LABEL, { reason: 'label is public' }))}>Track</button>
  ),
});
`;
      expect(codes(source)).not.toContain('KV437');
      const client = clientSource(source);
      expect(client).toContain('import { publishToClient } from "@kovojs/core";');
      expect(clientSource(source)).toContain("const LABEL = 'cart';");

      const analysis = analyzeClientCaptures(parseComponentModule('pay-button.tsx', source));
      expect(analysis.publishFacts).toHaveLength(1);
      expect(analysis.publishFacts[0]).toMatchObject({
        localName: 'LABEL',
        moduleSpecifier: 'pay-button.tsx#module-scope',
        reason: 'label is public',
      });
    });

    it('allows a publishToClient(captured, { reason }) escape: emits and records the fact', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => mountStripe(publishToClient(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' }))}>Pay</button>
  ),
});
`;
      // The audited escape allows emit (no KV437) and the specifier is published to the client.
      expect(codes(source)).not.toContain('KV437');
      const client = clientSource(source);
      expect(client).toContain('import { STRIPE_PUBLISHABLE_KEY } from "./config";');

      // The fact (site + reason) is recorded for `kovo explain --capabilities`.
      const analysis = analyzeClientCaptures(parseComponentModule('pay-button.tsx', source));
      expect(analysis.publishFacts).toHaveLength(1);
      expect(analysis.publishFacts[0]).toMatchObject({
        localName: 'STRIPE_PUBLISHABLE_KEY',
        moduleSpecifier: './config',
        reason: 'publishable key is public',
      });
    });

    it('does not treat a handler-local shadow of an import name as a captured import', () => {
      const source = `
import { component } from '@kovojs/core';
import { secret as secretValue } from './config';

export const Badge = component({
  render: () => (
    <button onClick={() => { const secretValue = 1; return secretValue; }}>Track</button>
  ),
});
`;
      // The local const shadows the import; the import is never captured → no KV437.
      expect(codes(source)).not.toContain('KV437');
    });
  });

  describe('mixed: one handler captures both a callee util and a value-position secret', () => {
    it('emits the util but withholds the secret and fires KV437', () => {
      const source = `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from './secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>
  ),
});
`;
      const client = clientSource(source);
      expect(client).toContain('import { sendPayment } from "./payments";');
      expect(client).not.toContain('import { STRIPE_SECRET_KEY }');
      expect(codes(source).filter((code) => code === 'KV437')).toHaveLength(1);
    });
  });
});
