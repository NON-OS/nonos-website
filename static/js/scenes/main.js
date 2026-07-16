import { mountScene } from './rig.js';
import { buildVerify } from './verify.js';
import { buildTokens } from './tokens.js';
import { buildRatchet } from './ratchet.js';
import { buildWipe } from './wipe.js';
import { buildStack } from './stack.js';
import { buildReactor } from './reactor.js';
import { buildMerkle } from './merkle.js';
import { buildBootseq } from './bootseq.js';
import { buildInstall } from './install.js';
import { buildLocalstake } from './localstake.js';
import { buildFund } from './fund.js';
import { buildFoundation } from './foundation.js';
import { buildLanglogos } from './langlogos.js';
import { buildDlseal } from './dlseal.js';
import { buildDlhash } from './dlhash.js';
import { buildDlgate } from './dlgate.js';
import { buildDldisk } from './dldisk.js';

const BUILDERS = {
  verify: buildVerify,
  tokens: buildTokens,
  ratchet: buildRatchet,
  wipe: buildWipe,
  stack: buildStack,
  reactor: buildReactor,
  merkle: buildMerkle,
  bootseq: buildBootseq,
  install: buildInstall,
  localstake: buildLocalstake,
  fund: buildFund,
  foundation: buildFoundation,
  langlogos: buildLanglogos,
  dlseal: buildDlseal,
  dlhash: buildDlhash,
  dlgate: buildDlgate,
  dldisk: buildDldisk,
};

function init() {
  document.querySelectorAll('[data-scene]').forEach((el) => {
    const build = BUILDERS[el.dataset.scene];
    if (build) mountScene(el, build);
  });
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);
