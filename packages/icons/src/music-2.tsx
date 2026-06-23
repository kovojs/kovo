/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Music 2 icon (Lucide). https://lucide.dev/icons/music-2 */
export function Music2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="8" cy="18" r="4"></circle>
      <path d="M12 18V2l7 4"></path>
    </svg>
  );
}
