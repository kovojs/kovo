/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Merge icon (Lucide). https://lucide.dev/icons/git-merge */
export function GitMerge(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18" cy="18" r="3"></circle>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M6 21V9a9 9 0 0 0 9 9"></path>
    </svg>
  );
}
