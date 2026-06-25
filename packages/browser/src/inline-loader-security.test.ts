import { describe, expect, it } from 'vitest';

import {
  dispatchInlineDelegatedClick,
  inlineSourceInstallCases,
} from './inline-loader-test-utils.js';

class BoundTriggerElement {
  attributes: Array<{ name: string; value: string }>;

  constructor(private readonly attrs: Record<string, string>) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): BoundTriggerElement | null {
    if (selector === '[kovo-state]') return Object.hasOwn(this.attrs, 'kovo-state') ? this : null;
    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return trigger && Object.hasOwn(this.attrs, `on:${trigger}`) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  querySelectorAll(): unknown[] {
    return [];
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    const attr = this.attributes.find((attribute) => attribute.name === name);
    if (attr) attr.value = value;
    else this.attributes.push({ name, value });
  }
}

describe('inline loader output security', () => {
  for (const [label, installSource] of inlineSourceInstallCases) {
    it(`${label}: neutralizes unsafe data-bind URL attribute writes`, async () => {
      const element = new BoundTriggerElement({
        'data-bind:action': 'state.url',
        'data-bind:data': 'state.url',
        'data-bind:href': 'state.url',
        'data-bind:ping': 'state.url',
        'data-bind:poster': 'state.url',
        'data-bind:src': 'state.url',
        'data-bind:xlink:href': 'state.url',
        'kovo-state': '{"url":"/safe"}',
        'on:click': '/c/client.js#setUnsafeUrl',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          setUnsafeUrl(_event: unknown, context: { state: { url: string } }) {
            context.state.url = 'javascript:alert(1)';
          },
        }),
        installSource,
      );

      expect(element.getAttribute('action')).toBe('#');
      expect(element.getAttribute('data')).toBe('#');
      expect(element.getAttribute('href')).toBe('#');
      expect(element.getAttribute('ping')).toBe('#');
      expect(element.getAttribute('poster')).toBe('#');
      expect(element.getAttribute('src')).toBe('#');
      expect(element.getAttribute('xlink:href')).toBe('#');
    });

    it(`${label}: suppresses unsafe on* and srcdoc data-bind attribute writes`, async () => {
      const element = new BoundTriggerElement({
        'data-bind:onclick': 'state.handler',
        'data-bind:srcdoc': 'state.srcdoc',
        'kovo-state': '{"handler":"alert(1)","srcdoc":"<script>alert(1)</script>"}',
        'on:click': '/c/client.js#noop',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          noop() {},
        }),
        installSource,
      );

      expect(element.getAttribute('onclick')).toBeNull();
      expect(element.getAttribute('srcdoc')).toBeNull();
    });
  }
});
