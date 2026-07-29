/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Align Justify icon (Lucide). https://lucide.dev/icons/text-align-justify */
export function TextAlignJustify(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h18"></path>
      <path d="M3 12h18"></path>
      <path d="M3 19h18"></path>
    </svg>
  );
}
