/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Torus icon (Lucide). https://lucide.dev/icons/torus */
export function Torus(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <ellipse cx="12" cy="11" rx="3" ry="2"></ellipse>
      <ellipse cx="12" cy="12.5" rx="10" ry="8.5"></ellipse>
    </svg>
  );
}
