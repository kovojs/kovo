/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Person Standing icon (Lucide). https://lucide.dev/icons/person-standing */
export function PersonStanding(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="5" r="1"></circle>
      <path d="m9 20 3-6 3 6"></path>
      <path d="m6 8 6 2 6-2"></path>
      <path d="M12 10v4"></path>
    </svg>
  );
}
