/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Diff icon (Lucide). https://lucide.dev/icons/diff */
export function Diff(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v14"></path>
      <path d="M5 10h14"></path>
      <path d="M5 21h14"></path>
    </svg>
  );
}
