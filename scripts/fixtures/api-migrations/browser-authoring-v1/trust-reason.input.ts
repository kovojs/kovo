import { trustedHtml, trustedUrl } from '@kovojs/browser';

export const article = trustedHtml(markup, 'reviewed Markdown renderer output');
export const checkout = trustedUrl(url, 'allowlisted checkout-provider redirect');
