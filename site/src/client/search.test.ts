// @ts-nocheck
import { afterEach, describe, expect, it } from 'vitest';

import { query } from './search.js';

class TestElement {
  attributes = new Map<string, string>();
  children: TestElement[] = [];
  parent: TestElement | null = null;
  tagName: string;
  #text = '';

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get textContent(): string {
    return this.#text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.#text = String(value);
    this.children = [];
  }

  get innerHTML(): string {
    return '';
  }

  set innerHTML(value: string) {
    throw new Error(`search renderer used innerHTML: ${value}`);
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children: TestElement[]): void {
    this.children = [];
    this.#text = '';
    this.append(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  scrollIntoView(): void {}

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    const matches: TestElement[] = [];
    const visit = (element: TestElement) => {
      if (element.matches(selector)) matches.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }

  matches(selector: string): boolean {
    if (selector === 'li') return this.tagName === 'li';
    if (selector === 'a') return this.tagName === 'a';
    if (selector === 'a[href]') return this.tagName === 'a' && this.attributes.has('href');
    if (selector === '[data-result-kind]') return this.attributes.has('data-result-kind');
    if (selector === '[data-result-title]') return this.attributes.has('data-result-title');
    if (selector === '[data-result-section]') return this.attributes.has('data-result-section');
    return false;
  }
}

class TestDocument {
  elements = new Map<string, TestElement>();

  createElement(tagName: string): TestElement {
    return new TestElement(tagName);
  }

  getElementById(id: string): TestElement | null {
    return this.elements.get(id) ?? null;
  }
}

function installDom(results: TestElement): void {
  const document = new TestDocument();
  document.elements.set('site-search-results', results);
  globalThis.document = document;
  globalThis.window = { location: { origin: 'https://kovo.dev' } };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.fetch;
  delete globalThis.window;
});

describe('site search renderer', () => {
  it('renders malicious search-index fields as text/attributes and rejects unsafe hrefs', async () => {
    const results = new TestElement('ul');
    installDom(results);
    globalThis.fetch = async () => ({
      async json() {
        return [
          {
            kind: 'api" onclick="alert(1)',
            section: 'Section <img src=x onerror=alert(1)>',
            text: 'needle attr text',
            title: 'Needle <script>alert(1)</script>',
            url: 'javascript:alert(1)',
          },
          {
            kind: 'guide',
            section: 'Safe section',
            text: 'needle href',
            title: 'Needle href',
            url: '/api/?next=javascript:alert(1)#%22%3E%3Cimg%20src=x%3E',
          },
          {
            kind: 'guide',
            section: 'External section',
            text: 'needle external',
            title: 'Needle external',
            url: 'https://attacker.invalid/docs/',
          },
        ];
      },
    });

    await query({ target: { value: 'needle' } });

    expect(results.querySelector('[data-result-title]')?.textContent).toBe(
      'Needle <script>alert(1)</script>',
    );
    expect(results.querySelector('[data-result-section]')?.textContent).toBe(
      'Section <img src=x onerror=alert(1)>',
    );
    expect(results.querySelector('[data-result-kind]')?.getAttribute('data-result-kind')).toBe(
      'api" onclick="alert(1)',
    );

    const hrefs = results
      .querySelectorAll('a')
      .map((link) => link.getAttribute('href'))
      .filter(Boolean);
    expect(hrefs).toEqual(['/api/?next=javascript:alert(1)#%22%3E%3Cimg%20src=x%3E']);
  });
});
