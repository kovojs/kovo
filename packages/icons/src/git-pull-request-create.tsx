/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Pull Request Create icon (Lucide). https://lucide.dev/icons/git-pull-request-create */
export function GitPullRequestCreate(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M6 9v12"></path>
      <path d="M13 6h3a2 2 0 0 1 2 2v3"></path>
      <path d="M18 15v6"></path>
      <path d="M21 18h-6"></path>
    </svg>
  );
}
