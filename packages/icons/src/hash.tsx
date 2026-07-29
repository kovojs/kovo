/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Hash icon (Lucide). https://lucide.dev/icons/hash */
export function Hash(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="4" x2="20" y1="9" y2="9"></line>
      <line x1="4" x2="20" y1="15" y2="15"></line>
      <line x1="10" x2="8" y1="3" y2="21"></line>
      <line x1="16" x2="14" y1="3" y2="21"></line>
    </svg>
  );
}
