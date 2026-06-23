/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Split icon (Lucide). https://lucide.dev/icons/split */
export function Split(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 3h5v5"></path>
      <path d="M8 3H3v5"></path>
      <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"></path>
      <path d="m15 9 6-6"></path>
    </svg>
  );
}
