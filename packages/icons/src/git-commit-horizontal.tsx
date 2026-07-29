/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Commit Horizontal icon (Lucide). https://lucide.dev/icons/git-commit-horizontal */
export function GitCommitHorizontal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="3"></circle>
      <line x1="3" x2="9" y1="12" y2="12"></line>
      <line x1="15" x2="21" y1="12" y2="12"></line>
    </svg>
  );
}
