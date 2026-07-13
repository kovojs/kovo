import { expect, it } from 'vitest';

import {
  renderRouteHtml,
  trustedHtml,
} from '../../../tests/gallery/interactive-gallery.browser-server.js';

it('unwraps only genuine trusted HTML at the gallery server boundary', () => {
  // SPEC.md §4.5 and §9.5: the browser harness must preserve the production route-renderer trust
  // boundary so a structural object cannot make executable markup appear safe in gallery tests.
  expect(renderRouteHtml(trustedHtml('<strong data-safe>trusted</strong>'))).toBe(
    '<strong data-safe>trusted</strong>',
  );
  expect(renderRouteHtml({ html: '<img src=x onerror=alert(1)>' })).toBe(
    '{"html":"&lt;img src=x onerror=alert(1)&gt;"}',
  );
});
