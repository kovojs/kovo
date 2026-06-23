/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Grip icon (Lucide). https://lucide.dev/icons/grip */
export function Grip(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="5" r="1"></circle>
      <circle cx="19" cy="5" r="1"></circle>
      <circle cx="5" cy="5" r="1"></circle>
      <circle cx="12" cy="12" r="1"></circle>
      <circle cx="19" cy="12" r="1"></circle>
      <circle cx="5" cy="12" r="1"></circle>
      <circle cx="12" cy="19" r="1"></circle>
      <circle cx="19" cy="19" r="1"></circle>
      <circle cx="5" cy="19" r="1"></circle>
    </svg>
  );
}
