/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Test Tube icon (Lucide). https://lucide.dev/icons/test-tube */
export function TestTube(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2"></path>
      <path d="M8.5 2h7"></path>
      <path d="M14.5 16h-5"></path>
    </svg>
  );
}
