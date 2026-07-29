// @ts-nocheck -- migration refusal input intentionally imports a removed public symbol.
import { createTheme, defineVars } from '@kovojs/style';

const vars = defineVars({ accent: '#6750a4' });

export const darkTheme = createTheme(vars, { accent: '#d0bcff' });
