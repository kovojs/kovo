/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up Down icon (Lucide). https://lucide.dev/icons/arrow-up-down */
export function ArrowUpDown(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m21 16-4 4-4-4"></path>
      <path d="M17 20V4"></path>
      <path d="m3 8 4-4 4 4"></path>
      <path d="M7 4v16"></path>
    </svg>
  );
}
