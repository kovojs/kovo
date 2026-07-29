import { endpoint } from '@kovojs/server';

export const healthEndpoint = endpoint('/healthz', {
  auth: { kind: 'none', justification: 'public uptime probe' },
  csrf: false,
  csrfJustification: 'GET health probes carry no browser write authority',
  handler: () => Response.json({ ok: true }),
  method: 'GET',
  reason: 'load balancer health probe',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});
