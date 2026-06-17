import { compileComponentModule, composePageComponentArtifacts } from '@kovojs/compiler';
import { expect, test } from '@playwright/test';

function artifactSource(
  result: ReturnType<typeof composePageComponentArtifacts>[number],
  kind: 'css' | 'server',
) {
  const source = result.files.find((file) => file.kind === kind)?.source;
  if (!source) throw new Error(`Expected composed ${kind} artifact`);
  return source;
}

function emittedRootHtml(serverSource: string) {
  const match = /render: \(\) => (?<html><root[\s\S]*?<\/root>),/.exec(serverSource);
  if (!match?.groups?.html) {
    throw new Error(
      `Expected emitted root host in server artifact:\n${serverSource.slice(0, 500)}`,
    );
  }
  return match.groups.html;
}

test('page composition disambiguates same DOM leaves across registry-distinct components', async ({
  page,
}) => {
  const accordionRoot = compileComponentModule({
    fileName: 'components/accordion.tsx',
    source: `
export const Root = component({
  css: \`
    .label { color: teal; }
  \`,
  render: () => <root><span class="label">Accordion</span></root>,
});
`,
  });
  const tabsRoot = compileComponentModule({
    fileName: 'components/tabs.tsx',
    source: `
export const Root = component({
  css: \`
    .label { color: orange; }
  \`,
  render: () => <root><span class="label">Tabs</span></root>,
});
`,
  });

  const [composedAccordion, composedTabs] = composePageComponentArtifacts([
    accordionRoot,
    tabsRoot,
  ]);
  if (!composedAccordion || !composedTabs) throw new Error('Expected both composed artifacts');

  expect(composedAccordion.componentGraphFacts).toEqual([
    {
      disambiguatedDomName: 'components/accordion/root',
      domName: 'root',
      name: 'components/accordion/root',
    },
  ]);
  expect(composedTabs.componentGraphFacts).toEqual([
    {
      disambiguatedDomName: 'components/tabs/root',
      domName: 'root',
      name: 'components/tabs/root',
    },
  ]);

  const accordionHtml = emittedRootHtml(artifactSource(composedAccordion, 'server'));
  const tabsHtml = emittedRootHtml(artifactSource(composedTabs, 'server'));
  const css = [artifactSource(composedAccordion, 'css'), artifactSource(composedTabs, 'css')].join(
    '\n',
  );

  await page.setContent(`<main>${accordionHtml}${tabsHtml}</main><style>${css}</style>`);

  await expect(page.locator('root[kovo-c="components/accordion/root"] .label')).toHaveText(
    'Accordion',
  );
  await expect(page.locator('root[kovo-c="components/tabs/root"] .label')).toHaveText('Tabs');
  await expect(page.locator('root[kovo-c="root"]')).toHaveCount(0);
  await expect(page.locator('root[kovo-c="components/accordion/root"] .label')).toHaveCSS(
    'color',
    'rgb(0, 128, 128)',
  );
  await expect(page.locator('root[kovo-c="components/tabs/root"] .label')).toHaveCSS(
    'color',
    'rgb(255, 165, 0)',
  );

  expect(await page.locator('main').evaluate((element) => element.outerHTML)).toBe(
    '<main><root kovo-c="components/accordion/root"><span class="label">Accordion</span></root><root kovo-c="components/tabs/root"><span class="label">Tabs</span></root></main>',
  );
});
