/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Branch icon (Lucide). https://lucide.dev/icons/git-branch */
export function GitBranch(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 6a9 9 0 0 0-9 9V3"></path>
      <circle cx="18" cy="6" r="3"></circle>
      <circle cx="6" cy="18" r="3"></circle>
    </svg>
  );
}
