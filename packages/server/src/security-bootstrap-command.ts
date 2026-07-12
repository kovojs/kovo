import './security-bootstrap.js';

import { assertCommandIntrinsics } from './command-intrinsics.js';

/** Private Node command profile loaded by supported command-capable runners (SPEC §6.6 rule 6). */
assertCommandIntrinsics();
