/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Between Horizontal End icon (Lucide). https://lucide.dev/icons/between-horizontal-end */
export function BetweenHorizontalEnd(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="13" height="7" x="3" y="3" rx="1"></rect>
      <path d="m22 15-3-3 3-3"></path>
      <rect width="13" height="7" x="3" y="14" rx="1"></rect>
    </svg>
  );
}
