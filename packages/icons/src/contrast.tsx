/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Contrast icon (Lucide). https://lucide.dev/icons/contrast */
export function Contrast(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 18a6 6 0 0 0 0-12v12z"></path>
    </svg>
  );
}
