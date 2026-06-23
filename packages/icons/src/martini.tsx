/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Martini icon (Lucide). https://lucide.dev/icons/martini */
export function Martini(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12 4.207 4.207A.707.707 0 0 1 4.707 3h14.586a.707.707 0 0 1 .5 1.207z"></path>
      <path d="M12 12v10"></path>
      <path d="M7 22h10"></path>
    </svg>
  );
}
