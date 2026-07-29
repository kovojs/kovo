/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Separator Horizontal icon (Lucide). https://lucide.dev/icons/separator-horizontal */
export function SeparatorHorizontal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m16 16-4 4-4-4"></path>
      <path d="M3 12h18"></path>
      <path d="m8 8 4-4 4 4"></path>
    </svg>
  );
}
