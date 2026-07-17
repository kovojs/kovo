import { describe, expect, it } from 'vitest';

import { validateCsrfToken } from './csrf.js';
import { renderedHtmlContent, renderHtmlValue } from './html.js';
import { mutation, mutationFormAttributes, s } from './index.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { jsx } from './jsx-runtime.js';
import { assignDerivedMutationKey } from './mutation/definition.js';

const csrf = {
  field: 'csrf',
  secret: 'browser-final-review-secret-0123456789abcdef',
  sessionId: (request: { session: { id: string } }) => request.session.id,
};

function definition() {
  return mutation('account/save', {
    csrf,
    input: s.object({}),
    handler() {
      return null;
    },
  });
}

describe('final browser mutation authority adversarial review', () => {
  it('binds action, data identity, and CSRF audience across property attack families', async () => {
    const save = definition();
    expect(Object.isFrozen(save)).toBe(true);
    expect(Reflect.set(save, 'key', 'admin/delete')).toBe(false);
    expect(Reflect.deleteProperty(save, 'key')).toBe(false);
    expect(Reflect.defineProperty(save, 'key', { value: 'admin/delete' })).toBe(false);
    expect(() => Object.defineProperty(save, 'key', { value: 'admin/delete' })).toThrow();
    expect(() => Object.assign(save, { key: 'admin/delete' })).toThrow();
    expect(() => Object.setPrototypeOf(save, { key: 'admin/delete' })).toThrow();

    const attrs = mutationFormAttributes(save);
    expect(Object.isFrozen(attrs)).toBe(true);
    expect(attrs.action).toBe('/_m/account/save');
    expect(attrs['data-mutation']).toBe('account/save');

    const request = { session: { id: 'victim' } };
    const rendered = renderHtmlValue(
      runWithJsxRequestContext(request, () => jsx('form', { ...attrs, children: 'Save' })),
    );
    const token = /name="csrf" value="([^"]+)"/u.exec(rendered)?.[1];
    expect(token).toBeDefined();
    expect(rendered).toContain('action="/_m/account/save"');
    expect(validateCsrfToken({ csrf: token }, request, csrf, { audience: 'account/save' })).toBe(
      true,
    );
    expect(validateCsrfToken({ csrf: token }, request, csrf, { audience: 'admin/delete' })).toBe(
      false,
    );

    const direct = await jsx('form', { ...attrs, children: 'Save' });
    expect(renderedHtmlContent(direct as never)).toContain('action="/_m/account/save"');
  });

  it('rejects clones, prototypes, proxies, and descriptor-preserving copies', () => {
    const save = definition();
    const descriptorCopy = Object.create(
      Object.getPrototypeOf(save),
      Object.getOwnPropertyDescriptors(save),
    );
    const candidates = [
      { ...save },
      Object.assign({}, save),
      Object.create(save),
      descriptorCopy,
      new Proxy(save, {}),
    ];
    for (const candidate of candidates) {
      expect(() => mutationFormAttributes(candidate as never)).toThrow(
        /exact definition returned/u,
      );
    }
    expect(() => structuredClone(save)).toThrow();
  });

  it('makes source-derived key assignment fresh and one-shot through aliases', () => {
    const pending = mutation({
      csrf,
      input: s.object({}),
      handler() {
        return null;
      },
    });
    const alias = pending;
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Reflect.set(alias, 'key', 'admin/delete')).toBe(false);

    const keyed = assignDerivedMutationKey(alias, 'components/account/save');
    expect(keyed).not.toBe(pending);
    expect(Object.isFrozen(keyed)).toBe(true);
    expect(mutationFormAttributes(keyed).action).toBe('/_m/components/account/save');
    expect(() => assignDerivedMutationKey(pending, 'components/admin/delete')).toThrow(
      /transition is one-shot/u,
    );
    expect(() => assignDerivedMutationKey(keyed, 'components/admin/delete')).toThrow(
      /already keyed/u,
    );
  });
});
