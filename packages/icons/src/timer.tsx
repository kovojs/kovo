/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Timer icon (Lucide). https://lucide.dev/icons/timer */
export function Timer(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="10" x2="14" y1="2" y2="2"></line>
      <line x1="12" x2="15" y1="14" y2="11"></line>
      <circle cx="12" cy="14" r="8"></circle>
    </svg>
  );
}
