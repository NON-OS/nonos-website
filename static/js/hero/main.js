import { glowSprite } from './glow.js';
import { buildCore } from './core.js';
import { buildCapsules } from './capsules.js';
import { buildField } from './field.js';
import { CYAN } from './palette.js';
import { applyStudio } from '../scenes/lib.js';
import { FRAME_MS, MAX_DPR } from '../scenes/power.js';

function init() {
  const host = document.getElementById('hero3d');
  const THREE = window.THREE;
  if (!host || !THREE || host.clientWidth === 0) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  applyStudio(THREE, renderer, scene, 0.007);
  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200);
  camera.position.set(0, 1.2, 19);

  function frameShift() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w > 860) camera.setViewOffset(w, h, -w * 0.21, 0, w, h);
    else camera.clearViewOffset();
  }
  frameShift();

  scene.add(new THREE.AmbientLight(0xbfd4d9, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(6, 9, 7);
  scene.add(key);
  scene.add(new THREE.PointLight(CYAN, 2.2, 34));
  scene.add(glowSprite(THREE));

  const core = buildCore(THREE);
  scene.add(core.core);
  scene.add(core.shell);
  const capsules = buildCapsules(THREE, scene);
  const field = buildField(THREE);
  scene.add(field.points);

  let px = 0;
  let py = 0;
  window.addEventListener('pointermove', (e) => {
    px = (e.clientX / window.innerWidth - 0.5) * 2;
    py = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const clock = new THREE.Clock();
  let running = true;

  let last = 0;
  function frame(now) {
    if (running && !reduced) requestAnimationFrame(frame);
    if ((now || 0) - last < FRAME_MS) return;
    last = now || 0;
    try {
      const t = clock.getElapsedTime();
      core.update(t);
      capsules.update(t);
      field.update(t);

      camera.position.x += (px * 1.6 - camera.position.x) * 0.03;
      camera.position.y += (1.2 - py * 1.1 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    } catch {
      running = false;
    }
  }

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    if (!document.hidden && !reduced) {
      running = true;
      clock.getDelta();
      requestAnimationFrame(frame);
    }
  });

  window.addEventListener('resize', () => {
    if (host.clientWidth === 0 || host.clientHeight === 0) return;
    camera.aspect = host.clientWidth / host.clientHeight;
    frameShift();
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    if (reduced) frame();
  });

  if (reduced) {
    frame();
    return;
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta();
      requestAnimationFrame(frame);
    }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const vis = entries[0].isIntersecting;
      if (vis && !running) {
        running = true;
        clock.getDelta();
        requestAnimationFrame(frame);
      }
      if (!vis) running = false;
    }, { threshold: 0.02 }).observe(host);
  }

  requestAnimationFrame(frame);
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);
