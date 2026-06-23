/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Music 3 icon (Lucide). https://lucide.dev/icons/music-3 */
export function Music3(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="18" r="4"></circle>
      <path d="M16 18V2"></path>
    </svg>
  );
}
