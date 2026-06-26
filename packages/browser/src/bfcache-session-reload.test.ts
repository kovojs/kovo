import { describe, expect, it, vi } from 'vitest';

import { installBfcacheSessionReload } from './query-visible-return.js';

// SPEC.md §780: the second bfcache defense. A bfcache restore bypasses the loader,
// sessionProvider (§6.5), and the route guard, and some user agents (Safari/WebKit) keep a
// `no-store` page in the in-memory bfcache. So a persisted restore (event.persisted === true)
// of a SESSION-DEPENDENT document — one carrying the per-principal `kovo-session` fingerprint
// meta that document-core stamps only for guarded/session-dependent docs — MUST revalidate with
// a full server reload rather than presenting the prior principal's restored DOM. Anonymous
// documents carry no such meta and stay fully bfcache-eligible.

class FakePageShowTarget {
  listeners = new Map<string, (event: unknown) => void>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

function sessionMetaDocument(sessionDependent: boolean) {
  return {
    querySelector(selector: string) {
      return selector === 'meta[name="kovo-session"]' && sessionDependent
        ? { getAttribute: (name: string) => (name === 'content' ? 'principal-fp' : null) }
        : null;
    },
  };
}

describe('bfcache session reload (SPEC §780)', () => {
  it('reloads a persisted bfcache restore of a session-dependent document', () => {
    const target = new FakePageShowTarget();
    const reload = vi.fn();

    installBfcacheSessionReload({
      document: sessionMetaDocument(true),
      pageShowTarget: target,
      reload,
    });

    // The kovo-session meta is present, so the loader registers the second-defense handler.
    expect(target.listeners.has('pageshow')).toBe(true);

    target.listeners.get('pageshow')?.({ persisted: true, type: 'pageshow' });

    // SPEC §780: a persisted restore re-runs sessionProvider + the guard via a full server GET
    // instead of presenting the restored DOM of the prior principal.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a non-persisted pageshow on a session-dependent document', () => {
    const target = new FakePageShowTarget();
    const reload = vi.fn();

    installBfcacheSessionReload({
      document: sessionMetaDocument(true),
      pageShowTarget: target,
      reload,
    });

    target.listeners.get('pageshow')?.({ persisted: false, type: 'pageshow' });
    target.listeners.get('pageshow')?.({ type: 'pageshow' });

    // SPEC §780: a normal (non-persisted) navigation already ran the loader and sessionProvider,
    // so the second-defense reload must not fire — only `event.persisted === true` reloads.
    expect(reload).not.toHaveBeenCalled();
  });

  it('registers no pageshow handler for an anonymous document (no kovo-session meta)', () => {
    const target = new FakePageShowTarget();
    const reload = vi.fn();

    installBfcacheSessionReload({
      document: sessionMetaDocument(false),
      pageShowTarget: target,
      reload,
    });

    // SPEC §780: anonymous/exportable documents carry no posture, so the handler is a no-op and
    // the page stays fully bfcache-eligible.
    expect(target.listeners.has('pageshow')).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops reloading after disposal', () => {
    const target = new FakePageShowTarget();
    const reload = vi.fn();

    const installed = installBfcacheSessionReload({
      document: sessionMetaDocument(true),
      pageShowTarget: target,
      reload,
    });
    const stale = target.listeners.get('pageshow');

    installed.dispose();
    expect(target.listeners.has('pageshow')).toBe(false);

    stale?.({ persisted: true, type: 'pageshow' });
    expect(reload).not.toHaveBeenCalled();
  });
});
