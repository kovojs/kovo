/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Option icon (Lucide). https://lucide.dev/icons/option */
export function Option(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3h6l6 18h6"></path>
      <path d="M14 3h7"></path>
    </svg>
  );
}
