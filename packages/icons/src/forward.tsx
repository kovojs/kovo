/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Forward icon (Lucide). https://lucide.dev/icons/forward */
export function Forward(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 17 5-5-5-5"></path>
      <path d="M4 18v-2a4 4 0 0 1 4-4h12"></path>
    </svg>
  );
}
