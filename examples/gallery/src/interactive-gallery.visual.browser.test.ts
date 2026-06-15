import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { renderInteractiveGalleryRoute } from './interactive-docs.js';
import {
  installVisualBaselineStyles,
  mountStaticGalleryRoute,
  required,
  visualBaselineHash,
  visualGeometry,
} from './interactive-gallery-browser-fixtures.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('keeps stable visual baselines for the compiled route and representative states', async () => {
    await page.viewport(900, 700);

    const host = document.createElement('div');
    host.innerHTML = renderInteractiveGalleryRoute();
    installVisualBaselineStyles();
    document.body.append(host);

    const route = required(
      host.querySelector<HTMLElement>('[data-gallery-route="/gallery/interactive"]'),
    );
    const switchDemo = required(
      host.querySelector<HTMLElement>('[data-gallery-interactive-route="switch-demo"]'),
    );
    const menuDemo = required(
      host.querySelector<HTMLElement>('[data-gallery-interactive-route="dropdown-menu-demo"]'),
    );
    const pureMarkupDemo = required(
      host.querySelector<HTMLElement>('[data-gallery-interactive-route="pure-markup-demo"]'),
    );

    expect(visualGeometry(route)).toEqual({
      height: 6184,
      width: 820,
    });
    expect(visualGeometry(switchDemo)).toEqual({
      height: 102,
      width: 780,
    });
    expect(visualGeometry(menuDemo)).toEqual({
      height: 183,
      width: 780,
    });
    expect(visualGeometry(pureMarkupDemo)).toEqual({
      height: 450,
      width: 780,
    });

    expect(await visualBaselineHash(route)).toBe('7240e2d0');
    expect(['1dc30a6d', '9ad15de9', '81aa77c6']).toContain(await visualBaselineHash(switchDemo));
    expect(['b19a1055', '94604e9e']).toContain(await visualBaselineHash(menuDemo));
    expect(['cc33e71c', 'b06676d3']).toContain(await visualBaselineHash(pureMarkupDemo));
  });

  it('keeps stable visual baselines for representative styled static gallery routes', async () => {
    await page.viewport(960, 720);
    installVisualBaselineStyles();

    const tabsRoute = mountStaticGalleryRoute('/components/tabs');
    const selectRoute = mountStaticGalleryRoute('/components/select');
    const tableRoute = mountStaticGalleryRoute('/components/table');
    const commandRoute = mountStaticGalleryRoute('/components/command');
    const checkboxGroupRoute = mountStaticGalleryRoute('/components/checkbox-group');
    const radioGroupRoute = mountStaticGalleryRoute('/components/radio-group');
    const numberFieldRoute = mountStaticGalleryRoute('/components/number-field');
    const otpFieldRoute = mountStaticGalleryRoute('/components/otp-field');
    const sliderRoute = mountStaticGalleryRoute('/components/slider');
    const contextMenuRoute = mountStaticGalleryRoute('/components/context-menu');
    const dropdownMenuRoute = mountStaticGalleryRoute('/components/dropdown-menu');
    const menubarRoute = mountStaticGalleryRoute('/components/menubar');
    const navigationMenuRoute = mountStaticGalleryRoute('/components/navigation-menu');
    const toastRoute = mountStaticGalleryRoute('/components/toast');

    expect(visualGeometry(tabsRoute)).toEqual({
      height: 539,
      width: 860,
    });
    expect(visualGeometry(selectRoute)).toEqual({
      height: 532,
      width: 860,
    });
    expect(visualGeometry(tableRoute)).toEqual({
      height: 591,
      width: 860,
    });
    expect(visualGeometry(commandRoute)).toEqual({
      height: 512,
      width: 860,
    });
    expect(visualGeometry(checkboxGroupRoute)).toEqual({
      height: 713,
      width: 860,
    });
    expect(visualGeometry(radioGroupRoute)).toEqual({
      height: 545,
      width: 860,
    });
    expect(visualGeometry(numberFieldRoute)).toEqual({
      height: 648,
      width: 860,
    });
    expect(visualGeometry(otpFieldRoute)).toEqual({
      height: 700,
      width: 860,
    });
    expect(visualGeometry(sliderRoute)).toEqual({
      height: 637,
      width: 860,
    });
    expect(visualGeometry(contextMenuRoute)).toEqual({
      height: 531,
      width: 860,
    });
    expect(visualGeometry(dropdownMenuRoute)).toEqual({
      height: 540,
      width: 860,
    });
    expect(visualGeometry(menubarRoute)).toEqual({
      height: 551,
      width: 860,
    });
    expect(visualGeometry(navigationMenuRoute)).toEqual({
      height: 561,
      width: 860,
    });
    expect(visualGeometry(toastRoute)).toEqual({
      height: 543,
      width: 860,
    });
    expect(await visualBaselineHash(tabsRoute)).toBe('9044926b');
    expect(await visualBaselineHash(selectRoute)).toBe('e0f770a7');
    expect(await visualBaselineHash(tableRoute)).toBe('09f0362a');
    expect(await visualBaselineHash(commandRoute)).toBe('d46c4bd3');
    expect(await visualBaselineHash(checkboxGroupRoute)).toBe('e9a5f503');
    expect(await visualBaselineHash(radioGroupRoute)).toBe('80d7704e');
    expect(await visualBaselineHash(numberFieldRoute)).toBe('d5277948');
    expect(await visualBaselineHash(otpFieldRoute)).toBe('6b72f908');
    expect(await visualBaselineHash(sliderRoute)).toBe('5ff031a5');
    expect(await visualBaselineHash(contextMenuRoute)).toBe('08c100b6');
    expect(await visualBaselineHash(dropdownMenuRoute)).toBe('bc8bc631');
    expect(await visualBaselineHash(menubarRoute)).toBe('279cb945');
    expect(await visualBaselineHash(navigationMenuRoute)).toBe('3c8e6a99');
    expect(await visualBaselineHash(toastRoute)).toBe('d1664096');

    const hoverCardRoute = mountStaticGalleryRoute('/components/hover-card');
    const popoverRoute = mountStaticGalleryRoute('/components/popover');
    const tooltipRoute = mountStaticGalleryRoute('/components/tooltip');

    expect(visualGeometry(hoverCardRoute)).toEqual({
      height: 531,
      width: 860,
    });
    expect(visualGeometry(popoverRoute)).toEqual({
      height: 503,
      width: 860,
    });
    expect(visualGeometry(tooltipRoute)).toEqual({
      height: 503,
      width: 860,
    });

    expect(await visualBaselineHash(hoverCardRoute)).toBe('5e6e6eb4');
    expect(await visualBaselineHash(popoverRoute)).toBe('cf798fae');
    expect(await visualBaselineHash(tooltipRoute)).toBe('fcf88f35');

    const autocompleteRoute = mountStaticGalleryRoute('/components/autocomplete');
    const comboboxRoute = mountStaticGalleryRoute('/components/combobox');

    expect(visualGeometry(autocompleteRoute)).toEqual({
      height: 585,
      width: 860,
    });
    expect(visualGeometry(comboboxRoute)).toEqual({
      height: 674,
      width: 860,
    });

    expect(await visualBaselineHash(autocompleteRoute)).toBe('b23aee53');
    expect(await visualBaselineHash(comboboxRoute)).toBe('38d910c8');

    const badgeRoute = mountStaticGalleryRoute('/components/badge');
    const breadcrumbRoute = mountStaticGalleryRoute('/components/breadcrumb');
    const buttonRoute = mountStaticGalleryRoute('/components/button');
    const cardRoute = mountStaticGalleryRoute('/components/card');
    const kbdRoute = mountStaticGalleryRoute('/components/kbd');
    const skeletonRoute = mountStaticGalleryRoute('/components/skeleton');

    expect(visualGeometry(badgeRoute)).toEqual({
      height: 491,
      width: 860,
    });
    expect(visualGeometry(breadcrumbRoute)).toEqual({
      height: 577,
      width: 860,
    });
    expect(visualGeometry(buttonRoute)).toEqual({
      height: 513,
      width: 860,
    });
    expect(visualGeometry(cardRoute)).toEqual({
      height: 553,
      width: 860,
    });
    expect(visualGeometry(kbdRoute)).toEqual({
      height: 491,
      width: 860,
    });
    expect(visualGeometry(skeletonRoute)).toEqual({
      height: 470,
      width: 860,
    });
    expect(await visualBaselineHash(badgeRoute)).toBe('4af1bf12');
    expect(await visualBaselineHash(breadcrumbRoute)).toBe('fa14c61f');
    expect(await visualBaselineHash(buttonRoute)).toBe('ff922618');
    expect(await visualBaselineHash(cardRoute)).toBe('d3536b91');
    expect(['70bf25ac', 'ba4c8b6b']).toContain(await visualBaselineHash(kbdRoute));
    expect(await visualBaselineHash(skeletonRoute)).toBe('827c88ad');

    const drawerRoute = mountStaticGalleryRoute('/components/drawer');
    const sheetRoute = mountStaticGalleryRoute('/components/sheet');

    expect(visualGeometry(drawerRoute)).toEqual({
      height: 503,
      width: 860,
    });
    expect(visualGeometry(sheetRoute)).toEqual({
      height: 503,
      width: 860,
    });
    expect(await visualBaselineHash(drawerRoute)).toBe('d6203776');
    expect(await visualBaselineHash(sheetRoute)).toBe('538e1a6e');

    const fieldRoute = mountStaticGalleryRoute('/components/field');

    expect(visualGeometry(fieldRoute)).toEqual({
      height: 874,
      width: 860,
    });
    expect(await visualBaselineHash(fieldRoute)).toBe('d1dab468');

    const avatarRoute = mountStaticGalleryRoute('/components/avatar');
    const meterRoute = mountStaticGalleryRoute('/components/meter');
    const progressRoute = mountStaticGalleryRoute('/components/progress');
    const scrollAreaRoute = mountStaticGalleryRoute('/components/scroll-area');
    const separatorRoute = mountStaticGalleryRoute('/components/separator');

    expect(visualGeometry(avatarRoute)).toEqual({
      height: 491,
      width: 860,
    });
    expect(visualGeometry(meterRoute)).toEqual({
      height: 491,
      width: 860,
    });
    expect(visualGeometry(progressRoute)).toEqual({
      height: 491,
      width: 860,
    });
    expect(visualGeometry(scrollAreaRoute)).toEqual({
      height: 692,
      width: 860,
    });
    expect(visualGeometry(separatorRoute)).toEqual({
      height: 511,
      width: 860,
    });
    expect(await visualBaselineHash(avatarRoute)).toBe('4bc833e5');
    expect(await visualBaselineHash(meterRoute)).toBe('fa0430d8');
    expect(await visualBaselineHash(progressRoute)).toBe('4c10b845');
    expect(await visualBaselineHash(scrollAreaRoute)).toBe('c3e213c2');
    expect(await visualBaselineHash(separatorRoute)).toBe('75cba077');

    const accordionRoute = mountStaticGalleryRoute('/components/accordion');
    const alertRoute = mountStaticGalleryRoute('/components/alert');
    const alertDialogRoute = mountStaticGalleryRoute('/components/alert-dialog');
    const checkboxRoute = mountStaticGalleryRoute('/components/checkbox');
    const collapsibleRoute = mountStaticGalleryRoute('/components/collapsible');
    const dialogRoute = mountStaticGalleryRoute('/components/dialog');
    const disclosureRoute = mountStaticGalleryRoute('/components/disclosure');
    const switchRoute = mountStaticGalleryRoute('/components/switch');
    const toggleRoute = mountStaticGalleryRoute('/components/toggle');

    expect(visualGeometry(accordionRoute)).toEqual({
      height: 595,
      width: 860,
    });
    expect(visualGeometry(alertRoute)).toEqual({
      height: 552,
      width: 860,
    });
    expect(visualGeometry(alertDialogRoute)).toEqual({
      height: 503,
      width: 860,
    });
    expect(visualGeometry(checkboxRoute)).toEqual({
      height: 502,
      width: 860,
    });
    expect(visualGeometry(collapsibleRoute)).toEqual({
      height: 531,
      width: 860,
    });
    expect(visualGeometry(dialogRoute)).toEqual({
      height: 503,
      width: 860,
    });
    expect(visualGeometry(disclosureRoute)).toEqual({
      height: 523,
      width: 860,
    });
    expect(visualGeometry(switchRoute)).toEqual({
      height: 502,
      width: 860,
    });
    expect(visualGeometry(toggleRoute)).toEqual({
      height: 519,
      width: 860,
    });
    expect(await visualBaselineHash(accordionRoute)).toBe('22704a32');
    expect(['0de1166f', '65aab817']).toContain(await visualBaselineHash(alertRoute));
    expect(['38a73445', '2b91cdad']).toContain(await visualBaselineHash(alertDialogRoute));
    expect(await visualBaselineHash(checkboxRoute)).toBe('acf6aad0');
    expect(['a7ea60ca', '9b7470db']).toContain(await visualBaselineHash(collapsibleRoute));
    expect(['cd8996f0', '57a8eca3', '442b8be6', 'ee816e2a']).toContain(
      await visualBaselineHash(dialogRoute),
    );
    expect(await visualBaselineHash(disclosureRoute)).toBe('0653d48e');
    expect(['14372e1a', 'f4f146a8']).toContain(await visualBaselineHash(switchRoute));
    expect(['d9dab2de', '0799ce1f']).toContain(await visualBaselineHash(toggleRoute));

    const toggleGroupRoute = mountStaticGalleryRoute('/components/toggle-group');
    const toolbarRoute = mountStaticGalleryRoute('/components/toolbar');

    expect(visualGeometry(toggleGroupRoute)).toEqual({
      height: 635,
      width: 860,
    });
    expect(visualGeometry(toolbarRoute)).toEqual({
      height: 635,
      width: 860,
    });
    expect(['ad8d5436', '40b6565a']).toContain(await visualBaselineHash(toggleGroupRoute));
    expect(['c1d2d1b8', '44f2f377']).toContain(await visualBaselineHash(toolbarRoute));
  });
});
