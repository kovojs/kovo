/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Option icon (Lucide). https://lucide.dev/icons/option */
export function Option(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3h6l6 18h6"></path>
      <path d="M14 3h7"></path>
    </svg>
  );
}
