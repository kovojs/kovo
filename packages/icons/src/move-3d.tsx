/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move 3d icon (Lucide). https://lucide.dev/icons/move-3d */
export function Move3d(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 3v16h16"></path>
      <path d="m5 19 6-6"></path>
      <path d="m2 6 3-3 3 3"></path>
      <path d="m18 16 3 3-3 3"></path>
    </svg>
  );
}
