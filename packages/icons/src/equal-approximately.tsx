/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Equal Approximately icon (Lucide). https://lucide.dev/icons/equal-approximately */
export function EqualApproximately(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 15a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0"></path>
      <path d="M5 9a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0"></path>
    </svg>
  );
}
