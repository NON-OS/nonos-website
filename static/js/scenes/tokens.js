import { CYAN, RED, stdLights, glow, dust, ring } from './lib.js';

export function buildTokens(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100);
  camera.position.set(0, 1.5, 5.6);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);

  const center = new THREE.Group();
  center.add(new THREE.Mesh(
    new THREE.CapsuleGeometry(0.44, 0.95, 6, 16),
    new THREE.MeshStandardMaterial({
      color: 0x9fc7ce, metalness: 0.3, roughness: 0.45,
      emissive: CYAN, emissiveIntensity: 0.08,
    }),
  ));
  center.add(new THREE.Mesh(
    new THREE.CapsuleGeometry(0.56, 1.15, 3, 8),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.14 }),
  ));
  scene.add(center);

  const heart = glow(THREE, { scale: 3.4, opacity: 0.26 });
  scene.add(heart);
  dust(THREE, scene, { count: 70, spread: 6 });

  const orbitIn = ring(THREE, 1.5, { opacity: 0.22 });
  const orbitOut = ring(THREE, 2.65, { opacity: 0.1, color: 0xffffff });
  orbitIn.rotation.x = 0.28;
  orbitOut.rotation.x = -0.2;
  scene.add(orbitIn, orbitOut);

  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.08, 1),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.05 }),
  );
  scene.add(shield);

  const geo = new THREE.OctahedronGeometry(0.24);
  const spec = [
    { granted: true, r: 1.5, tilt: 0.28, speed: 0.55, phase: 0 },
    { granted: true, r: 1.5, tilt: 0.28, speed: 0.55, phase: Math.PI },
    { granted: false, r: 2.65, tilt: -0.2, speed: 0.38, phase: Math.PI / 2 },
    { granted: false, r: 2.65, tilt: -0.2, speed: 0.38, phase: -Math.PI / 2 },
  ];
  const tokens = [];
  for (const s of spec) {
    const mat = new THREE.MeshStandardMaterial({
      color: s.granted ? 0xbfeff2 : 0x2a2f36,
      metalness: 0.45, roughness: 0.3,
      emissive: s.granted ? CYAN : RED,
      emissiveIntensity: s.granted ? 0.45 : 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const halo = glow(THREE, {
      scale: 0.9,
      opacity: s.granted ? 0.5 : 0.35,
      color: s.granted ? CYAN : RED,
    });
    mesh.add(halo);
    scene.add(mesh);
    tokens.push({ ...s, mesh });
  }

  let flash = 0;

  return {
    camera,
    update(t) {
      center.rotation.y = t * 0.4;
      center.rotation.x = Math.sin(t * 0.5) * 0.14;
      shield.rotation.y = -t * 0.1;
      orbitIn.rotation.z = t * 0.04;

      for (const tk of tokens) {
        const a = tk.phase + t * tk.speed;
        let r = tk.r;
        if (!tk.granted) {
          r = tk.r - Math.max(Math.sin(t * 0.9 + tk.phase), 0) * 0.58;
          if (r < 2.18) flash = Math.max(flash, 1 - (r - 2.07) / 0.11);
        }
        const y = Math.sin(a) * r * Math.sin(tk.tilt);
        tk.mesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r * Math.cos(tk.tilt));
        tk.mesh.rotation.y = t * 1.2 + tk.phase;
        tk.mesh.rotation.x = t * 0.9;
      }

      flash *= 0.93;
      shield.material.opacity = 0.04 + flash * 0.3;
      heart.material.opacity = 0.2 + Math.sin(t * 1.4) * 0.06 + flash * 0.15;

      camera.position.x = Math.sin(t * 0.13) * 0.5;
      camera.lookAt(0, 0, 0);
    },
  };
}
