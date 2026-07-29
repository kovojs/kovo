/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Audio Lines icon (Lucide). https://lucide.dev/icons/audio-lines */
export function AudioLines(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 10v3"></path>
      <path d="M6 6v11"></path>
      <path d="M10 3v18"></path>
      <path d="M14 8v7"></path>
      <path d="M18 5v13"></path>
      <path d="M22 10v3"></path>
    </svg>
  );
}
