/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Pc Case icon (Lucide). https://lucide.dev/icons/pc-case */
export function PcCase(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="20" x="5" y="2" rx="2"></rect>
      <path d="M15 14h.01"></path>
      <path d="M9 6h6"></path>
      <path d="M9 10h6"></path>
    </svg>
  );
}
