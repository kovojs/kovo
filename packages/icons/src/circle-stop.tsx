/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Stop icon (Lucide). https://lucide.dev/icons/circle-stop */
export function CircleStop(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <rect x="9" y="9" width="6" height="6" rx="1"></rect>
    </svg>
  );
}
