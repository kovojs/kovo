export interface VendoredUiComponent {
  fileName: `${string}.tsx`;
  source: string;
}

export const vendoredUiComponents = {
  button: {
    fileName: 'button.tsx',
    source: [
      "import { component } from '@jiso/core';",
      '',
      'export interface ButtonProps {',
      '  children?: string;',
      "  type?: 'button' | 'submit' | 'reset';",
      '  disabled?: boolean;',
      '}',
      '',
      "export const Button = component('button', {",
      '  render(props: ButtonProps) {',
      '    const type = props.type ?? "button";',
      '    return (',
      '      <button',
      '        class="inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"',
      '        disabled={props.disabled}',
      '        type={type}',
      '      >',
      '        {props.children}',
      '      </button>',
      '    );',
      '  },',
      '});',
      '',
    ].join('\n'),
  },
  card: {
    fileName: 'card.tsx',
    source: [
      "import { component } from '@jiso/core';",
      '',
      'export interface CardProps {',
      '  children?: string;',
      '}',
      '',
      "export const Card = component('card', {",
      '  render(props: CardProps) {',
      '    return (',
      '      <section class="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">',
      '        {props.children}',
      '      </section>',
      '    );',
      '  },',
      '});',
      '',
    ].join('\n'),
  },
} as const satisfies Record<string, VendoredUiComponent>;

export type AddComponentName = keyof typeof vendoredUiComponents;

export function availableAddComponents(): string {
  return Object.keys(vendoredUiComponents).sort().join(', ');
}

export function isAddComponentName(value: string): value is AddComponentName {
  return Object.hasOwn(vendoredUiComponents, value);
}
