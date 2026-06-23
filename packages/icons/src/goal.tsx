/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Goal icon (Lucide). https://lucide.dev/icons/goal */
export function Goal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 13V2l8 4-8 4"></path>
      <path d="M20.561 10.222a9 9 0 1 1-12.55-5.29"></path>
      <path d="M8.002 9.997a5 5 0 1 0 8.9 2.02"></path>
    </svg>
  );
}
