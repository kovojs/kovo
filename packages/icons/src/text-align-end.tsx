/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Align End icon (Lucide). https://lucide.dev/icons/text-align-end */
export function TextAlignEnd(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H3"></path>
      <path d="M21 12H9"></path>
      <path d="M21 19H7"></path>
    </svg>
  );
}
