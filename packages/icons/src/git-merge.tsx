/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Merge icon (Lucide). https://lucide.dev/icons/git-merge */
export function GitMerge(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18" cy="18" r="3"></circle>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M6 21V9a9 9 0 0 0 9 9"></path>
    </svg>
  );
}
