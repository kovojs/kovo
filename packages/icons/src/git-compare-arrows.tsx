/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Git Compare Arrows icon (Lucide). https://lucide.dev/icons/git-compare-arrows */
export function GitCompareArrows(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="5" cy="6" r="3"></circle>
      <path d="M12 6h5a2 2 0 0 1 2 2v7"></path>
      <path d="m15 9-3-3 3-3"></path>
      <circle cx="19" cy="18" r="3"></circle>
      <path d="M12 18H7a2 2 0 0 1-2-2V9"></path>
      <path d="m9 15 3 3-3 3"></path>
    </svg>
  );
}
