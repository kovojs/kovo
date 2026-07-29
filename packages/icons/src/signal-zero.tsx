/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Signal Zero icon (Lucide). https://lucide.dev/icons/signal-zero */
export function SignalZero(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h.01"></path>
    </svg>
  );
}
