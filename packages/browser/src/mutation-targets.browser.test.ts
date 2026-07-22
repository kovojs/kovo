import { describe, expect, it } from 'vitest';

import { createBrowserKovoRoot } from './browser-root.js';
import { readLiveTargetSnapshot } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';

describe('mutation target browser security', () => {
  it('uses boot-witnessed DOM reads after a late Element.getAttribute replacement', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-deps', 'public');
    target.setAttribute('kovo-fragment-target', 'public-panel');
    target.setAttribute('kovo-live-component', 'components/public/card');
    target.setAttribute('kovo-live-token', 'tok_public');
    target.setAttribute('kovo-props', '{"scope":"public"}');
    document.body.append(target);

    const getAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getAttribute',
    );
    const querySelectorAllDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'querySelectorAll',
    );
    if (!getAttributeDescriptor || !querySelectorAllDescriptor) {
      throw new Error('DOM target collection descriptors unavailable');
    }
    let poisonHits = 0;
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    let documentSnapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      Object.defineProperty(Element.prototype, 'getAttribute', {
        ...getAttributeDescriptor,
        value(name: string) {
          poisonHits += 1;
          if (name === 'kovo-fragment-target') return 'admin-panel';
          if (name === 'kovo-live-component') return 'components/admin/card';
          if (name === 'kovo-live-token') return 'tok_admin';
          if (name === 'kovo-deps') return 'admin';
          if (name === 'kovo-props') return '{"scope":"admin"}';
          return null;
        },
      });
      Object.defineProperty(Document.prototype, 'querySelectorAll', {
        ...querySelectorAllDescriptor,
        value() {
          poisonHits += 1;
          throw new Error('late Document.querySelectorAll poison reached');
        },
      });
      snapshot = readLiveTargetSnapshot(createBrowserKovoRoot());
      documentSnapshot = readLiveTargetSnapshot(document as unknown as TargetCollectorRoot);
    } finally {
      Object.defineProperty(Element.prototype, 'getAttribute', getAttributeDescriptor);
      Object.defineProperty(Document.prototype, 'querySelectorAll', querySelectorAllDescriptor);
      target.remove();
    }

    // SPEC §6.6 rule 6 / §9.1: the modular runtime uses the DOM controls captured
    // before authored client modules can replace platform methods.
    expect(poisonHits).toBe(0);
    expect(snapshot).toEqual({
      header: 'public-panel=public',
      liveHeader: 'public-panel#components/public/card@tok_public:{"scope":"public"}',
      liveTargets: [
        {
          attestation: 'tok_public',
          component: 'components/public/card',
          props: { scope: 'public' },
          target: 'public-panel',
        },
      ],
      targets: ['public-panel=public'],
    });
    expect(documentSnapshot).toEqual(snapshot);
  });

  it('keeps post-bootstrap prototype facts and toJSON callbacks out of live headers', () => {
    const unattested = document.createElement('section');
    unattested.setAttribute('kovo-deps', 'public');
    unattested.setAttribute('kovo-fragment-target', 'unattested-panel');
    unattested.setAttribute('kovo-live-component', 'components/public/unattested');
    unattested.setAttribute('kovo-props', '{"scope":"public"}');
    const attested = document.createElement('section');
    attested.setAttribute('kovo-deps', 'catalog');
    attested.setAttribute('kovo-fragment-target', 'catalog-panel');
    attested.setAttribute('kovo-live-component', 'components/public/catalog');
    attested.setAttribute('kovo-live-token', 'tok_catalog');
    attested.setAttribute(
      'kovo-props',
      '{"z":1,"nested":{"z":"last","a":[{"z":2,"a":1}]},"a":"first","label":"😀 漢字","line":"\u2028\u2029"}',
    );
    document.body.append(unattested, attested);

    const attestationDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'attestation');
    const toJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let callbackHits = 0;
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      Object.defineProperty(Object.prototype, 'attestation', {
        configurable: true,
        enumerable: true,
        value: 'tok_substituted',
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() {
          callbackHits += 1;
          return { scope: 'admin-substituted' };
        },
      });
      snapshot = readLiveTargetSnapshot(createBrowserKovoRoot());
    } finally {
      if (attestationDescriptor) {
        Object.defineProperty(Object.prototype, 'attestation', attestationDescriptor);
      } else {
        delete (Object.prototype as { attestation?: unknown }).attestation;
      }
      if (toJsonDescriptor) {
        Object.defineProperty(Object.prototype, 'toJSON', toJsonDescriptor);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
      unattested.remove();
      attested.remove();
    }

    expect(callbackHits).toBe(0);
    expect(snapshot?.liveHeader).toBe(
      'catalog-panel#components/public/catalog@tok_catalog:{"a":"first","label":"\\ud83d\\ude00 \\u6f22\\u5b57","line":"\\u2028\\u2029","nested":{"a":[{"a":1,"z":2}],"z":"last"},"z":1}',
    );
    expect(() => new Headers({ 'Kovo-Live-Targets': snapshot?.liveHeader ?? '' })).not.toThrow();
    expect(snapshot?.liveTargets).toHaveLength(2);
    expect(Object.hasOwn(snapshot!.liveTargets[0]!, 'attestation')).toBe(false);
  });
});
