/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Japanese Yen icon (Lucide). https://lucide.dev/icons/japanese-yen */
export function JapaneseYen(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 9.5V21m0-11.5L6 3m6 6.5L18 3"></path>
      <path d="M6 15h12"></path>
      <path d="M6 11h12"></path>
    </svg>
  );
}
