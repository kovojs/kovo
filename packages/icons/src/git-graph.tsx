/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Graph icon (Lucide). https://lucide.dev/icons/git-graph */
export function GitGraph(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="5" cy="6" r="3"></circle>
      <path d="M5 9v6"></path>
      <circle cx="5" cy="18" r="3"></circle>
      <path d="M12 3v18"></path>
      <circle cx="19" cy="6" r="3"></circle>
      <path d="M16 15.7A9 9 0 0 0 19 9"></path>
    </svg>
  );
}
