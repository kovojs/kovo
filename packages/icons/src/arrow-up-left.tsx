/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up Left icon (Lucide). https://lucide.dev/icons/arrow-up-left */
export function ArrowUpLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 17V7h10"></path>
      <path d="M17 17 7 7"></path>
    </svg>
  );
}
