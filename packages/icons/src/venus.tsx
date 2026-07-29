/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Venus icon (Lucide). https://lucide.dev/icons/venus */
export function Venus(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 15v7"></path>
      <path d="M9 19h6"></path>
      <circle cx="12" cy="9" r="6"></circle>
    </svg>
  );
}
