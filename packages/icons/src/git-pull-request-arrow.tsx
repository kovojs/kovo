/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Pull Request Arrow icon (Lucide). https://lucide.dev/icons/git-pull-request-arrow */
export function GitPullRequestArrow(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="5" cy="6" r="3"></circle>
      <path d="M5 9v12"></path>
      <circle cx="19" cy="18" r="3"></circle>
      <path d="m15 9-3-3 3-3"></path>
      <path d="M12 6h5a2 2 0 0 1 2 2v7"></path>
    </svg>
  );
}
