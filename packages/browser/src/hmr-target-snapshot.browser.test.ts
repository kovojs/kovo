import { describe, expect, it } from 'vitest';

import {
  createFrameworkWireTargetCodec,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
} from '@kovojs/core/internal/wire-input-grammar';

import { createHmrTargetSnapshotReader } from './hmr-target-snapshot.js';

describe('HMR target snapshot browser security', () => {
  it('keeps target facts on boot-captured DOM and collection controls after late poisoning', () => {
    const codec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);
    const reader = createHmrTargetSnapshotReader(FRAMEWORK_WIRE_INPUT_GRAMMAR, codec);
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'kovo-build');
    meta.setAttribute('content', 'build-before');
    document.head.append(meta);

    const elements: HTMLElement[] = [];
    const primary = document.createElement('section');
    primary.setAttribute('kovo-deps', 'public inventory');
    primary.setAttribute('kovo-fragment-target', 'catalog-panel');
    primary.setAttribute('kovo-live-component', 'components/public/catalog');
    primary.setAttribute('kovo-live-token', 'tok_catalog');
    primary.setAttribute(
      'kovo-props',
      '{"3":683,"013":{"x":1},"a":2,"del":"\u007f","label":"😀 漢字","line":"\u2028\u2029"}',
    );
    elements.push(primary);
    const unattested = document.createElement('section');
    unattested.setAttribute('kovo-deps', 'public');
    unattested.setAttribute('kovo-fragment-target', 'unattested-panel');
    elements.push(unattested);
    for (let index = 0; index < 62; index += 1) {
      const element = document.createElement('section');
      element.setAttribute('kovo-deps', `query-${index}`);
      element.setAttribute('kovo-fragment-target', `extra-panel-${index}`);
      element.setAttribute('kovo-live-token', `tok_extra_${index}`);
      elements.push(element);
    }
    document.body.append(...elements);

    const querySelectorAll = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'querySelectorAll',
    );
    const NativeArray = Array;
    const arrayConstructor = Object.getOwnPropertyDescriptor(globalThis, 'Array');
    const getAttribute = Object.getOwnPropertyDescriptor(Element.prototype, 'getAttribute');
    const setAttribute = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute');
    const iterator = Object.getOwnPropertyDescriptor(NativeArray.prototype, Symbol.iterator);
    const arrayMethods = ['every', 'filter', 'map', 'push', 'slice'] as const;
    const arrayDescriptors = arrayMethods.map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(NativeArray.prototype, name);
      if (!descriptor) throw new Error(`Missing Array.prototype.${name}`);
      return { descriptor, name };
    });
    const setMethods = ['add', 'has', 'values'] as const;
    const setDescriptors = setMethods.map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(Set.prototype, name);
      if (!descriptor) throw new Error(`Missing Set.prototype.${name}`);
      return { descriptor, name };
    });
    if (!querySelectorAll || !arrayConstructor || !getAttribute || !setAttribute || !iterator) {
      throw new Error('HMR browser intrinsic descriptors unavailable');
    }

    let poisonHits = 0;
    const poison = () => {
      poisonHits += 1;
      throw new Error('late HMR target poison reached');
    };
    let live: ReturnType<typeof reader.liveTargets> | undefined;
    let dependencies: ReturnType<typeof reader.dependencyTargets> | undefined;
    let build = '';
    try {
      Object.defineProperty(Document.prototype, 'querySelectorAll', {
        ...querySelectorAll,
        value: poison,
      });
      Object.defineProperty(Element.prototype, 'getAttribute', {
        ...getAttribute,
        value: poison,
      });
      Object.defineProperty(Element.prototype, 'setAttribute', {
        ...setAttribute,
        value: poison,
      });
      Object.defineProperty(NativeArray.prototype, Symbol.iterator, { ...iterator, value: poison });
      for (let index = 0; index < arrayDescriptors.length; index += 1) {
        const { descriptor, name } = arrayDescriptors[index]!;
        Object.defineProperty(NativeArray.prototype, name, { ...descriptor, value: poison });
      }
      for (let index = 0; index < setDescriptors.length; index += 1) {
        const { descriptor, name } = setDescriptors[index]!;
        Object.defineProperty(Set.prototype, name, { ...descriptor, value: poison });
      }
      Object.defineProperty(globalThis, 'Array', { configurable: true, get: poison });

      live = reader.liveTargets(document);
      dependencies = reader.dependencyTargets(document);
      build = reader.currentBuild(document);
      reader.writeBuild(document, 'build-after');
    } finally {
      Object.defineProperty(globalThis, 'Array', arrayConstructor);
      Object.defineProperty(Document.prototype, 'querySelectorAll', querySelectorAll);
      Object.defineProperty(Element.prototype, 'getAttribute', getAttribute);
      Object.defineProperty(Element.prototype, 'setAttribute', setAttribute);
      Object.defineProperty(NativeArray.prototype, Symbol.iterator, iterator);
      for (const { descriptor, name } of arrayDescriptors) {
        Object.defineProperty(NativeArray.prototype, name, descriptor);
      }
      for (const { descriptor, name } of setDescriptors) {
        Object.defineProperty(Set.prototype, name, descriptor);
      }
      meta.remove();
      for (const element of elements) element.remove();
    }

    expect(poisonHits).toBe(0);
    expect(build).toBe('build-before');
    expect(meta.getAttribute('content')).toBe('build-after');
    expect(live).toHaveLength(63);
    expect(live?.[0]?.wireEntry).toBe(
      'catalog-panel#components%2Fpublic%2Fcatalog@tok_catalog:{"3":683,"013":{"x":1},"a":2,"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57","line":"\\u2028\\u2029"}',
    );
    expect(
      () =>
        new Headers({
          'Kovo-Live-Targets': live?.map(({ wireEntry }) => wireEntry).join('; ') ?? '',
        }),
    ).not.toThrow();
    expect(live?.map(({ wireEntry }) => wireEntry).join('; ')).not.toContain('unattested-panel');
    expect(dependencies).toHaveLength(64);
    expect(dependencies?.slice(0, 2).map(({ wireEntry }) => wireEntry)).toEqual([
      'catalog-panel=public inventory',
      'unattested-panel=public',
    ]);
  });

  it('fails a mixed live-target snapshot atomically when one descriptor exceeds its budget', () => {
    const codec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);
    const reader = createHmrTargetSnapshotReader(FRAMEWORK_WIRE_INPUT_GRAMMAR, codec);
    const valid = document.createElement('section');
    valid.setAttribute('kovo-deps', 'public');
    valid.setAttribute('kovo-fragment-target', 'valid-panel');
    valid.setAttribute('kovo-live-token', 'tok_valid');
    const malformed = document.createElement('section');
    malformed.setAttribute('kovo-deps', 'public');
    malformed.setAttribute('kovo-fragment-target', 'malformed-panel');
    malformed.setAttribute('kovo-live-token', 'tok_malformed');
    malformed.setAttribute('kovo-props', 'x'.repeat(4_097));
    document.body.append(valid, malformed);

    try {
      expect(() => reader.liveTargets(document)).toThrow(/wire budget/u);
    } finally {
      valid.remove();
      malformed.remove();
    }
  });

  it('keeps keyed dependencies structured and rejects duplicate build or dependency identities', () => {
    const codec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);
    const reader = createHmrTargetSnapshotReader(FRAMEWORK_WIRE_INPUT_GRAMMAR, codec);
    const firstMeta = document.createElement('meta');
    firstMeta.setAttribute('name', 'kovo-build');
    firstMeta.setAttribute('content', 'build-before');
    const target = document.createElement('section');
    target.setAttribute('kovo-deps', '!inventory!tenant%3A1 public');
    target.setAttribute('kovo-fragment-target', 'inventory-panel');
    document.head.append(firstMeta);
    document.body.append(target);

    try {
      expect(reader.dependencyTargets(document)).toEqual([
        {
          target: 'inventory-panel',
          wireEntry: 'inventory-panel=!inventory!tenant%3A1 public',
        },
      ]);

      target.setAttribute('kovo-deps', '!inventory!tenant%3A1 !inventory!tenant%3A1');
      expect(() => reader.dependencyTargets(document)).toThrow(/unique/u);

      const duplicateMeta = firstMeta.cloneNode(true);
      document.head.append(duplicateMeta);
      expect(() => reader.currentBuild(document)).toThrow(/exactly one/u);
      expect(() => reader.writeBuild(document, 'build-after')).toThrow(/exact/u);
      duplicateMeta.remove();
    } finally {
      firstMeta.remove();
      target.remove();
    }
  });

  it('accepts only the HMR fragment media type with an inline or absent disposition', () => {
    const codec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);
    const reader = createHmrTargetSnapshotReader(FRAMEWORK_WIRE_INPUT_GRAMMAR, codec);

    expect(
      reader.responseEnvelopeIsFragment('text/vnd.kovo.fragment+html; charset=utf-8', null),
    ).toBe(true);
    expect(reader.responseEnvelopeIsFragment(' TEXT/VND.KOVO.FRAGMENT+HTML ', ' INLINE ')).toBe(
      true,
    );
    expect(reader.responseEnvelopeIsFragment('text/html', null)).toBe(false);
    expect(reader.responseEnvelopeIsFragment('text/vnd.kovo.fragment+html', 'attachment')).toBe(
      false,
    );
    expect(
      reader.responseEnvelopeIsFragment('text/vnd.kovo.fragment+html', 'inline, attachment'),
    ).toBe(false);
  });
});
