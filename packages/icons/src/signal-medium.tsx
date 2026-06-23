/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Signal Medium icon (Lucide). https://lucide.dev/icons/signal-medium */
export function SignalMedium(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h.01"></path>
      <path d="M7 20v-4"></path>
      <path d="M12 20v-8"></path>
    </svg>
  );
}
