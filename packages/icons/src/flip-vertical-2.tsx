/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Flip Vertical 2 icon (Lucide). https://lucide.dev/icons/flip-vertical-2 */
export function FlipVertical2(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 3-5 5-5-5h10"></path>
      <path d="m17 21-5-5-5 5h10"></path>
      <path d="M4 12H2"></path>
      <path d="M10 12H8"></path>
      <path d="M16 12h-2"></path>
      <path d="M22 12h-2"></path>
    </svg>
  );
}
