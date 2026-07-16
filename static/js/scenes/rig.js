/* Scenes mount only near the viewport and fully unmount when far away,
   so the page never holds more than a few GPU contexts at once. */
import { applyStudio } from './lib.js';
import { heavyScenesEnabled, reducedMotion, MAX_DPR, FRAME_MS } from './power.js';

const NEAR = '240px 0px';

function disposeObject(obj) {
  if (obj.geometry) obj.geometry.dispose();
  const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
  for (const m of mats) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
}

export function mountScene(host, builder) {
  const THREE = window.THREE;
  if (!host || !THREE || !('IntersectionObserver' in window)) return;
  /* on mobile / low-power the section keeps its CSS poster, no WebGL */
  if (host.classList.contains('scene-bg') && !heavyScenesEnabled) return;
  const reduced = reducedMotion;

  let active = null;

  function unmount() {
    if (!active) return;
    const a = active;
    active = null;
    a.running = false;
    a.ro.disconnect();
    document.removeEventListener('visibilitychange', a.onVis);
    a.scene.traverse(disposeObject);
    if (a.envTexture) a.envTexture.dispose();
    a.renderer.dispose();
    a.renderer.forceContextLoss();
    if (a.renderer.domElement.parentNode === host) host.removeChild(a.renderer.domElement);
  }

  function mount() {
    if (active || host.clientWidth === 0) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    let ctx;
    let envTexture = null;
    try {
      envTexture = applyStudio(THREE, renderer, scene);
      ctx = builder(THREE, scene, host);
    } catch {
      host.removeChild(renderer.domElement);
      renderer.dispose();
      return;
    }
    function frameShift() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      const side = host.dataset.shift;
      if (!side || w < 861) {
        ctx.camera.clearViewOffset();
        return;
      }
      const dx = (side === 'right' ? -1 : 1) * w * 0.15;
      ctx.camera.setViewOffset(w, h, dx, 0, w, h);
    }

    ctx.camera.aspect = host.clientWidth / host.clientHeight;
    frameShift();
    ctx.camera.updateProjectionMatrix();

    const clock = new THREE.Clock();
    const a = {
      renderer, scene, ctx, envTexture, running: true,
      ro: null, onVis: null,
    };

    let last = 0;
    function frame(now) {
      if (!active || active !== a || !a.running) return;
      if (!reduced) requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      try {
        ctx.update(clock.getElapsedTime());
        renderer.render(scene, ctx.camera);
      } catch {
        a.running = false;
      }
    }

    let resizeQueued = false;
    a.ro = new ResizeObserver(() => {
      if (resizeQueued || !active) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        if (!active || active !== a) return;
        ctx.camera.aspect = host.clientWidth / host.clientHeight;
        frameShift();
        ctx.camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
        if (reduced) {
          a.running = true;
          frame();
        }
      });
    });
    a.ro.observe(host);

    a.onVis = () => {
      if (!active || active !== a || reduced) return;
      const run = !document.hidden;
      if (run && !a.running) {
        a.running = true;
        clock.getDelta();
        requestAnimationFrame(frame);
      }
      if (!run) a.running = false;
    };
    document.addEventListener('visibilitychange', a.onVis);

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (active === a) a.running = false;
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      if (active === a && !document.hidden && !reduced) {
        a.running = true;
        clock.getDelta();
        requestAnimationFrame(frame);
      }
    });

    active = a;
    if (reduced) {
      try {
        ctx.update(0.5);
        renderer.render(scene, ctx.camera);
      } catch { unmount(); }
      a.running = false;
      return;
    }
    requestAnimationFrame((t) => frame(t || 0));
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) mount();
    else unmount();
  }, { rootMargin: NEAR, threshold: 0 }).observe(host);
}
