/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Pause icon (Lucide). https://lucide.dev/icons/circle-pause */
export function CirclePause(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="10" x2="10" y1="15" y2="9"></line>
      <line x1="14" x2="14" y1="15" y2="9"></line>
    </svg>
  );
}
