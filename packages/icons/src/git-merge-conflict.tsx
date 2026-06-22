/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Merge Conflict icon (Lucide). https://lucide.dev/icons/git-merge-conflict */
export function GitMergeConflict(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6h4a2 2 0 0 1 2 2v7"></path>
      <path d="M6 12v9"></path>
      <path d="M9 3 3 9"></path>
      <path d="M9 9 3 3"></path>
      <circle cx="18" cy="18" r="3"></circle>
    </svg>
  );
}
