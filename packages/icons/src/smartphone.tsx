/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Smartphone icon (Lucide). https://lucide.dev/icons/smartphone */
export function Smartphone(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect>
      <path d="M12 18h.01"></path>
    </svg>
  );
}
