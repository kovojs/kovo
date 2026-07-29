/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Microwave icon (Lucide). https://lucide.dev/icons/microwave */
export function Microwave(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="15" x="2" y="4" rx="2"></rect>
      <rect width="8" height="7" x="6" y="8" rx="1"></rect>
      <path d="M18 8v7"></path>
      <path d="M6 19v2"></path>
      <path d="M18 19v2"></path>
    </svg>
  );
}
