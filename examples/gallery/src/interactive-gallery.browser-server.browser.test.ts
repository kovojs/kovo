import { expect, it } from 'vitest';

import {
  renderRouteHtml,
  trustedHtml,
} from '../../../tests/gallery/interactive-gallery.browser-server.js';
import {
  jsx,
  kovoGeneratedComponentControl,
} from '../../../tests/gallery/interactive-gallery.browser-jsx-runtime.js';

it('unwraps only framework-rendered or genuine trusted HTML at the gallery server boundary', async () => {
  // SPEC.md §4.5 and §9.5: the browser harness must preserve the production route-renderer trust
  // boundary so a structural object cannot make executable markup appear safe in gallery tests.
  expect(renderRouteHtml(await jsx('strong', { children: 'rendered & safe' }))).toBe(
    '<strong>rendered &amp; safe</strong>',
  );
  expect(
    renderRouteHtml(
      trustedHtml('<strong data-safe>trusted</strong>', {
        reason: 'gallery rendering test fixture',
      }),
    ),
  ).toBe('<strong data-safe>trusted</strong>');
  expect(renderRouteHtml({ html: '<img src=x onerror=alert(1)>' })).toBe(
    '{"html":"&lt;img src=x onerror=alert(1)&gt;"}',
  );
});

it('unwraps only exact name-bound compiler component-control receipts', async () => {
  // SPEC.md §5.2: generated component controls carry no structural authority. The browser
  // harness mirrors the server runtime's private receipt registry so compiled gallery modules
  // cannot accidentally weaken or drift from the generated JSX ABI exercised in production.
  const click = kovoGeneratedComponentControl('on:click', '/c/account.client.js#open');
  const count = kovoGeneratedComponentControl('data-p-count', 2);
  const disabled = kovoGeneratedComponentControl('data-p-disabled', false);
  const structuralForgery = {
    name: 'on:click',
    value: '/c/attacker.client.js#open',
  };

  expect(
    String(
      await jsx('button', {
        'data-bind:data-state': click,
        'data-forged': structuralForgery,
        'data-p-count': count,
        'data-p-disabled': disabled,
        'on:click': click,
        children: 'Open',
      }),
    ),
  ).toBe(
    '<button data-forged="{&quot;name&quot;:&quot;on:click&quot;,&quot;value&quot;:&quot;/c/attacker.client.js#open&quot;}" data-p-count="2" data-p-disabled="false" on:click="/c/account.client.js#open">Open</button>',
  );

  expect(() => kovoGeneratedComponentControl('kovo-key', 'forged')).toThrow(/supported name/);
  expect(() => kovoGeneratedComponentControl('on:click', structuralForgery)).toThrow(/scalar/);
  expect(() => kovoGeneratedComponentControl('data-kovo-trusted-url:href', false)).toThrow(
    /trusted-URL marker/,
  );
});
