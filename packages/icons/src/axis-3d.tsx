/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Axis 3d icon (Lucide). https://lucide.dev/icons/axis-3d */
export function Axis3d(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13.5 10.5 15 9"></path>
      <path d="M4 4v15a1 1 0 0 0 1 1h15"></path>
      <path d="M4.293 19.707 6 18"></path>
      <path d="m9 15 1.5-1.5"></path>
    </svg>
  );
}
