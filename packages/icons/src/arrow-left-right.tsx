/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Left Right icon (Lucide). https://lucide.dev/icons/arrow-left-right */
export function ArrowLeftRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 3 4 7l4 4"></path>
      <path d="M4 7h16"></path>
      <path d="m16 21 4-4-4-4"></path>
      <path d="M20 17H4"></path>
    </svg>
  );
}
