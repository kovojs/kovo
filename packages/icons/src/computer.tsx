/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Computer icon (Lucide). https://lucide.dev/icons/computer */
export function Computer(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="8" x="5" y="2" rx="2"></rect>
      <rect width="20" height="8" x="2" y="14" rx="2"></rect>
      <path d="M6 18h2"></path>
      <path d="M12 18h6"></path>
    </svg>
  );
}
