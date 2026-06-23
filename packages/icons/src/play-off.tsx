/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Play Off icon (Lucide). https://lucide.dev/icons/play-off */
export function PlayOff(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10.215 4.56 9.79 5.71a2 2 0 0 1 .003 3.458l-.393.23"></path>
      <path d="m16.042 16.042-8.034 4.686A2 2 0 0 1 5 19V5"></path>
      <path d="m2 2 20 20"></path>
    </svg>
  );
}
