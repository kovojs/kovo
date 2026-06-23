/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Pull Request Draft icon (Lucide). https://lucide.dev/icons/git-pull-request-draft */
export function GitPullRequestDraft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18" cy="18" r="3"></circle>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M18 6V5"></path>
      <path d="M18 11v-1"></path>
      <line x1="6" x2="6" y1="9" y2="21"></line>
    </svg>
  );
}
