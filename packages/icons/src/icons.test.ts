import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import { ArrowRight } from './arrow-right.js';
import { iconRootAttrs } from './icon-base.js';
const generator = fileURLToPath(new URL('../../../scripts/build-icons.mjs', import.meta.url));
describe('@kovojs/icons generation', () => {
  it('committed icons match a fresh generation (deterministic)', () => {
    const out = execFileSync('node', [generator, '--check'], { encoding: 'utf8' });
    expect(out).toContain('up to date');
  });
});
describe('@kovojs/icons rendering', () => {
  it('renders an <svg> with Lucide defaults, decorative by default', () => {
    const html = String(ArrowRight({}));
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('width="24"');
    expect(html).toContain('<path d="M5 12h14"></path>');
    expect(html).toContain('<path d="m12 5 7 7-7 7"></path>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain('role="img"');
  });
  it('promotes to role="img" and drops aria-hidden when given an aria-label', () => {
    const html = String(ArrowRight({ 'aria-label': 'Next' }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Next"');
    expect(html).not.toContain('aria-hidden');
    expect(html).not.toContain('focusable');
  });
  it('forwards id and data-* attributes to the root <svg>', () => {
    const html = String(ArrowRight({ id: 'nav-next', 'data-testid': 'icon' }));
    expect(html).toContain('id="nav-next"');
    expect(html).toContain('data-testid="icon"');
  });
  it('applies the StyleX style channel and concatenates an extra class', () => {
    const styles = style.create(
      { small: { height: 16, width: 16 } },
      { namespace: 'iconTest', source: 'icons.test.ts' },
    );
    const html = String(ArrowRight({ style: styles.small, class: 'extra' }));
    expect(html).toMatch(/class="[^"]*\bextra\b[^"]*"/);
  });
  it('iconRootAttrs is author-wins: an explicit role overrides the decorative default', () => {
    const attrs = iconRootAttrs({ role: 'presentation' });
    expect(attrs.role).toBe('presentation');
    expect(attrs['aria-hidden']).toBeUndefined();
  });
});
