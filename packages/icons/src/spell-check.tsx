/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Spell Check icon (Lucide). https://lucide.dev/icons/spell-check */
export function SpellCheck(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m6 16 6-12 6 12"></path>
      <path d="M8 12h8"></path>
      <path d="m16 20 2 2 4-4"></path>
    </svg>
  );
}
