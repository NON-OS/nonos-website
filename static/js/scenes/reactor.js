import { CYAN, stdLights, glow, dust, gridFloor, liveText, ring, setOrb } from './lib.js';

const FEED_EVERY = 2.3;
const RING_SPECS = [
  { r: 3.0, tiltX: 0.55, tiltZ: 0, speed: 0.3, kind: 'icosa', n: 5 },
  { r: 3.6, tiltX: -0.4, tiltZ: 0.5, speed: -0.24, kind: 'box', n: 5 },
  { r: 4.2, tiltX: 0.2, tiltZ: -0.85, speed: 0.19, kind: 'tetra', n: 5 },
];

function glyphGeo(THREE, kind) {
  if (kind === 'icosa') return new THREE.IcosahedronGeometry(0.19, 0);
  if (kind === 'box') return new THREE.BoxGeometry(0.27, 0.27, 0.27);
  return new THREE.TetrahedronGeometry(0.24);
}

export function buildReactor(THREE, scene, host) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -3.2, size: 34, opacity: 0.2 });
  dust(THREE, scene, { count: 120, spread: 10 });

  let theorems = [];
  try {
    theorems = JSON.parse(host.dataset.items || '[]');
  } catch { theorems = []; }
  if (!theorems.length) theorems = ['no_rollback_after_boot'];

  const g = new THREE.Group();
  scene.add(g);

  /* theorem core */
  const core = new THREE.Group();
  core.add(new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.35, 0),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.3 }),
  ));
  core.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.8, 2),
    new THREE.MeshStandardMaterial({
      color: 0x0e1418, metalness: 0.55, roughness: 0.3,
      emissive: CYAN, emissiveIntensity: 0.22,
    }),
  ));
  g.add(core);
  const coreGlow = glow(THREE, { scale: 4.6, opacity: 0.3 });
  g.add(coreGlow);

  /* three orbit rings carrying proof glyphs */
  const orbits = RING_SPECS.map((spec) => {
    const holder = new THREE.Group();
    holder.rotation.x = spec.tiltX;
    holder.rotation.z = spec.tiltZ;
    g.add(holder);

    holder.add(ring(THREE, spec.r, { opacity: 0.16 }));

    const glyphs = [];
    for (let i = 0; i < spec.n; i++) {
      const mesh = new THREE.Mesh(glyphGeo(THREE, spec.kind), new THREE.MeshStandardMaterial({
        color: 0x9fd4d8, metalness: 0.45, roughness: 0.3,
        emissive: CYAN, emissiveIntensity: 0.3,
      }));
      holder.add(mesh);
      glyphs.push({ mesh, phase: (i / spec.n) * Math.PI * 2 });
    }
    return { holder, glyphs, ...spec };
  });

  /* feeder pulse: a glyph copy dives into the core */
  const feeder = new THREE.Mesh(
    glyphGeo(THREE, 'icosa'),
    new THREE.MeshStandardMaterial({
      color: 0xbfeff2, metalness: 0.4, roughness: 0.3,
      transparent: true, opacity: 0,
      emissive: CYAN, emissiveIntensity: 0.6,
    }),
  );
  feeder.add(glow(THREE, { scale: 1.2, opacity: 0.5 }));
  g.add(feeder);

  const shockMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
  });
  const shock = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.03, 10, 56), shockMat);
  g.add(shock);

  const banner = liveText(THREE, { scale: 0.62 });
  banner.sprite.material.opacity = 0;
  g.add(banner.sprite);

  const from = new THREE.Vector3();
  let feedId = -1;
  let bannerAt = 0;

  return {
    camera,
    update(t) {
      core.rotation.y = t * 0.22;
      core.rotation.x = Math.sin(t * 0.15) * 0.1;
      coreGlow.material.opacity = 0.26 + Math.sin(t * 1.2) * 0.05;

      for (const o of orbits) {
        for (const gl of o.glyphs) {
          const a = gl.phase + t * o.speed;
          gl.mesh.position.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r);
          gl.mesh.rotation.y = t * 1.1 + gl.phase;
          gl.mesh.rotation.x = t * 0.7;
        }
      }

      /* every FEED_EVERY seconds, one orbit sends a proof into the core */
      const id = Math.floor(t / FEED_EVERY);
      const fp = (t % FEED_EVERY) / FEED_EVERY;
      if (id !== feedId) {
        feedId = id;
        const o = orbits[id % orbits.length];
        const gl = o.glyphs[id % o.glyphs.length];
        gl.mesh.getWorldPosition(from);
        g.worldToLocal(from);
        feeder.geometry = gl.mesh.geometry;

        banner.set(theorems[id % theorems.length]);
        banner.sprite.position.set(0, 2.5, 0.5);
        banner.sprite.material.opacity = 0;
        bannerAt = t;
      }

      if (fp < 0.55) {
        const q = fp / 0.55;
        feeder.position.lerpVectors(from, new THREE.Vector3(0, 0, 0), q * q);
        setOrb(feeder, Math.min(q * 5, 0.95));
        feeder.rotation.y = t * 3;
      } else {
        setOrb(feeder, 0);
        const k = (fp - 0.55) / 0.45;
        coreGlow.material.opacity = Math.max(coreGlow.material.opacity, 0.3 + Math.sin(Math.min(k * 1.6, 1) * Math.PI) * 0.3);
        shock.scale.setScalar(1 + k * 1.9);
        shock.quaternion.copy(camera.quaternion);
        shockMat.opacity = Math.sin(Math.min(k * 1.3, 1) * Math.PI) * 0.4;
      }

      {
        const age = t - bannerAt;
        const inK = Math.min(age / 0.4, 1);
        const outK = Math.max((age - 1.6) / 0.6, 0);
        banner.sprite.material.opacity = inK * Math.max(1 - outK, 0) * 0.95;
        banner.sprite.position.y = 2.5 + age * 0.16;
      }

      const az = Math.sin(t * 0.08) * 0.35;
      camera.position.set(Math.sin(az) * 9.3, 1.2 + Math.sin(t * 0.06) * 0.4, Math.cos(az) * 9.3);
      camera.lookAt(0, 0.2, 0);
    },
  };
}
