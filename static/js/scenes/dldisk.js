import { CYAN, stdLights, glow, dust, edges } from './lib.js';

/* A stack of disk images floating and spinning, each a thin platter with a
   glowing rim: the artifacts you can download. Bespoke to the artifacts and
   run-it sections. */
export function buildDldisk(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.6, 8.4);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 90, spread: 11 });

  const g = new THREE.Group();
  g.rotation.x = 0.5;
  scene.add(g);

  const platGeo = new THREE.CylinderGeometry(2, 2, 0.14, 56);
  const platters = [];
  const ys = [1.5, 0, -1.5];
  ys.forEach((y, i) => {
    const mesh = new THREE.Mesh(platGeo, new THREE.MeshStandardMaterial({
      color: 0x101820, metalness: 0.65, roughness: 0.28, emissive: CYAN, emissiveIntensity: 0.1,
    }));
    mesh.position.y = y;
    g.add(mesh);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2, 0.02, 8, 64),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y + 0.08;
    g.add(rim);
    /* data grooves */
    for (const r of [0.8, 1.3, 1.7]) {
      const gr = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.008, 6, 56),
        new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.18 }),
      );
      gr.rotation.x = Math.PI / 2;
      gr.position.y = y + 0.08;
      g.add(gr);
    }
    platters.push({ mesh, rim, y, speed: 0.2 + i * 0.08 });
  });

  const glow0 = glow(THREE, { scale: 6, opacity: 0.16 });
  scene.add(glow0);

  const beadMat = new THREE.MeshBasicMaterial({ color: CYAN });
  const beads = ys.map((y, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), beadMat);
    b.add(glow(THREE, { scale: 0.8, opacity: 0.5 }));
    g.add(b);
    return { b, y, r: 1.7, speed: 0.6 + i * 0.2, phase: i * 2 };
  });

  return {
    camera,
    update(t) {
      g.rotation.z = t * 0.14;
      for (const p of platters) {
        p.mesh.rotation.y = t * p.speed;
        p.mesh.position.y = p.y + Math.sin(t * 0.6 + p.y) * 0.08;
        p.rim.position.y = p.mesh.position.y + 0.08;
      }
      /* a read-head bead tracks each platter's groove */
      for (const bd of beads) {
        const a = bd.phase + t * bd.speed;
        bd.b.position.set(Math.cos(a) * bd.r, bd.y + 0.12, Math.sin(a) * bd.r);
      }

      const az = Math.sin(t * 0.08) * 0.22;
      camera.position.set(Math.sin(az) * 8.4, 1.6 + Math.sin(t * 0.06) * 0.35, Math.cos(az) * 8.4);
      camera.lookAt(0, 0, 0);
    },
  };
}
