/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Move icon (Lucide). https://lucide.dev/icons/move */
export function Move(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v20"></path>
      <path d="m15 19-3 3-3-3"></path>
      <path d="m19 9 3 3-3 3"></path>
      <path d="M2 12h20"></path>
      <path d="m5 9-3 3 3 3"></path>
      <path d="m9 5 3-3 3 3"></path>
    </svg>
  );
}
