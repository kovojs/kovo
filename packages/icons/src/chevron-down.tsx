/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron Down icon (Lucide). https://lucide.dev/icons/chevron-down */
export function ChevronDown(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  );
}
