/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Tent Tree icon (Lucide). https://lucide.dev/icons/tent-tree */
export function TentTree(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="4" cy="4" r="2"></circle>
      <path d="m14 5 3-3 3 3"></path>
      <path d="m14 10 3-3 3 3"></path>
      <path d="M17 14V2"></path>
      <path d="M17 14H7l-5 8h20Z"></path>
      <path d="M8 14v8"></path>
      <path d="m9 14 5 8"></path>
    </svg>
  );
}
