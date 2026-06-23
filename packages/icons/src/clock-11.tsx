/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Clock 11 icon (Lucide). https://lucide.dev/icons/clock-11 */
export function Clock11(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l-2-4"></path>
    </svg>
  );
}
