/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Drafting Compass icon (Lucide). https://lucide.dev/icons/drafting-compass */
export function DraftingCompass(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12.99 6.74 1.93 3.44"></path>
      <path d="M19.136 12a10 10 0 0 1-14.271 0"></path>
      <path d="m21 21-2.16-3.84"></path>
      <path d="m3 21 8.02-14.26"></path>
      <circle cx="12" cy="5" r="2"></circle>
    </svg>
  );
}
