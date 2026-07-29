/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up Right icon (Lucide). https://lucide.dev/icons/arrow-up-right */
export function ArrowUpRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 7h10v10"></path>
      <path d="M7 17 17 7"></path>
    </svg>
  );
}
