/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Form icon (Lucide). https://lucide.dev/icons/form */
export function Form(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 14h6"></path>
      <path d="M4 2h10"></path>
      <rect x="4" y="18" width="16" height="4" rx="1"></rect>
      <rect x="4" y="6" width="16" height="4" rx="1"></rect>
    </svg>
  );
}
