/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Pull Request icon (Lucide). https://lucide.dev/icons/git-pull-request */
export function GitPullRequest(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18" cy="18" r="3"></circle>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
      <line x1="6" x2="6" y1="9" y2="21"></line>
    </svg>
  );
}
