/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Between Vertical End icon (Lucide). https://lucide.dev/icons/between-vertical-end */
export function BetweenVerticalEnd(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="7" height="13" x="3" y="3" rx="1"></rect>
      <path d="m9 22 3-3 3 3"></path>
      <rect width="7" height="13" x="14" y="3" rx="1"></rect>
    </svg>
  );
}
