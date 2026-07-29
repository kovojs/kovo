/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Toggle Right icon (Lucide). https://lucide.dev/icons/toggle-right */
export function ToggleRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="15" cy="12" r="3"></circle>
      <rect width="20" height="14" x="2" y="5" rx="7"></rect>
    </svg>
  );
}
