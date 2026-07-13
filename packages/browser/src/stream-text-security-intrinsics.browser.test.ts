import { afterEach, expect, it } from 'vitest';

import { applyStreamTextChunks } from './stream-text.js';

const nativeDocumentQuerySelector = Document.prototype.querySelector;
const nativeNodeTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

afterEach(() => {
  Document.prototype.querySelector = nativeDocumentQuerySelector;
  if (nativeNodeTextContent) {
    Object.defineProperty(Node.prototype, 'textContent', nativeNodeTextContent);
  }
  document.body.replaceChildren();
});

function streamTarget(name: string, text: string): HTMLElement {
  const target = document.createElement('p');
  target.setAttribute('data-stream-text', name);
  target.textContent = text;
  document.body.append(target);
  return target;
}

it('pins modular stream-target lookup before authored querySelector replacement', () => {
  const target = streamTarget('revocation:lookup', 'PRIVILEGED');
  const decoy = document.createElement('p');
  decoy.textContent = 'DECOY';
  document.body.append(decoy);

  Document.prototype.querySelector = function poisonedQuerySelector(selector: string) {
    if (selector === '[data-stream-text="revocation:lookup"]') return decoy;
    return Reflect.apply(nativeDocumentQuerySelector, this, [selector]);
  } as typeof Document.prototype.querySelector;

  expect(
    applyStreamTextChunks(document, [
      { mode: 'checkpoint', target: 'revocation:lookup', text: 'ACCESS-REVOKED' },
    ]),
  ).toEqual(['revocation:lookup']);
  expect(target.textContent).toBe('ACCESS-REVOKED');
  expect(decoy.textContent).toBe('DECOY');
});

it('pins modular stream text commits before authored textContent replacement', () => {
  if (!nativeNodeTextContent?.set) throw new Error('native Node.textContent setter unavailable');
  const target = streamTarget('revocation:text', 'PRIVILEGED');
  const nativeSetter = nativeNodeTextContent.set;

  Object.defineProperty(Node.prototype, 'textContent', {
    ...nativeNodeTextContent,
    set(value: string | null) {
      if (this === target) return;
      Reflect.apply(nativeSetter, this, [value]);
    },
  });

  expect(
    applyStreamTextChunks(document, [
      { mode: 'checkpoint', target: 'revocation:text', text: 'ACCESS-REVOKED' },
    ]),
  ).toEqual(['revocation:text']);
  expect(target.textContent).toBe('ACCESS-REVOKED');
});
