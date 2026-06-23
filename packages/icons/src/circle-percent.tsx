/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Percent icon (Lucide). https://lucide.dev/icons/circle-percent */
export function CirclePercent(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m15 9-6 6"></path>
      <path d="M9 9h.01"></path>
      <path d="M15 15h.01"></path>
    </svg>
  );
}
