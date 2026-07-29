/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Power icon (Lucide). https://lucide.dev/icons/power */
export function Power(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v10"></path>
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04"></path>
    </svg>
  );
}
