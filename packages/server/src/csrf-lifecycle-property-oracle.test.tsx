/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import type { CsrfOptions } from './csrf.js';
import { mutation } from './mutation.js';
import {
  createMemoryMutationReplayStore,
  type MutationReplayStore,
  type MutationReplayResponse,
} from './replay.js';
import { route } from './route.js';
import { s } from './schema.js';

// @kovo-security-property-oracle csrf-mint-deliver-validate-rotate-replay
const ORIGIN = 'https://csrf-oracle.example.test';

interface OracleSession {
  readonly id: string;
  readonly user: { readonly id: string };
}

type OracleRequest = Request & { readonly session?: OracleSession | null };

interface DeliveredForm {
  readonly generation: number;
  readonly idem: string;
  readonly token: string;
}

interface SubmitExpectation {
  readonly execute: boolean;
  readonly replay: boolean;
  readonly status: 303 | 422;
}

class CsrfLifecycleStateModel {
  #generation = 0;
  readonly #committed = new Set<string>();

  delivered(idem: string, token: string): DeliveredForm {
    if (idem === '' || token === '') throw new Error('model requires delivered CSRF and idem');
    return { generation: this.#generation, idem, token };
  }

  rotate(): void {
    this.#generation += 1;
  }

  submit(form: DeliveredForm, origin = ORIGIN): SubmitExpectation {
    if (origin !== ORIGIN || form.generation !== this.#generation) {
      return { execute: false, replay: false, status: 422 };
    }
    const replayKey = `${form.generation}:${form.idem}`;
    if (this.#committed.has(replayKey)) {
      return { execute: false, replay: true, status: 303 };
    }
    this.#committed.add(replayKey);
    return { execute: true, replay: false, status: 303 };
  }
}

describe('CSRF lifecycle state-model property oracle (SPEC §9.1/§10.3)', () => {
  it('models anonymous mint, cookie delivery, validation, rotation, and exact replay', async () => {
    const model = new CsrfLifecycleStateModel();
    const harness = lifecycleHarness({
      csrf: {
        secret: 'anonymous-csrf-property-oracle-secret-0123456789abcdef',
        sessionId: () => undefined,
      },
      mutationKey: 'security-oracle/anonymous-csrf',
    });

    const firstDelivery = await harness.render();
    expect(firstDelivery.response.headers.get('cache-control')).toBe('private, no-store');
    expect(firstDelivery.response.headers.get('vary')).toContain('Cookie');
    const firstCookie = onlyCookiePair(firstDelivery.response);
    const firstForm = model.delivered(firstDelivery.idem, firstDelivery.token);

    const first = await assertSubmitTransition(harness, model, firstForm, firstCookie);
    const replay = await assertSubmitTransition(harness, model, firstForm, firstCookie);
    expect(responseSnapshot(replay)).toEqual(responseSnapshot(first));

    model.rotate();
    const rotatedDelivery = await harness.render();
    const rotatedCookie = onlyCookiePair(rotatedDelivery.response);
    expect(rotatedCookie).not.toBe(firstCookie);
    const rotatedForm = model.delivered(rotatedDelivery.idem, rotatedDelivery.token);

    // Replacing the browser binding is the anonymous rotation event: stale body authority must be
    // rejected before the old idem can become a fresh record in the new binding's replay scope.
    await assertSubmitTransition(harness, model, firstForm, rotatedCookie);
    const rotated = await assertSubmitTransition(harness, model, rotatedForm, rotatedCookie);
    const rotatedReplay = await assertSubmitTransition(harness, model, rotatedForm, rotatedCookie);
    expect(responseSnapshot(rotatedReplay)).toEqual(responseSnapshot(rotated));
    expect(harness.executions).toEqual(['value-g0', 'value-g1']);
  });

  it('rejects a rotated authenticated session token before replay lookup and requires a new mint', async () => {
    const model = new CsrfLifecycleStateModel();
    let activeRotation = 'session-rotation-0';
    const csrf = {
      anonymousCookie: false,
      secret: 'session-csrf-property-oracle-secret-0123456789abcdef',
      sessionId: (request: OracleRequest) => request.session?.id,
    } satisfies CsrfOptions<OracleRequest>;
    const harness = lifecycleHarness({
      csrf,
      mutationKey: 'security-oracle/session-csrf',
      sessionProvider(request) {
        const submitted = cookieValue(request.headers.get('cookie'), 'sid');
        return submitted === activeRotation
          ? { id: activeRotation, user: { id: 'oracle-user' } }
          : null;
      },
    });

    const firstCookie = `sid=${activeRotation}`;
    const firstDelivery = await harness.render(firstCookie);
    expect(firstDelivery.response.headers.getSetCookie()).toEqual([]);
    const firstForm = model.delivered(firstDelivery.idem, firstDelivery.token);
    await assertSubmitTransition(harness, model, firstForm, firstCookie);
    await assertSubmitTransition(harness, model, firstForm, firstCookie);

    model.rotate();
    activeRotation = 'session-rotation-1';
    await assertSubmitTransition(harness, model, firstForm, firstCookie);

    const rotatedCookie = `sid=${activeRotation}`;
    const rotatedDelivery = await harness.render(rotatedCookie);
    const rotatedForm = model.delivered(rotatedDelivery.idem, rotatedDelivery.token);
    await assertSubmitTransition(harness, model, rotatedForm, rotatedCookie);
    await assertSubmitTransition(harness, model, rotatedForm, rotatedCookie);

    expect(harness.executions).toEqual(['value-g0', 'value-g1']);
  });

  it('models the independent Origin floor as a closed transition before replay', async () => {
    const model = new CsrfLifecycleStateModel();
    const harness = lifecycleHarness({
      csrf: {
        secret: 'origin-csrf-property-oracle-secret-0123456789abcdef',
        sessionId: () => undefined,
      },
      mutationKey: 'security-oracle/origin-csrf',
    });
    const delivery = await harness.render();
    const form = model.delivered(delivery.idem, delivery.token);
    const cookie = onlyCookiePair(delivery.response);

    await assertSubmitTransition(harness, model, form, cookie, 'https://attacker.example');
    expect(harness.executions).toEqual([]);
    await assertSubmitTransition(harness, model, form, cookie);
    expect(harness.executions).toEqual(['value-g0']);
  });
});

function lifecycleHarness(options: {
  readonly csrf: CsrfOptions<OracleRequest>;
  readonly mutationKey: string;
  readonly sessionProvider?: (request: Request) => OracleSession | null;
}) {
  const executions: string[] = [];
  const replayEvents: string[] = [];
  const memoryStore = createMemoryMutationReplayStore();
  const replayStore = tracingReplayStore(memoryStore, replayEvents);
  const submit = mutation(options.mutationKey, {
    input: s.object({ value: s.string() }),
    redirectTo: '/csrf-oracle',
    handler(input, _request, context) {
      executions.push(input.value);
      context.setCookie('csrf_oracle_commit', input.value, {
        class: 'app-data',
        path: '/',
        sameSite: 'strict',
      });
      return input;
    },
  });
  const formRoute = route('/csrf-oracle', {
    page: () => (
      <main>
        <form mutation={submit}>
          <input name="value" />
        </form>
      </main>
    ),
  });
  const appOptions = {
    csrf: options.csrf,
    egress: { enabled: false, justification: 'CSRF property oracle performs no outbound I/O' },
    mutationReplayStore: replayStore,
    mutations: [submit],
    routes: [formRoute],
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
  };
  const handler = createRequestHandler(createApp(appOptions));

  return {
    executions,
    replayEvents,
    async render(cookie?: string) {
      const response = await handler(
        new Request(`${ORIGIN}/csrf-oracle`, {
          ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }),
        }),
      );
      const html = await response.text();
      return {
        idem: hiddenValue(html, 'Kovo-Idem'),
        response,
        token: hiddenValue(html, 'kovo-csrf'),
      };
    },
    async submit(form: DeliveredForm, cookie: string, origin = ORIGIN) {
      return await handler(
        new Request(`${ORIGIN}/_m/${options.mutationKey}`, {
          body: new URLSearchParams({
            'Kovo-Idem': form.idem,
            'kovo-csrf': form.token,
            value: `value-g${form.generation}`,
          }),
          headers: { Cookie: cookie, Origin: origin },
          method: 'POST',
        }),
      );
    },
  };
}

async function assertSubmitTransition(
  harness: ReturnType<typeof lifecycleHarness>,
  model: CsrfLifecycleStateModel,
  form: DeliveredForm,
  cookie: string,
  origin = ORIGIN,
): Promise<Response> {
  const expected = model.submit(form, origin);
  const executionCount = harness.executions.length;
  const replayEventCount = harness.replayEvents.length;
  const response = await harness.submit(form, cookie, origin);

  expect(response.status).toBe(expected.status);
  expect(harness.executions.length - executionCount).toBe(expected.execute ? 1 : 0);
  if (expected.status === 422) {
    expect(harness.replayEvents.length).toBe(replayEventCount);
    expect(response.headers.getSetCookie()).toEqual([]);
  } else if (expected.replay) {
    expect(harness.replayEvents.slice(replayEventCount)).toEqual(['get']);
  } else {
    expect(harness.replayEvents.length).toBeGreaterThan(replayEventCount);
  }
  return response;
}

function tracingReplayStore(source: MutationReplayStore, events: string[]): MutationReplayStore {
  return {
    get(key, scope, idem, fingerprint) {
      events.push('get');
      return source.get(key, scope, idem, fingerprint);
    },
    reserve(key, scope, idem, fingerprint) {
      events.push('reserve');
      return source.reserve(key, scope, idem, fingerprint);
    },
    set(key, scope, idem, response: MutationReplayResponse, fingerprint) {
      events.push('set');
      return source.set(key, scope, idem, response, fingerprint);
    },
  };
}

function hiddenValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`, 'u').exec(html);
  if (match?.[1] === undefined) throw new Error(`expected ${name} in rendered form`);
  return match[1];
}

function onlyCookiePair(response: Response): string {
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  const pair = cookies[0]?.split(';', 1)[0];
  if (pair === undefined) throw new Error('expected one delivered CSRF binding cookie');
  return pair;
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const segment of header.split(';')) {
    const [candidate, ...rest] = segment.trim().split('=');
    if (candidate === name) return rest.join('=');
  }
  return undefined;
}

function responseSnapshot(response: Response): object {
  return {
    cacheControl: response.headers.get('cache-control'),
    location: response.headers.get('location'),
    setCookie: response.headers.getSetCookie(),
    status: response.status,
    vary: response.headers.get('vary'),
  };
}
