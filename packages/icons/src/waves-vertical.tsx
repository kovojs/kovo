/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Waves Vertical icon (Lucide). https://lucide.dev/icons/waves-vertical */
export function WavesVertical(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2q2 2.5 0 5t0 5 0 5 0 5"></path>
      <path d="M19 2q2 2.5 0 5t0 5 0 5 0 5"></path>
      <path d="M5 2q2 2.5 0 5t0 5 0 5 0 5"></path>
    </svg>
  );
}
