/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Trending Down icon (Lucide). https://lucide.dev/icons/trending-down */
export function TrendingDown(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 17h6v-6"></path>
      <path d="m22 17-8.5-8.5-5 5L2 7"></path>
    </svg>
  );
}
