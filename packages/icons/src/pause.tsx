/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Pause icon (Lucide). https://lucide.dev/icons/pause */
export function Pause(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="14" y="3" width="5" height="18" rx="1"></rect>
      <rect x="5" y="3" width="5" height="18" rx="1"></rect>
    </svg>
  );
}
