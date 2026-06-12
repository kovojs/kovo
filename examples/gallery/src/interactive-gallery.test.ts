import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const galleryRoot = resolve(import.meta.dirname, '..');

type ClientExports = Record<
  string,
  (
    event: Event,
    ctx: { params: Record<string, unknown>; signal: AbortSignal; state: unknown },
  ) => void
>;

describe('compiled interactive gallery demos', () => {
  it('keeps generated interactive artifacts in sync with app-authored TSX', () => {
    execFileSync(process.execPath, ['scripts/emit-interactive-gallery.mjs', '--check'], {
      cwd: galleryRoot,
      stdio: 'pipe',
    });
  });

  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const disclosure = readGenerated('disclosure-demo.tsx');

    expect(toggle).toContain('data-gallery-interactive="toggle"');
    expect(toggle).toContain('fw-state=\'{"pressed":false}\'');
    expect(toggle).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleDemo\$button_click"/,
    );

    expect(checkbox).toContain('data-gallery-interactive="checkbox"');
    expect(checkbox).toContain('fw-state=\'{"checked":"indeterminate"}\'');
    expect(checkbox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxDemo\$input_click"/,
    );

    expect(disclosure).toContain('data-gallery-interactive="disclosure"');
    expect(disclosure).toContain('fw-state=\'{"open":false}\'');
    expect(disclosure).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/disclosure-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDisclosureDemo\$button_click"/,
    );
  });

  it('executes generated client behavior for the stateful demos', () => {
    const toggle = evaluateClientModule('toggle-demo.client.js');
    const checkbox = evaluateClientModule('checkbox-demo.client.js');
    const disclosure = evaluateClientModule('disclosure-demo.client.js');
    const signal = new AbortController().signal;

    const toggleState = { pressed: false };
    clientHandler(toggle, 'GalleryToggleDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: toggleState,
    });
    expect(toggleState).toEqual({ pressed: true });

    const checkboxState = { checked: 'indeterminate' };
    clientHandler(checkbox, 'GalleryCheckboxDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: checkboxState,
    });
    expect(checkboxState).toEqual({ checked: true });

    const disclosureState = { open: false };
    clientHandler(disclosure, 'GalleryDisclosureDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: disclosureState,
    });
    expect(disclosureState).toEqual({ open: true });
  });
});

function readGenerated(fileName: string): string {
  return readFileSync(resolve(galleryRoot, `src/generated/interactive/${fileName}`), 'utf8');
}

function evaluateClientModule(fileName: string): ClientExports {
  const source = readGenerated(fileName)
    .replace("import { handler } from '@jiso/runtime';\n\n", '')
    .replaceAll('export const ', 'exports.');
  const exports: ClientExports = {};
  vm.runInNewContext(source, {
    exports,
    handler: (fn: ClientExports[string]) => fn,
  });

  return exports;
}

function clientHandler(exports: ClientExports, name: string): ClientExports[string] {
  const fn = exports[name];
  if (fn === undefined) throw new Error(`Missing generated handler export: ${name}`);

  return fn;
}
