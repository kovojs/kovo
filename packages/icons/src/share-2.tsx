/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Share 2 icon (Lucide). https://lucide.dev/icons/share-2 */
export function Share2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18" cy="5" r="3"></circle>
      <circle cx="6" cy="12" r="3"></circle>
      <circle cx="18" cy="19" r="3"></circle>
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line>
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line>
    </svg>
  );
}
