/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Align Horizontal Justify Start icon (Lucide). https://lucide.dev/icons/align-horizontal-justify-start */
export function AlignHorizontalJustifyStart(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="6" y="5" rx="2"></rect>
      <rect width="6" height="10" x="16" y="7" rx="2"></rect>
      <path d="M2 2v20"></path>
    </svg>
  );
}
