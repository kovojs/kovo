/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Power icon (Lucide). https://lucide.dev/icons/circle-power */
export function CirclePower(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 7v4"></path>
      <path d="M7.998 9.003a5 5 0 1 0 8-.005"></path>
    </svg>
  );
}
