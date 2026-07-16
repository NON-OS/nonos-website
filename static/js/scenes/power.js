/* One place decides whether heavy 3D runs and how hard. */
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const coarse = window.matchMedia('(max-width: 860px)').matches;

/* Actually probe WebGL rather than guess from core/memory counts, which
   in-app browsers (X, Telegram, Instagram) misreport or omit. If a context
   can be created, the scenes run; the rig's per-scene try/catch handles any
   later failure by leaving the CSS gradient poster in place. */
function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext
      && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

const supported = 'IntersectionObserver' in window && webglOk();

/* 3D renders wherever WebGL works, in every browser including in-app
   webviews. Only reduced-motion or no-WebGL falls back to the poster. */
export const heavyScenesEnabled = !reducedMotion && supported;
export const isMobile = coarse;

/* full framerate on desktop for smooth motion; 30fps on mobile for battery */
export const FRAME_MS = coarse ? 1000 / 30 : 1000 / 60;

/* render resolution: full retina (2x) for crisp, HD-quality scenes. Only
   one scene animates at a time (mount/unmount), so 2x stays affordable. */
export const MAX_DPR = 2;
