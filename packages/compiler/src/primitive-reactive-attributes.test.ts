import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';
import { lowerStructuralJsx } from './lower/structural-jsx.js';
import { parseComponentModule } from './scan/parse.js';
import { applySourceReplacements } from './shared.js';

// SPEC.md §4.6 (KV232): @kovojs/ui primitives own their reactive state attributes
// (aria-checked / aria-pressed / aria-expanded / data-state / hidden / checked).
// The compiler must make those attributes reactive automatically when an author
// forwards a reactive boolean control prop, so gallery demos never hand-write
// them. These tests assert the lowered server module emits the right
// `data-bind:<attr>` stamps plus matching `derive(...)` exports, and that the
// lowering is a fixpoint (byte-stable on re-lower).

function compile(fileName: string, source: string) {
  const result = compileComponentModule({ fileName, source });
  expect(result.diagnostics).toEqual([]);
  expect(() => assertFixpoint(result)).not.toThrow();
  return result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? '';
}

describe('primitive reactive attribute lowering', () => {
  it('binds switch.root aria-checked/data-state/checked from a reactive checked prop', () => {
    const server = compile(
      'switch-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch } from '@kovojs/ui/switch';
export const SwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_q: Record<string, never>, state: { checked: boolean }) => (
    <Switch checked={state.checked}>x</Switch>
  ),
});
`,
    );

    expect(server).toContain('data-bind:aria-checked=');
    expect(server).toContain('data-bind:data-state=');
    expect(server).toContain('data-bind:checked=');
    expect(server).toContain(
      'export const SwitchDemo$Switch_aria_checked_derive = derive(["state"], (state: any) => ((state.checked) ? "true" : "false"));',
    );
    expect(server).toContain(
      'export const SwitchDemo$Switch_data_state_derive = derive(["state"], (state: any) => ((state.checked) ? "checked" : "unchecked"));',
    );
    // The control prop's own boolean-presence derive is still emitted by the
    // inline-attribute-derive pass; this pass must not duplicate it.
    expect(server.match(/SwitchDemo\$Switch_checked_derive\b/g)?.length ?? 0).toBeGreaterThan(0);
    expect(server).not.toContain('SwitchDemo$Switch_checked_derive_2');
  });

  it('binds toggle.root aria-pressed/data-state from a reactive pressed prop', () => {
    const server = compile(
      'toggle-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Toggle } from '@kovojs/ui/toggle';
export const ToggleDemo = component({
  state: () => ({ pressed: false }),
  render: (_q: Record<string, never>, state: { pressed: boolean }) => (
    <Toggle pressed={state.pressed}>x</Toggle>
  ),
});
`,
    );

    expect(server).toContain(
      'export const ToggleDemo$Toggle_aria_pressed_derive = derive(["state"], (state: any) => ((state.pressed) ? "true" : "false"));',
    );
    expect(server).toContain(
      'export const ToggleDemo$Toggle_data_state_derive = derive(["state"], (state: any) => ((state.pressed) ? "pressed" : "off"));',
    );
    expect(server).toContain('data-bind:aria-pressed=');
    expect(server).toContain('data-bind:data-state=');
  });

  it('binds disclosure trigger aria-expanded/data-state and content data-state/hidden', () => {
    const server = compile(
      'disclosure-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@kovojs/ui/disclosure';
export const DisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_q: Record<string, never>, state: { open: boolean }) => (
    <Disclosure open={state.open}>
      <DisclosureTrigger contentId="p" open={state.open}>t</DisclosureTrigger>
      <DisclosureContent contentId="p" open={state.open}>c</DisclosureContent>
    </Disclosure>
  ),
});
`,
    );

    // Root: data-state only.
    expect(server).toContain(
      'export const DisclosureDemo$Disclosure_data_state_derive = derive(["state"], (state: any) => ((state.open) ? "open" : "closed"));',
    );
    // Trigger: aria-expanded + data-state.
    expect(server).toContain(
      'export const DisclosureDemo$DisclosureTrigger_aria_expanded_derive = derive(["state"], (state: any) => ((state.open) ? "true" : "false"));',
    );
    expect(server).toContain('data-bind:aria-expanded=');
    // Content: data-state + hidden (presence inverted relative to `open`).
    expect(server).toContain(
      'export const DisclosureDemo$DisclosureContent_hidden_derive = derive(["state"], (state: any) => ((state.open) ? null : ""));',
    );
    expect(server).toContain('data-bind:hidden=');
  });

  it('binds collapsible trigger/content reactive attributes', () => {
    const server = compile(
      'collapsible-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kovojs/ui/collapsible';
export const CollapsibleDemo = component({
  state: () => ({ open: false }),
  render: (_q: Record<string, never>, state: { open: boolean }) => (
    <Collapsible open={state.open}>
      <CollapsibleTrigger contentId="c" open={state.open}>t</CollapsibleTrigger>
      <CollapsibleContent contentId="c" open={state.open}>x</CollapsibleContent>
    </Collapsible>
  ),
});
`,
    );

    expect(server).toContain(
      'export const CollapsibleDemo$CollapsibleTrigger_aria_expanded_derive = derive(["state"], (state: any) => ((state.open) ? "true" : "false"));',
    );
    expect(server).toContain(
      'export const CollapsibleDemo$CollapsibleContent_data_state_derive = derive(["state"], (state: any) => ((state.open) ? "open" : "closed"));',
    );
  });

  it('binds accordion item/trigger/content attributes from value and itemValue', () => {
    const server = compile(
      'accordion-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@kovojs/ui/accordion';
export const AccordionDemo = component({
  state: () => ({ value: 'billing' }),
  render: (_q: Record<string, never>, state: { value: string }) => (
    <Accordion type="single" value={state.value}>
      <AccordionItem itemValue="shipping" type="single" value={state.value}>
        <AccordionTrigger contentId="shipping-panel" itemValue="shipping" type="single" value={state.value}>Shipping</AccordionTrigger>
        <AccordionContent contentId="shipping-panel" itemValue="shipping" type="single" value={state.value}>Panel</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
});
`,
    );

    expect(server).toContain('data-bind:aria-expanded=');
    expect(server).toContain('data-bind:hidden=');
    expect(server).toContain('data-bind:open=');
    expect(server).toContain('(state.value) === "shipping"');
    expect(server).toContain(
      'export const AccordionDemo$AccordionTrigger_aria_expanded_derive = derive(["state"], (state: any) => (((state.value) === "shipping") ? "true" : "false"));',
    );
    expect(server).toContain(
      'export const AccordionDemo$AccordionContent_hidden_derive = derive(["state"], (state: any) => (((state.value) === "shipping") ? null : ""));',
    );
  });

  it('binds accordion multiple content attributes with membership checks', () => {
    const server = compile(
      'accordion-multiple-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { AccordionContent, AccordionTrigger } from '@kovojs/ui/accordion';
export const AccordionMultipleDemo = component({
  state: () => ({ value: ['billing'] }),
  render: (_q: Record<string, never>, state: { value: readonly string[] }) => (
    <>
      <AccordionTrigger contentId="shipping-panel" itemValue="shipping" type="multiple" value={state.value}>Shipping</AccordionTrigger>
      <AccordionContent contentId="shipping-panel" itemValue="shipping" type="multiple" value={state.value}>Panel</AccordionContent>
    </>
  ),
});
`,
    );

    expect(server).toContain('Array.isArray((state.value)) && (state.value).includes("shipping")');
    expect(server).toContain(
      'export const AccordionMultipleDemo$AccordionTrigger_aria_expanded_derive = derive(["state"], (state: any) => ((Array.isArray((state.value)) && (state.value).includes("shipping")) ? "true" : "false"));',
    );
  });

  it('binds checkbox tri-state aria-checked/data-state from a reactive checked prop', () => {
    const server = compile(
      'checkbox-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Checkbox } from '@kovojs/ui/checkbox';
export const CheckboxDemo = component({
  state: () => ({ checked: 'indeterminate' as boolean | 'indeterminate' }),
  render: (_q: Record<string, never>, state: { checked: boolean | 'indeterminate' }) => (
    <Checkbox checked={state.checked}>Receive updates</Checkbox>
  ),
});
`,
    );

    expect(server).toContain('data-bind:aria-checked=');
    expect(server).toContain('data-bind:data-state=');
    expect(server).toContain(
      'export const CheckboxDemo$Checkbox_aria_checked_derive = derive(["state"], (state: any) => ((state.checked) === "indeterminate" ? "mixed" : (((state.checked) === true) ? "true" : "false")));',
    );
    expect(server).toContain(
      'export const CheckboxDemo$Checkbox_data_state_derive = derive(["state"], (state: any) => ((state.checked) === "indeterminate" ? "indeterminate" : (((state.checked) === true) ? "checked" : "unchecked")));',
    );
  });

  it('binds radio item/radio attributes by comparing value with itemValue', () => {
    const server = compile(
      'radio-group-demo.tsx',
      `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { RadioGroupItem, RadioGroupLabel, RadioGroupRadio } from '@kovojs/ui/radio-group';
export const RadioGroupDemo = component({
  state: () => ({ value: 'basic' }),
  render: (_q: Record<string, never>, state: { value: string }) => (
    <RadioGroupItem itemValue="pro" value={state.value}>
      <RadioGroupRadio itemValue="pro" value={state.value} />
      <RadioGroupLabel itemValue="pro" value={state.value}>Pro</RadioGroupLabel>
    </RadioGroupItem>
  ),
});
`,
    );

    expect(server).toContain('data-bind:aria-checked=');
    expect(server).toContain('data-bind:checked=');
    expect(server).toContain('data-bind:data-state=');
    expect(server).toContain(
      'export const RadioGroupDemo$RadioGroupRadio_aria_checked_derive = derive(["state"], (state: any) => (((state.value) === "pro") ? "true" : "false"));',
    );
  });

  it('does not bind primitives whose control prop is not reactive state', () => {
    const result = compileComponentModule({
      fileName: 'static-switch.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch } from '@kovojs/ui/switch';
export const StaticSwitchDemo = component({
  state: () => ({}),
  render: () => <Switch checked>x</Switch>,
});
`,
    });
    const server = result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? '';
    expect(result.diagnostics).toEqual([]);
    expect(server).not.toContain('data-bind:aria-checked=');
    expect(server).not.toContain('data-bind:data-state=');
  });

  it('does not bind a component imported from outside @kovojs/ui', () => {
    const result = compileComponentModule({
      fileName: 'local-switch.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch } from './local-switch-impl.js';
export const LocalSwitchDemo = component({
  state: () => ({ checked: false }),
  render: (_q: Record<string, never>, state: { checked: boolean }) => (
    <Switch checked={state.checked}>x</Switch>
  ),
});
`,
    });
    const server = result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? '';
    expect(server).not.toContain('data-bind:aria-checked=');
    expect(server).not.toContain('data-bind:data-state=');
  });

  it('skips an attribute the author wrote literally (no KV233 double-bind)', () => {
    const result = compileComponentModule({
      fileName: 'authored-aria.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch } from '@kovojs/ui/switch';
export const AuthoredAriaDemo = component({
  state: () => ({ checked: false }),
  render: (_q: Record<string, never>, state: { checked: boolean }) => (
    <Switch aria-checked="mixed" checked={state.checked}>x</Switch>
  ),
});
`,
    });
    const server = result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? '';
    // The authored aria-checked is preserved and not re-derived.
    expect(server).not.toContain('data-bind:aria-checked=');
    expect(server).not.toContain('AuthoredAriaDemo$Switch_aria_checked_derive');
    // data-state is still auto-bound (not authored).
    expect(server).toContain('data-bind:data-state=');
  });

  it('is a no-op fixpoint when re-lowering its own output', () => {
    const fileName = 'switch-fixpoint.tsx';
    const source = `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Switch } from '@kovojs/ui/switch';
export const FixpointDemo = component({
  state: () => ({ checked: false }),
  render: (_q: Record<string, never>, state: { checked: boolean }) => (
    <Switch checked={state.checked}>x</Switch>
  ),
});
`;

    const first = lowerOnce(fileName, source);
    expect(first).toContain('data-bind:aria-checked=');
    expect(first).toContain('data-bind:data-state=');

    // Re-lowering the lowered output must add no further reactive bindings.
    const second = lowerOnce(fileName, first);
    const countBinds = (text: string) =>
      (text.match(/data-bind:(?:aria-checked|data-state)=/g) ?? []).length;
    expect(countBinds(second)).toEqual(countBinds(first));
    expect(second.match(/_aria_checked_derive\b/g)?.length ?? 0).toEqual(
      first.match(/_aria_checked_derive\b/g)?.length ?? 0,
    );
  });
});

// Lower a single component module through the structural JSX pass only and
// return the patched source, so the fixpoint test can feed lowered output back
// in without the full client/server emission rewriting binding URLs.
function lowerOnce(fileName: string, source: string): string {
  const model = parseComponentModule(fileName, source);
  const componentName = 'FixpointDemo';
  const lowering = lowerStructuralJsx(model, componentName, { fileName, source });
  return applySourceReplacements(source, lowering.replacements);
}
