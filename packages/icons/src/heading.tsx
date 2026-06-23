/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Heading icon (Lucide). https://lucide.dev/icons/heading */
export function Heading(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 12h12"></path>
      <path d="M6 20V4"></path>
      <path d="M18 20V4"></path>
    </svg>
  );
}
