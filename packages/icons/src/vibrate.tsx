/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Vibrate icon (Lucide). https://lucide.dev/icons/vibrate */
export function Vibrate(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m2 8 2 2-2 2 2 2-2 2"></path>
      <path d="m22 8-2 2 2 2-2 2 2 2"></path>
      <rect width="8" height="14" x="8" y="5" rx="1"></rect>
    </svg>
  );
}
