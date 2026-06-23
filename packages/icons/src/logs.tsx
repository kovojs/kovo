/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Logs icon (Lucide). https://lucide.dev/icons/logs */
export function Logs(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h1"></path>
      <path d="M3 12h1"></path>
      <path d="M3 19h1"></path>
      <path d="M8 5h1"></path>
      <path d="M8 12h1"></path>
      <path d="M8 19h1"></path>
      <path d="M13 5h8"></path>
      <path d="M13 12h8"></path>
      <path d="M13 19h8"></path>
    </svg>
  );
}
