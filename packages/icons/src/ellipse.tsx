/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Ellipse icon (Lucide). https://lucide.dev/icons/ellipse */
export function Ellipse(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <ellipse cx="12" cy="12" rx="10" ry="6"></ellipse>
    </svg>
  );
}
