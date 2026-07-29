/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Cursor icon (Lucide). https://lucide.dev/icons/text-cursor */
export function TextCursor(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1"></path>
      <path d="M7 22h1a4 4 0 0 0 4-4"></path>
      <path d="M7 2h1a4 4 0 0 1 4 4"></path>
    </svg>
  );
}
