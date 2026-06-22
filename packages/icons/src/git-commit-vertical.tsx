/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Git Commit Vertical icon (Lucide). https://lucide.dev/icons/git-commit-vertical */
export function GitCommitVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v6"></path>
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M12 15v6"></path>
    </svg>
  );
}
