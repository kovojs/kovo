/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Grip Horizontal icon (Lucide). https://lucide.dev/icons/grip-horizontal */
export function GripHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="9" r="1"></circle>
      <circle cx="19" cy="9" r="1"></circle>
      <circle cx="5" cy="9" r="1"></circle>
      <circle cx="12" cy="15" r="1"></circle>
      <circle cx="19" cy="15" r="1"></circle>
      <circle cx="5" cy="15" r="1"></circle>
    </svg>
  );
}
