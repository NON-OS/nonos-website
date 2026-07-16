import { initReveals } from './reveal.js';
import { initCounters } from './counters.js';
import { initSpotlight } from './spotlight.js';
import { initCopy } from './copy.js';
import { initSidebarFilter, initCodeCopy, initScrollspy, initHubSearch } from './docs.js';
import { initNav } from './nav.js';

document.documentElement.classList.add('js');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  || !('IntersectionObserver' in window);

initNav();
initReveals(reduced);
initCounters(reduced);
initSpotlight(reduced);
initCopy();
initSidebarFilter();
initCodeCopy();
initScrollspy();
initHubSearch();
