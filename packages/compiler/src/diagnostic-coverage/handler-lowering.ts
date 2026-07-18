import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const handlerLoweringDiagnosticCoverage = defineDiagnosticCoverage('handler-lowering', [
  {
    code: 'KV201',
    spec: 'SPEC.md §4.3/§5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'handler-captures-ok.tsx',
        source: `
import { tabsTriggerClick as openPanel } from '@kovojs/headless-ui/tabs';

export const HandlerCapturesOk = component({
  state: () => ({ open: false }),
  render: () => <button onClick={openPanel}>Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'handler-captures-bad.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      }).diagnostics,
  },
  {
    code: 'KV210',
    spec: 'SPEC.md §5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'handler-name-ok.tsx',
        source: `
import { openPanel } from './actions';

export const HandlerNameOk = component({
  state: () => ({ open: false }),
  render: () => <button onClick={openPanel}>Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'handler-name-bad.tsx',
        source: `
export const HandlerNameBad = component({
  state: () => ({ open: false }),
  render: () => <button onClick={() => state.open = true}>Open</button>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV320',
    spec: 'SPEC.md §6.4',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'event-payload-ok.tsx',
        source: `
export function notifyCart(emit) {
  emit('cart:added', { quantity: 1 });
}
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'event-payload-bad.tsx',
        queryShapes: { product: { unitPrice: 'number' } },
        source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
      }).diagnostics,
  },
  {
    code: 'KV437',
    spec: 'SPEC.md §6.2/§6.6',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'client-capture-ok.tsx',
        source: `
import { track } from './analytics';

export const Badge = component({
  render: () => (
    <button onClick={() => track('click')}>Track</button>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'client-capture-bad.tsx',
        source: `
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from './secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV449',
    spec: 'SPEC.md §4.3/§5.2/§6.6/§9.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'finite-security-ir-ok.tsx',
        source: `
export const FiniteSecurityIrOk = component({
  state: () => ({ open: false }),
  render: () => <button onClick={() => { state.open = true; }}>Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'finite-security-ir-bad.tsx',
        source: `
export const FiniteSecurityIrBad = component({
  render: () => <button onClick={() => { event.target.innerHTML = '<script>x</script>'; }}>Open</button>,
});
`,
      }).diagnostics,
  },
]);
