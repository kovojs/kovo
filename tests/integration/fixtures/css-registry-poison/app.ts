import { restoreCssRegistryPoison } from './poison.js';
import './styled.js';
import { kovoFixtureStylesheetManifest } from 'virtual:kovo-fixture-css-manifest';

restoreCssRegistryPoison();

export const stylesheetHrefs = kovoFixtureStylesheetManifest().map((asset) => asset.href);
