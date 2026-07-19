import { describe, expect, it } from 'vitest';

import { deriveAppGraph } from './graph.js';
import { compileComponentModule } from './index.js';
import { parseComponentModule } from './scan/parse.js';
import { analyzeClientCaptures } from './validate/client-capture.js';

// SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: the named-import handler-closure
// secret-emit channel. A client handler capturing a cross-module import in VALUE position re-emits
// `import { X } from "…"` into `*.client.js`, so the bundler inlines the evaluated secret. The gate
// is whole-channel fail-closed: refuse un-audited value-position captures (KV437), and independently
// refuse executable imports outside the exact reviewed registry (KV201). KV435 covers only the query
// wire; neither diagnostic may leave a partial or unbound generated handler behind.

interface TestExtraFile {
  fileName: string;
  source: string;
}

function compile(source: string, extraFiles: readonly TestExtraFile[] = []) {
  const options = { fileName: 'pay-button.tsx', source, extraFiles } as Parameters<
    typeof compileComponentModule
  >[0] & { extraFiles: readonly TestExtraFile[] };
  return compileComponentModule(options);
}

function clientSource(source: string, extraFiles: readonly TestExtraFile[] = []): string {
  return compile(source, extraFiles).files.find((file) => file.kind === 'client')?.source ?? '';
}

function codes(source: string, extraFiles: readonly TestExtraFile[] = []): string[] {
  return compile(source, extraFiles).diagnostics.map((diagnostic) => diagnostic.code);
}

describe('KV437 client-handler secret-capture gate', () => {
  describe('NEGATIVE: a value-position cross-module capture is refused (KV437) and not emitted', () => {
    it('withholds a captured app.env config secret from the client artifact', () => {
      const source = `
import { component } from '@kovojs/core';
import { app } from './app';

export const PayButton = component({
  render: () => (
    <button onClick={() => fetch('/pay', { body: app.env.PAYMENT_API_KEY })}>Pay</button>
  ),
});
`;

      expect(codes(source)).toContain('KV437');
      const client = clientSource(source);
      expect(client).not.toContain("from './app'");
      expect(client).not.toContain('PAYMENT_API_KEY');
    });

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
      // line the bundler cannot resolve/inline the evaluated secret value. The unreviewed callable
      // independently closes with KV201, so the whole generated handler is omitted.
      const client = clientSource(source);
      expect(client).not.toContain('import { STRIPE_SECRET_KEY }');
      expect(client).not.toContain('../../config/secrets');
      expect(client).not.toContain('sendPayment');
      expect(codes(source)).toContain('KV201');
    });

    it('closes a captured DEFAULT import form with KV201', () => {
      const source = `
import { component } from '@kovojs/core';
import secrets from '../../config/secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => fetch('/pay', { body: secrets })}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV201');
      expect(clientSource(source)).not.toContain("from '../../config/secrets'");
    });

    it('closes a captured NAMESPACE import form with KV201', () => {
      const source = `
import { component } from '@kovojs/core';
import * as secrets from '../../config/secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => fetch('/pay', { body: secrets })}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV201');
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

  describe('reviewed and audited captures', () => {
    it('refuses an arbitrary callee-position client util with KV201', () => {
      const source = `
import { component } from '@kovojs/core';
import { track } from './analytics';

export const Badge = component({
  render: () => (
    <button onClick={() => track('click')}>Track</button>
  ),
});
`;
      expect(codes(source)).toContain('KV201');
      expect(clientSource(source)).not.toContain('./analytics');
    });

    it('allows a publishToClient-wrapped pristine same-file const primitive', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';

const LABEL = 'cart';

export const Badge = component({
  render: () => (
    <button onClick={() => publishToClient(LABEL, { reason: 'label is public' })}>Track</button>
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
      const result = compile(source);
      expect(
        deriveAppGraph({
          components: [
            {
              componentGraphFacts: result.componentGraphFacts,
              publishToClientFacts: result.publishToClientFacts,
            },
          ],
        }).graph.capabilities,
      ).toContainEqual(
        expect.objectContaining({
          justification: 'label is public',
          kind: 'publishToClient',
          target: 'LABEL',
        }),
      );
    });

    it('refuses a publishToClient-wrapped import before its module can execute', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => publishToClient(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' })}>Pay</button>
  ),
});
`;
      expect(codes(source)).toContain('KV437');
      const client = clientSource(source);
      expect(client).not.toContain('import { STRIPE_PUBLISHABLE_KEY } from "./config";');

      const analysis = analyzeClientCaptures(parseComponentModule('pay-button.tsx', source));
      expect(analysis.publishFacts).toEqual([]);

      const result = compile(source);
      expect(result.publishToClientFacts).toEqual([]);
    });

    it('recognizes publishToClient aliases without granting import evaluation authority', () => {
      const source = `
import { component, publishToClient as publish } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => publish(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' })}>Pay</button>
  ),
});
`;
      const result = compile(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain(
        'import { STRIPE_PUBLISHABLE_KEY } from "./config";',
      );
    });

    it('refuses namespace publishToClient calls because namespace authority is not exact', () => {
      const source = `
import { component } from '@kovojs/core';
import * as core from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => core.publishToClient(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' })}>Pay</button>
  ),
});
`;
      const result = compile(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain('./config');
    });

    it('recognizes a re-exported publishToClient without publishing a second import', () => {
      const extraFiles = [
        {
          fileName: 'client-framework.ts',
          source: `export { publishToClient as publish } from '@kovojs/core';`,
        },
      ];
      const source = `
import { component } from '@kovojs/core';
import { publish } from './client-framework';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => publish(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' })}>Pay</button>
  ),
});
`;
      const result = compile(source, extraFiles);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain('./config');
    });

    it('rejects a local publishToClient shadow even when the real import is present', () => {
      const source = `
import { component, publishToClient as realPublishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

function publishToClient<T>(value: T): T {
  return value;
}

export const PayButton = component({
  render: () => (
    <button onClick={() => publishToClient(STRIPE_PUBLISHABLE_KEY)}>Pay</button>
  ),
});

export const AuditButton = component({
  render: () => (
    <button onClick={() => mountStripe(realPublishToClient(STRIPE_PUBLISHABLE_KEY, { reason: 'publishable key is public' }))}>Audit</button>
  ),
});
`;
      const result = compile(source);
      const kv437 = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV437');
      expect(kv437).toHaveLength(2);
      expect(result.publishToClientFacts).toEqual([]);
    });

    it('rejects publishToClient escapes with a missing reason', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => mountStripe(publishToClient(STRIPE_PUBLISHABLE_KEY))}>Pay</button>
  ),
});
`;
      const result = compile(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain(
        'import { STRIPE_PUBLISHABLE_KEY } from "./config";',
      );
    });

    it('rejects publishToClient escapes with an empty reason', () => {
      const source = `
import { component, publishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => publishToClient(STRIPE_PUBLISHABLE_KEY, { reason: '   ' })}>Pay</button>
  ),
});
`;
      const result = compile(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain(
        'import { STRIPE_PUBLISHABLE_KEY } from "./config";',
      );
    });

    it.each([
      ['C0 control', 'reviewed\u0000reason'],
      ['C1 control', 'reviewed\u0085reason'],
      ['bidi override', 'reviewed\u202ereason'],
      ['invisible isolate', 'reviewed\u2066reason'],
      ['unbounded text', 'x'.repeat(4_097)],
    ])('rejects publishToClient escapes with %s in the audit reason', (_label, reason) => {
      const source = `
import { component, publishToClient } from '@kovojs/core';
import { STRIPE_PUBLISHABLE_KEY } from './config';

export const PayButton = component({
  render: () => (
    <button onClick={() => publishToClient(STRIPE_PUBLISHABLE_KEY, { reason: ${JSON.stringify(reason)} })}>Pay</button>
  ),
});
`;
      const result = compile(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
      expect(result.publishToClientFacts).toEqual([]);
      expect(clientSource(source)).not.toContain(
        'import { STRIPE_PUBLISHABLE_KEY } from "./config";',
      );
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

  describe('mixed: one handler captures an unreviewed callee and a value-position secret', () => {
    it('omits the whole handler and reports both closed channels', () => {
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
      expect(client).not.toContain('sendPayment');
      expect(client).not.toContain('import { STRIPE_SECRET_KEY }');
      expect(codes(source).filter((code) => code === 'KV437')).toHaveLength(1);
      expect(codes(source)).toContain('KV201');
    });
  });
});
