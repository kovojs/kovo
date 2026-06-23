/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Clock Fading icon (Lucide). https://lucide.dev/icons/clock-fading */
export function ClockFading(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2a10 10 0 0 1 7.38 16.75"></path>
      <path d="M12 6v6l4 2"></path>
      <path d="M2.5 8.875a10 10 0 0 0-.5 3"></path>
      <path d="M2.83 16a10 10 0 0 0 2.43 3.4"></path>
      <path d="M4.636 5.235a10 10 0 0 1 .891-.857"></path>
      <path d="M8.644 21.42a10 10 0 0 0 7.631-.38"></path>
    </svg>
  );
}
