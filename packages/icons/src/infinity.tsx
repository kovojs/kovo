/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Infinity icon (Lucide). https://lucide.dev/icons/infinity */
// eslint-disable-next-line no-shadow-restricted-names -- Generated public Lucide icon export.
export function Infinity(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8"></path>
    </svg>
  );
}
