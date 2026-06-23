/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Case Upper icon (Lucide). https://lucide.dev/icons/case-upper */
export function CaseUpper(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 11h4.5a1 1 0 0 1 0 5h-4a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h3a1 1 0 0 1 0 5"></path>
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"></path>
      <path d="M3.304 13h6.392"></path>
    </svg>
  );
}
