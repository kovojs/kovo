/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Navigation icon (Lucide). https://lucide.dev/icons/navigation */
export function Navigation(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
    </svg>
  );
}
