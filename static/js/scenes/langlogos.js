import { CYAN, stdLights, glow, dust } from './lib.js';

/* The real NØNOS logomark at the centre, the real language logos orbiting it
   as billboards, each sized by its share of the codebase. */
export function buildLanglogos(THREE, scene, host) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 0.6, 8);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 90, spread: 10 });

  let langs = [];
  try { langs = JSON.parse(host.dataset.langs || '[]'); } catch { langs = []; }

  const loader = new THREE.TextureLoader();
  const tex = (u) => {
    const t = loader.load(u);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };

  const g = new THREE.Group();
  scene.add(g);

  /* centre: the real NØNOS logomark */
  const coreGlow = glow(THREE, { scale: 3.6, opacity: 0.32 });
  g.add(coreGlow);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('/img/logomark.svg'), transparent: true, depthWrite: false }));
  core.scale.set(2.3, 2.3, 1);
  g.add(core);
  /* svg textures can fail in some engines; swap to the png icon if the svg is empty */
  const fallback = tex('/img/icon-512.png');
  setTimeout(() => {
    if (!core.material.map.image || !core.material.map.image.width) {
      core.material.map = fallback;
      core.material.needsUpdate = true;
    }
  }, 400);

  /* orbiting language logos, sized by share */
  const orbit = new THREE.Group();
  orbit.rotation.x = 0.5;
  g.add(orbit);
  const items = langs.map((l, i) => {
    const slug = l.name.toLowerCase();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(`/img/lang/${slug}.png`), transparent: true, depthWrite: false }));
    /* all logos stay legible; the exact proportion lives in the legend.
       Rust reads largest, the rest sit at a comfortable readable floor. */
    const size = 1.3 + Math.sqrt(l.pct / 100) * 0.85;
    sp.scale.set(size, size, 1);
    g.add(sp);
    return {
      sp, size,
      r: 3.4 + (i % 3) * 0.85,
      speed: 0.16 + 0.03 * ((i * 3) % 5),
      phase: (i / Math.max(langs.length, 1)) * Math.PI * 2,
      tilt: (i % 3) * 0.35 - 0.35,
    };
  });

  return {
    camera,
    update(t) {
      core.material.rotation = Math.sin(t * 0.4) * 0.06;
      core.scale.setScalar(2.3 + Math.sin(t * 1.1) * 0.05);
      coreGlow.material.opacity = 0.28 + Math.sin(t * 1.1) * 0.05;

      for (const it of items) {
        const a = it.phase + t * it.speed;
        it.sp.position.set(
          Math.cos(a) * it.r,
          Math.sin(a) * it.r * Math.sin(it.tilt) + Math.sin(t * 0.8 + it.phase) * 0.12,
          Math.sin(a) * it.r * Math.cos(it.tilt),
        );
        /* logos in front read larger; keep depth ordering via renderOrder */
        it.sp.renderOrder = it.sp.position.z > 0 ? 2 : 1;
      }
      core.renderOrder = 1.5;

      const az = Math.sin(t * 0.08) * 0.22;
      camera.position.set(Math.sin(az) * 8, 0.6 + Math.sin(t * 0.06) * 0.3, Math.cos(az) * 8);
      camera.lookAt(0, 0, 0);
    },
  };
}
