/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mouse icon (Lucide). https://lucide.dev/icons/mouse */
export function Mouse(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="5" y="2" width="14" height="20" rx="7"></rect>
      <path d="M12 6v4"></path>
    </svg>
  );
}
