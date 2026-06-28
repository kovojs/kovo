import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileComponentModule } from '@kovojs/compiler';
import { describe, expect, it, vi } from 'vitest';

import { main } from './index.js';
import {
  availableAddComponents,
  vendoredUiComponentSource,
  vendoredUiComponents,
} from './add-catalog.js';

function importsUiPackage(source: string): boolean {
  const uiPackage = /['"]@kovojs\/ui(?:\/[^'"]*)?['"]/;
  return (
    new RegExp(`^\\s*import\\s+(?:type\\s+)?[^;]*?\\s+from\\s+${uiPackage.source}`, 'm').test(
      source,
    ) || new RegExp(`^\\s*import\\s*\\(\\s*${uiPackage.source}`, 'm').test(source)
  );
}

function requiredKovoPackageDependencies(source: string): readonly string[] {
  const sourceWithoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [
    ...new Set(
      [...sourceWithoutComments.matchAll(/['"](@kovojs\/[^/'"]+)(?:\/[^'"]*)?['"]/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

describe('kovo add', () => {
  it('keeps the vendored UI catalog synchronized with @kovojs/ui package source', () => {
    expect(availableAddComponents()).toBe(
      'accordion, alert, alert-dialog, autocomplete, avatar, badge, breadcrumb, button, card, checkbox, checkbox-group, collapsible, combobox, command, context-menu, dialog, disclosure, drawer, dropdown-menu, field, hover-card, kbd, menubar, meter, navigation-menu, number-field, otp-field, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, toast, toggle, toggle-group, toolbar, tooltip',
    );

    const manifest = JSON.parse(
      readFileSync(new URL('../../ui/package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, string>;
      kovo: { vendoredSource: boolean; vendoredSourceHashes: Record<string, string> };
      name: string;
      version: string;
    };
    const cliManifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    const exportedComponents = Object.keys(manifest.exports)
      .filter((subpath) => subpath !== '.')
      .map((subpath) => subpath.slice(2))
      .sort();

    expect(cliManifest.dependencies['@kovojs/ui']).toBe('workspace:*');
    expect(manifest.name).toBe('@kovojs/ui');
    expect(manifest.kovo.vendoredSource).toBe(true);
    expect(Object.keys(vendoredUiComponents).sort()).toEqual(exportedComponents);

    for (const [name, entry] of Object.entries(vendoredUiComponents)) {
      expect(entry.fileName).toBe(`${name}.tsx`);
      expect(entry.packageVersion).toBe(manifest.version);
      expect(entry.requiredPackageDependencies).toEqual(
        requiredKovoPackageDependencies(entry.source),
      );
      expect(entry.sourceHash).toBe(manifest.kovo.vendoredSourceHashes[name]);
      expect(entry.sourceHash).toMatch(/^sha256-/);
      expect(entry.source).toBe(
        vendoredUiComponentSource(
          readFileSync(new URL(`../../ui/src/${name}.tsx`, import.meta.url), 'utf8'),
        ),
      );
      expect(entry.source).toMatch(/import\s+\{[^}]*\bcomponent\b[^}]*\}\s+from '@kovojs\/core';/);
      expect(entry.source).toContain('component({');
      expect(importsUiPackage(entry.source)).toBe(false);
      expect(entry.source).not.toContain('@kovojs/server/internal');
      expect(entry.source).not.toContain("from './pass-through.js'");
      expect(entry.source).not.toContain("from './theme.js'");
      expect(entry.source).not.toContain('kovo-c=');
      expect(entry.source).not.toContain('data-bind=');
    }
  });

  it('surfaces missing package dependencies for copied dialog source', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-add-cli-'));
    const outDir = join(root, 'src/components/ui');
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: {
            '@kovojs/core': '0.1.3',
            '@kovojs/style': '0.1.3',
            '@kovojs/ui': '0.1.3',
          },
          packageManager: 'pnpm@10.12.1',
          type: 'module',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(vendoredUiComponents.dialog.requiredPackageDependencies).toEqual([
        '@kovojs/core',
        '@kovojs/headless-ui',
        '@kovojs/style',
      ]);

      expect(main(['add', 'dialog', '--out', outDir])).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain(
        `ADD dialog path=${JSON.stringify(join(outDir, 'dialog.tsx'))} source=tsx package=@kovojs/ui@`,
      );
      expect(output).toContain(
        'DEPENDENCIES status=missing packages=@kovojs/headless-ui install="pnpm add @kovojs/headless-ui"',
      );
      expect(readFileSync(join(outDir, 'dialog.tsx'), 'utf8')).toContain(
        "from '@kovojs/headless-ui/dialog';",
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not print dependency instructions when copied component imports are already declared', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-add-cli-'));
    const outDir = join(root, 'src/components/ui');
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: {
            '@kovojs/core': '0.1.3',
            '@kovojs/headless-ui': '0.1.3',
            '@kovojs/style': '0.1.3',
            '@kovojs/ui': '0.1.3',
          },
          packageManager: 'pnpm@10.12.1',
          type: 'module',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'dialog', '--out', outDir])).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain(`ADD dialog path=${JSON.stringify(join(outDir, 'dialog.tsx'))}`);
      expect(output).not.toContain('DEPENDENCIES status=missing');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('compiles vendored catalog entries as app-authored TSX without KV235', () => {
    for (const [name, entry] of Object.entries(vendoredUiComponents)) {
      const result = compileComponentModule({
        fileName: `src/components/ui/${entry.fileName}`,
        source: entry.source,
      });

      expect(result.diagnostics, name).not.toContainEqual(
        expect.objectContaining({ code: 'KV235' }),
      );
      expect(result.diagnostics, name).toEqual([]);
    }
  });

  it('vendors package-synchronized components as TSX app source', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-add-cli-'));
    const outDir = join(root, 'src/components/ui');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(
        main([
          'add',
          'accordion',
          'alert',
          'autocomplete',
          'avatar',
          'badge',
          'breadcrumb',
          'button',
          'card',
          'checkbox',
          'checkbox-group',
          'combobox',
          'command',
          'context-menu',
          'dropdown-menu',
          'kbd',
          'menubar',
          'meter',
          'navigation-menu',
          'progress',
          'radio-group',
          'scroll-area',
          'select',
          'separator',
          'sheet',
          'skeleton',
          'slider',
          'switch',
          'table',
          'tabs',
          'toggle',
          'toggle-group',
          'toast',
          'toolbar',
          '--out',
          outDir,
        ]),
      ).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-add/v1\n');
      expect(output).toContain(
        `ADD accordion path=${JSON.stringify(join(outDir, 'accordion.tsx'))} source=tsx package=@kovojs/ui@`,
      );
      expect(output).toContain('sourceHash=sha256-');
      expect(output).toContain(
        `ADD alert path=${JSON.stringify(join(outDir, 'alert.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD autocomplete path=${JSON.stringify(join(outDir, 'autocomplete.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD avatar path=${JSON.stringify(join(outDir, 'avatar.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD badge path=${JSON.stringify(join(outDir, 'badge.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD breadcrumb path=${JSON.stringify(join(outDir, 'breadcrumb.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD button path=${JSON.stringify(join(outDir, 'button.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD card path=${JSON.stringify(join(outDir, 'card.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD checkbox path=${JSON.stringify(join(outDir, 'checkbox.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD checkbox-group path=${JSON.stringify(join(outDir, 'checkbox-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD combobox path=${JSON.stringify(join(outDir, 'combobox.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD command path=${JSON.stringify(join(outDir, 'command.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD context-menu path=${JSON.stringify(join(outDir, 'context-menu.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD dropdown-menu path=${JSON.stringify(join(outDir, 'dropdown-menu.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD kbd path=${JSON.stringify(join(outDir, 'kbd.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD menubar path=${JSON.stringify(join(outDir, 'menubar.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD meter path=${JSON.stringify(join(outDir, 'meter.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD navigation-menu path=${JSON.stringify(join(outDir, 'navigation-menu.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD progress path=${JSON.stringify(join(outDir, 'progress.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD radio-group path=${JSON.stringify(join(outDir, 'radio-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD scroll-area path=${JSON.stringify(join(outDir, 'scroll-area.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD select path=${JSON.stringify(join(outDir, 'select.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD separator path=${JSON.stringify(join(outDir, 'separator.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD sheet path=${JSON.stringify(join(outDir, 'sheet.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD skeleton path=${JSON.stringify(join(outDir, 'skeleton.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD slider path=${JSON.stringify(join(outDir, 'slider.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD switch path=${JSON.stringify(join(outDir, 'switch.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD table path=${JSON.stringify(join(outDir, 'table.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD tabs path=${JSON.stringify(join(outDir, 'tabs.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toggle path=${JSON.stringify(join(outDir, 'toggle.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toggle-group path=${JSON.stringify(join(outDir, 'toggle-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toast path=${JSON.stringify(join(outDir, 'toast.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toolbar path=${JSON.stringify(join(outDir, 'toolbar.tsx'))} source=tsx`,
      );

      const accordion = readFileSync(join(outDir, 'accordion.tsx'), 'utf8');
      const alert = readFileSync(join(outDir, 'alert.tsx'), 'utf8');
      const autocomplete = readFileSync(join(outDir, 'autocomplete.tsx'), 'utf8');
      const avatar = readFileSync(join(outDir, 'avatar.tsx'), 'utf8');
      const badge = readFileSync(join(outDir, 'badge.tsx'), 'utf8');
      const breadcrumb = readFileSync(join(outDir, 'breadcrumb.tsx'), 'utf8');
      const button = readFileSync(join(outDir, 'button.tsx'), 'utf8');
      const card = readFileSync(join(outDir, 'card.tsx'), 'utf8');
      const checkbox = readFileSync(join(outDir, 'checkbox.tsx'), 'utf8');
      const checkboxGroup = readFileSync(join(outDir, 'checkbox-group.tsx'), 'utf8');
      const combobox = readFileSync(join(outDir, 'combobox.tsx'), 'utf8');
      const command = readFileSync(join(outDir, 'command.tsx'), 'utf8');
      const contextMenu = readFileSync(join(outDir, 'context-menu.tsx'), 'utf8');
      const dropdownMenu = readFileSync(join(outDir, 'dropdown-menu.tsx'), 'utf8');
      const kbd = readFileSync(join(outDir, 'kbd.tsx'), 'utf8');
      const menubar = readFileSync(join(outDir, 'menubar.tsx'), 'utf8');
      const meter = readFileSync(join(outDir, 'meter.tsx'), 'utf8');
      const navigationMenu = readFileSync(join(outDir, 'navigation-menu.tsx'), 'utf8');
      const progress = readFileSync(join(outDir, 'progress.tsx'), 'utf8');
      const radioGroup = readFileSync(join(outDir, 'radio-group.tsx'), 'utf8');
      const scrollArea = readFileSync(join(outDir, 'scroll-area.tsx'), 'utf8');
      const select = readFileSync(join(outDir, 'select.tsx'), 'utf8');
      const separator = readFileSync(join(outDir, 'separator.tsx'), 'utf8');
      const sheet = readFileSync(join(outDir, 'sheet.tsx'), 'utf8');
      const skeleton = readFileSync(join(outDir, 'skeleton.tsx'), 'utf8');
      const slider = readFileSync(join(outDir, 'slider.tsx'), 'utf8');
      const switchSource = readFileSync(join(outDir, 'switch.tsx'), 'utf8');
      const table = readFileSync(join(outDir, 'table.tsx'), 'utf8');
      const tabs = readFileSync(join(outDir, 'tabs.tsx'), 'utf8');
      const toggle = readFileSync(join(outDir, 'toggle.tsx'), 'utf8');
      const toggleGroup = readFileSync(join(outDir, 'toggle-group.tsx'), 'utf8');
      const toast = readFileSync(join(outDir, 'toast.tsx'), 'utf8');
      const toolbar = readFileSync(join(outDir, 'toolbar.tsx'), 'utf8');
      expect(accordion).toContain('export const Accordion = component({');
      expect(accordion).toContain("import * as style from '@kovojs/style';");
      expect(accordion).toContain('export const accordionStyles = style.create');
      expect(accordion).toContain('styles?: AccordionStyleOverrides');
      expect(alert).toContain('export const Alert = component({');
      expect(alert).toContain("import * as style from '@kovojs/style';");
      expect(alert).toContain('export const alertStyles =');
      expect(alert).toContain('style?: style.StyleInput');
      expect(autocomplete).toContain('export const Autocomplete = component({');
      expect(autocomplete).toContain("import * as style from '@kovojs/style';");
      expect(autocomplete).toContain('export const autocompleteStyles = style.create');
      expect(autocomplete).toContain('styles?: AutocompleteStyleOverrides');
      expect(avatar).toContain('export const Avatar = component({');
      expect(avatar).toContain("import * as style from '@kovojs/style';");
      expect(avatar).toContain('export const avatarStyles = style.create');
      expect(avatar).toContain('styles?: AvatarStyleOverrides');
      expect(badge).toContain('export const Badge = component({');
      expect(badge).toContain("import * as style from '@kovojs/style';");
      expect(badge).toContain('export const badgeStyles =');
      expect(badge).toContain('style?: style.StyleInput');
      expect(breadcrumb).toContain('export const Breadcrumb = component({');
      expect(breadcrumb).toContain("import * as style from '@kovojs/style';");
      expect(breadcrumb).toContain('export const breadcrumbStyles = style.create');
      expect(breadcrumb).toContain('styles?: BreadcrumbStyleOverrides');
      expect(button).toContain("import { component } from '@kovojs/core';");
      expect(button).toContain("import * as style from '@kovojs/style';");
      expect(button).toContain('export const Button = component({');
      expect(button).toContain('export const buttonStyles = {');
      expect(button).toContain('style.attrs(');
      expect(card).toContain('export const Card = component({');
      expect(card).toContain("import * as style from '@kovojs/style';");
      expect(card).toContain('export const cardStyles = style.create');
      expect(card).toContain('style?: style.StyleInput');
      expect(checkbox).toContain('export const Checkbox = component({');
      expect(checkbox).toContain("import * as style from '@kovojs/style';");
      expect(checkbox).toContain('export const checkboxStyles = style.create');
      expect(checkbox).toContain('styles?: CheckboxStyleOverrides');
      expect(checkboxGroup).toContain('export const CheckboxGroup = component({');
      expect(checkboxGroup).toContain("import * as style from '@kovojs/style';");
      expect(checkboxGroup).toContain('export const checkboxGroupStyles = style.create');
      expect(checkboxGroup).toContain('styles?: CheckboxGroupStyleOverrides');
      expect(combobox).toContain('export const Combobox = component({');
      expect(combobox).toContain("import * as style from '@kovojs/style';");
      expect(combobox).toContain('export const comboboxStyles = style.create');
      expect(combobox).toContain('styles?: ComboboxStyleOverrides');
      expect(command).toContain('export const Command = component({');
      expect(command).toContain("import * as style from '@kovojs/style';");
      expect(command).toContain('export const commandStyles = style.create');
      expect(command).toContain('styles?: CommandStyleOverrides');
      expect(contextMenu).toContain('export const ContextMenu = component({');
      expect(contextMenu).toContain("import * as style from '@kovojs/style';");
      expect(contextMenu).toContain('export const contextMenuStyles = style.create');
      expect(contextMenu).toContain('styles?: ContextMenuStyleOverrides');
      expect(dropdownMenu).toContain('export const DropdownMenu = component({');
      expect(dropdownMenu).toContain("import * as style from '@kovojs/style';");
      expect(dropdownMenu).toContain('export const dropdownMenuStyles = style.create');
      expect(dropdownMenu).toContain('styles?: DropdownMenuStyleOverrides');
      expect(kbd).toContain('export const Kbd = component({');
      expect(kbd).toContain("import * as style from '@kovojs/style';");
      expect(kbd).toContain('export const kbdStyles = style.create');
      expect(kbd).toContain('style?: style.StyleInput');
      expect(menubar).toContain('export const Menubar = component({');
      expect(menubar).toContain("import * as style from '@kovojs/style';");
      expect(menubar).toContain('export const menubarStyles = style.create');
      expect(menubar).toContain('styles?: MenubarStyleOverrides');
      expect(meter).toContain('export const Meter = component({');
      expect(meter).toContain("import * as style from '@kovojs/style';");
      expect(meter).toContain('export const meterStyles = style.create');
      expect(meter).toContain('style?: style.StyleInput');
      expect(navigationMenu).toContain('export const NavigationMenu = component({');
      expect(navigationMenu).toContain("import * as style from '@kovojs/style';");
      expect(navigationMenu).toContain('export const navigationMenuStyles = style.create');
      expect(navigationMenu).toContain('styles?: NavigationMenuStyleOverrides');
      expect(progress).toContain('export const Progress = component({');
      expect(progress).toContain("import * as style from '@kovojs/style';");
      expect(progress).toContain('export const progressStyles = style.create');
      expect(progress).toContain('style?: style.StyleInput');
      expect(radioGroup).toContain('export const RadioGroup = component({');
      expect(radioGroup).toContain("import * as style from '@kovojs/style';");
      expect(radioGroup).toContain('export const radioGroupStyles = style.create');
      expect(radioGroup).toContain('styles?: RadioGroupStyleOverrides');
      expect(select).toContain('export const Select = component({');
      expect(select).toContain("import * as style from '@kovojs/style';");
      expect(select).toContain('export const selectStyles = style.create');
      expect(select).toContain('styles?: SelectStyleOverrides');
      expect(scrollArea).toContain('export const ScrollArea = component({');
      expect(scrollArea).toContain("import * as style from '@kovojs/style';");
      expect(scrollArea).toContain('export const scrollAreaStyles = style.create');
      expect(scrollArea).toContain('styles?: ScrollAreaStyleOverrides');
      expect(separator).toContain('export const Separator = component({');
      expect(separator).toContain("import * as style from '@kovojs/style';");
      expect(separator).toContain('export const separatorStyles =');
      expect(separator).toContain('style?: style.StyleInput');
      expect(sheet).toContain('export const Sheet = component({');
      expect(sheet).toContain("import * as style from '@kovojs/style';");
      expect(sheet).toContain('export const sheetStyles = style.create');
      expect(sheet).toContain('styles?: SheetStyleOverrides');
      expect(skeleton).toContain('export const Skeleton = component({');
      expect(skeleton).toContain("import * as style from '@kovojs/style';");
      expect(skeleton).toContain('export const skeletonStyles = style.create');
      expect(skeleton).toContain('backgroundColor: style.tokens.sys.color.outlineVariant');
      expect(skeleton).toContain('style?: style.StyleInput');
      expect(slider).toContain('export const Slider = component({');
      expect(slider).toContain("import * as style from '@kovojs/style';");
      expect(slider).toContain('export const sliderStyles = style.create');
      expect(slider).toContain('styles?: SliderStyleOverrides');
      expect(switchSource).toContain('export const Switch = component({');
      expect(switchSource).toContain("import * as style from '@kovojs/style';");
      expect(switchSource).toContain('export const switchStyles = style.create');
      expect(switchSource).toContain('styles?: SwitchStyleOverrides');
      expect(table).toContain('export const Table = component({');
      expect(table).toContain('export const TableHead = component({');
      expect(table).toContain("import * as style from '@kovojs/style';");
      expect(table).toContain('export const tableStyles = style.create');
      expect(table).toContain('styles?: TableStyleOverrides');
      expect(tabs).toContain("import * as style from '@kovojs/style';");
      expect(tabs).toContain('export const tabsStyles = style.create');
      expect(tabs).toContain('styles?: TabsStyleOverrides');
      expect(toggle).toContain('export const Toggle = component({');
      expect(toggle).toContain("import * as style from '@kovojs/style';");
      expect(toggle).toContain('export const toggleStyles =');
      expect(toggle).toContain('style?: style.StyleInput');
      expect(toggleGroup).toContain('export const ToggleGroup = component({');
      expect(toggleGroup).toContain("import * as style from '@kovojs/style';");
      expect(toggleGroup).toContain('export const toggleGroupStyles = style.create');
      expect(toggleGroup).toContain('styles?: ToggleGroupStyleOverrides');
      expect(toast).toContain('export const Toast = component({');
      expect(toast).toContain("import * as style from '@kovojs/style';");
      expect(toast).toContain('export const toastStyles = style.create');
      expect(toast).toContain('styles?: ToastStyleOverrides');
      expect(toolbar).toContain('export const Toolbar = component({');
      expect(toolbar).toContain("import * as style from '@kovojs/style';");
      expect(toolbar).toContain('export const toolbarStyles = style.create');
      expect(toolbar).toContain('styles?: ToolbarStyleOverrides');
      const vendoredSource = [
        accordion,
        alert,
        autocomplete,
        avatar,
        badge,
        breadcrumb,
        button,
        card,
        checkbox,
        checkboxGroup,
        combobox,
        command,
        contextMenu,
        dropdownMenu,
        kbd,
        menubar,
        meter,
        navigationMenu,
        progress,
        radioGroup,
        scrollArea,
        select,
        separator,
        sheet,
        skeleton,
        slider,
        switchSource,
        table,
        toggle,
        toggleGroup,
        toast,
        toolbar,
      ].join('\n');
      expect(importsUiPackage(vendoredSource)).toBe(false);
      expect(vendoredSource).not.toContain('kovo-c=');
      expect(vendoredSource).not.toContain('data-bind=');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('is idempotent when the vendored component is already current', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-add-cli-'));
    const outDir = join(root, 'ui');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'button', '--out', outDir])).toBe(0);
      stdout.mockClear();

      expect(main(['add', 'button', '--out', outDir])).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `SKIP button path=${JSON.stringify(join(outDir, 'button.tsx'))} reason=already-current`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses unknown components with stable output', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'calendar'])).toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
        'kovo: unknown component "calendar". available: accordion, alert, alert-dialog, autocomplete, avatar, badge, breadcrumb, button, card, checkbox, checkbox-group, collapsible, combobox, command, context-menu, dialog, disclosure, drawer, dropdown-menu, field, hover-card, kbd, menubar, meter, navigation-menu, number-field, otp-field, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, toast, toggle, toggle-group, toolbar, tooltip.\n',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('refuses to overwrite app-owned component files', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-add-cli-'));
    const outDir = join(root, 'ui');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'button.tsx'), 'export const Button = "local";\n', 'utf8');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'button', '--out', outDir])).toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
        `kovo-add/v1\nERROR button path=${JSON.stringify(join(outDir, 'button.tsx'))} reason=would-overwrite\n`,
      );
      expect(readFileSync(join(outDir, 'button.tsx'), 'utf8')).toBe(
        'export const Button = "local";\n',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
