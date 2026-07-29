/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Ban icon (Lucide). https://lucide.dev/icons/ban */
export function Ban(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M4.929 4.929 19.07 19.071"></path>
    </svg>
  );
}
