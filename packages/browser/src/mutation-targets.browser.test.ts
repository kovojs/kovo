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
});
