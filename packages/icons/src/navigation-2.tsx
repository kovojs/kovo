/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Navigation 2 icon (Lucide). https://lucide.dev/icons/navigation-2 */
export function Navigation2(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
    </svg>
  );
}
