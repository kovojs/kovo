/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Diff icon (Lucide). https://lucide.dev/icons/diff */
export function Diff(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v14"></path>
      <path d="M5 10h14"></path>
      <path d="M5 21h14"></path>
    </svg>
  );
}
