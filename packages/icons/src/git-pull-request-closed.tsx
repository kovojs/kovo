/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Pull Request Closed icon (Lucide). https://lucide.dev/icons/git-pull-request-closed */
export function GitPullRequestClosed(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M6 9v12"></path>
      <path d="m21 3-6 6"></path>
      <path d="m21 9-6-6"></path>
      <path d="M18 11.5V15"></path>
      <circle cx="18" cy="18" r="3"></circle>
    </svg>
  );
}
