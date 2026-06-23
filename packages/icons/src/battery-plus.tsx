/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Battery Plus icon (Lucide). https://lucide.dev/icons/battery-plus */
export function BatteryPlus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 9v6"></path>
      <path d="M12.543 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.605"></path>
      <path d="M22 14v-4"></path>
      <path d="M7 12h6"></path>
      <path d="M7.606 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.606"></path>
    </svg>
  );
}
