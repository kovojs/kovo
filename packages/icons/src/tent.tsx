/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tent icon (Lucide). https://lucide.dev/icons/tent */
export function Tent(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3.5 21 14 3"></path>
      <path d="M20.5 21 10 3"></path>
      <path d="M15.5 21 12 15l-3.5 6"></path>
      <path d="M2 21h20"></path>
    </svg>
  );
}
