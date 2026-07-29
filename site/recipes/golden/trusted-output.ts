import { safeRichHtml } from '@kovojs/server';

export const trustedArticleBody = safeRichHtml('<p>Hello <strong>reader</strong>.</p>', {
  source: 'CMS rich-text field',
});
