/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Slash 2 icon (Lucide). https://lucide.dev/icons/circle-slash-2 */
export function CircleSlash2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M22 2 2 22"></path>
    </svg>
  );
}
