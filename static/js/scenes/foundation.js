import { CYAN, stdLights, glow, dust, gridFloor, ease } from './lib.js';

/* A protective shell assembles around the trusted core, seals, pulses, then
   dissolves and rebuilds: the small trusted path being sealed. Bespoke to the
   fund page's "why" band. */
const CYCLE = 8;
const HOME_R = 2.0;
const FAR_R = 4.6;

export function buildFoundation(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.4, 9.6);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -3.2, size: 30, opacity: 0.18 });
  dust(THREE, scene, { count: 90, spread: 10 });

  const g = new THREE.Group();
  scene.add(g);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 1),
    new THREE.MeshStandardMaterial({ color: 0x0e1418, metalness: 0.55, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.22 }),
  );
  const coreWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.2, 0),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.3 }),
  );
  g.add(core, coreWire);
  const coreGlow = glow(THREE, { scale: 5, opacity: 0.4 });
  g.add(coreGlow);

  /* shell fragments seat at the vertices of an icosahedron around the core */
  const geo = new THREE.IcosahedronGeometry(HOME_R, 0);
  const pos = geo.attributes.position;
  const seen = new Set();
  const homes = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    homes.push(v.clone());
  }

  const fragGeo = new THREE.TetrahedronGeometry(0.42);
  const up = new THREE.Vector3(0, 1, 0);
  const frags = homes.map((home, i) => {
    const mesh = new THREE.Mesh(fragGeo, new THREE.MeshStandardMaterial({
      color: 0x18424a, metalness: 0.35, roughness: 0.38, transparent: true,
      emissive: CYAN, emissiveIntensity: 0.28,
    }));
    mesh.quaternion.setFromUnitVectors(up, home.clone().normalize());
    g.add(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(fragGeo),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 }),
    );
    mesh.add(edge);
    return { mesh, edge, home, far: home.clone().normalize().multiplyScalar(FAR_R), stagger: (i / homes.length) * 0.55 };
  });

  const ripMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const ripple = new THREE.Mesh(new THREE.TorusGeometry(HOME_R, 0.03, 10, 60), ripMat);
  g.add(ripple);

  let px = 0;
  window.addEventListener('pointermove', (e) => { px = (e.clientX / window.innerWidth - 0.5) * 2; }, { passive: true });
  const tmp = new THREE.Vector3();

  return {
    camera,
    update(t) {
      const local = (t % CYCLE) / CYCLE;
      core.rotation.y = t * 0.2;
      coreWire.rotation.y = -t * 0.14;
      coreWire.rotation.x = Math.sin(t * 0.3) * 0.12;

      let sealed = 0;
      for (const f of frags) {
        /* assemble 0-0.55 (staggered), hold 0.55-0.78, dissolve 0.78-1 */
        let seat;
        if (local < 0.55) {
          const q = Math.min(Math.max((local - f.stagger) / (0.55 - f.stagger), 0), 1);
          seat = ease(q);
        } else if (local < 0.78) {
          seat = 1;
        } else {
          const q = (local - 0.78) / 0.22;
          seat = 1 - ease(Math.min(q + f.stagger * 0.3, 1));
        }
        tmp.lerpVectors(f.far, f.home, seat);
        f.mesh.position.copy(tmp);
        f.mesh.material.emissiveIntensity = 0.15 + seat * 0.45;
        f.edge.material.opacity = 0.2 + seat * 0.5;
        f.mesh.material.opacity = 0.3 + seat * 0.7;
        sealed += seat;
      }

      const full = sealed / frags.length;
      core.material.emissiveIntensity = 0.22 + full * 0.4;
      coreGlow.material.opacity = 0.2 + full * 0.28;

      /* seal pulse at the moment the shell completes */
      if (local > 0.55 && local < 0.62) {
        const k = (local - 0.55) / 0.07;
        ripple.scale.setScalar(1 + k * 1.6);
        ripple.quaternion.copy(camera.quaternion);
        ripMat.opacity = Math.sin(k * Math.PI) * 0.5;
      } else {
        ripMat.opacity *= 0.9;
      }

      const az = Math.sin(t * 0.07) * 0.2 + px * 0.15;
      camera.position.set(Math.sin(az) * 9.6, 1.4 + Math.sin(t * 0.05) * 0.3, Math.cos(az) * 9.6);
      camera.lookAt(0, 0, 0);
    },
  };
}
