import { CYAN, stdLights, glow, dust, gridFloor, setOrb } from './lib.js';

const LEVELS = 4;
const CYCLE = 5.2;

export function buildMerkle(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -2.7, size: 28, opacity: 0.2 });

  const g = new THREE.Group();
  scene.add(g);

  const leafGeo = new THREE.CapsuleGeometry(0.14, 0.26, 6, 12);
  const nodeGeo = new THREE.OctahedronGeometry(0.2);
  const rootGeo = new THREE.OctahedronGeometry(0.34);
  const nodes = [];

  for (let level = 0; level < LEVELS; level++) {
    const count = 2 ** (LEVELS - 1 - level);
    const y = -1.9 + level * 1.35;
    const spread = 7.4 / count;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * spread;
      const mat = new THREE.MeshStandardMaterial({
        color: level === 0 ? 0xd7e6ea : 0x1a2128,
        metalness: 0.5, roughness: 0.32,
        emissive: CYAN, emissiveIntensity: 0.06,
      });
      const geo = level === 0 ? leafGeo : (level === LEVELS - 1 ? rootGeo : nodeGeo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      if (level === 0) mesh.rotation.z = Math.PI / 2;
      g.add(mesh);
      nodes.push({ mesh, mat, level, i });

      if (level > 0) {
        for (const ci of [i * 2, i * 2 + 1]) {
          const child = nodes.find((n) => n.level === level - 1 && n.i === ci);
          const lmat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09 });
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
            child.mesh.position.clone(), mesh.position.clone(),
          ]), lmat));
        }
      }
    }
  }

  const root = nodes.find((n) => n.level === LEVELS - 1);
  const rootShell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.52, 0),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.2 }),
  );
  rootShell.position.copy(root.mesh.position);
  g.add(rootShell);
  const rootGlow = glow(THREE, { scale: 3, opacity: 0.16 });
  rootGlow.position.copy(root.mesh.position);
  g.add(rootGlow);

  /* light rails along the active authentication path */
  const up = new THREE.Vector3(0, 1, 0);
  const rails = [];
  for (let i = 0; i < LEVELS - 1; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1, true), mat);
    g.add(mesh);
    rails.push({ mesh, mat });
  }
  function layRail(idx, a, b) {
    const r = rails[idx];
    const dir = b.clone().sub(a);
    const len = dir.length();
    r.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    r.mesh.scale.set(1, len, 1);
    r.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
  }

  /* combine pops at each hash node, camera-facing */
  const pops = [];
  for (let i = 0; i < LEVELS - 1; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 8, 40), mat);
    g.add(mesh);
    pops.push({ mesh, mat, at: -9 });
  }

  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 10),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0 }),
  );
  spark.add(glow(THREE, { scale: 1, opacity: 0.6 }));
  g.add(spark);

  /* verification pillar: fires upward from the root on success */
  const pillarMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.05, 2.6, 12, 1, true), pillarMat);
  pillar.position.copy(root.mesh.position).add(new THREE.Vector3(0, 1.4, 0));
  g.add(pillar);

  const shockMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
  });
  const shock = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 10, 48), shockMat);
  shock.position.copy(root.mesh.position);
  g.add(shock);

  const pedestal = glow(THREE, { scale: 1.6, opacity: 0 });
  g.add(pedestal);

  dust(THREE, scene, { count: 100, spread: 8 });

  function pathFor(leaf) {
    const path = [];
    let idx = leaf;
    for (let level = 0; level < LEVELS; level++) {
      path.push(nodes.find((n) => n.level === level && n.i === idx));
      idx = Math.floor(idx / 2);
    }
    return path;
  }

  let laidCycle = -1;

  return {
    camera,
    update(t) {
      const az = Math.sin(t * 0.09) * 0.3;
      camera.position.set(Math.sin(az) * 8.5, 0.6 + Math.sin(t * 0.06) * 0.25, Math.cos(az) * 8.5);
      camera.lookAt(0, 0.2, 0);

      const cycle = Math.floor(t / CYCLE);
      const leaf = (cycle * 3) % 8;
      const local = (t % CYCLE) / CYCLE;
      const path = pathFor(leaf);

      if (cycle !== laidCycle) {
        laidCycle = cycle;
        for (let s = 0; s < LEVELS - 1; s++) {
          layRail(s, path[s].mesh.position, path[s + 1].mesh.position);
          pops[s].at = -9;
        }
      }

      for (const n of nodes) n.mat.emissiveIntensity += (0.06 - n.mat.emissiveIntensity) * 0.08;

      /* the proven leaf sits on a light pedestal for the whole cycle */
      pedestal.position.copy(path[0].mesh.position);
      pedestal.material.opacity = 0.3 + Math.sin(t * 2) * 0.06;
      path[0].mat.emissiveIntensity = 0.5;
      path[0].mesh.rotation.x = t * 1.5;

      const climb = Math.min(local / 0.68, 1) * (LEVELS - 1);
      const seg = Math.min(Math.floor(climb), LEVELS - 2);
      const segP = climb - seg;

      for (let s = 0; s < LEVELS - 1; s++) {
        if (s < seg) rails[s].mat.opacity = 0.3;
        else if (s === seg && local < 0.68) rails[s].mat.opacity = 0.12 + segP * 0.3;
        else if (climb >= LEVELS - 1) rails[s].mat.opacity = 0.3;
        else rails[s].mat.opacity = 0;
      }

      for (let s = 0; s <= seg; s++) path[s].mat.emissiveIntensity = 0.55;

      if (local < 0.68) {
        spark.position.lerpVectors(path[seg].mesh.position, path[seg + 1].mesh.position, segP);
        setOrb(spark, 0.95);
        if (segP > 0.94 && pops[seg].at < 0) {
          pops[seg].at = t;
          pops[seg].mesh.position.copy(path[seg + 1].mesh.position);
        }
      } else {
        setOrb(spark, 0);
        const k = (local - 0.68) / 0.32;
        path[LEVELS - 1].mat.emissiveIntensity = 0.75 - k * 0.3;
        root.mesh.rotation.y = t * 1.4;
        rootShell.rotation.y = -t * 0.7;
        rootShell.material.opacity = 0.2 + Math.sin(k * Math.PI) * 0.3;
        rootGlow.material.opacity = 0.16 + Math.sin(k * Math.PI) * 0.42;
        shock.scale.setScalar(1 + k * 2.6);
        shockMat.opacity = Math.sin(Math.min(k * 1.3, 1) * Math.PI) * 0.5;
        pillarMat.opacity = Math.sin(Math.min(k * 1.2, 1) * Math.PI) * 0.3;
        pillar.scale.y = 0.3 + k * 0.9;
      }

      for (const p of pops) {
        const age = t - p.at;
        if (p.at < 0 || age > 0.7) {
          p.mat.opacity = 0;
          continue;
        }
        p.mesh.scale.setScalar(1 + age * 2.6);
        p.mesh.quaternion.copy(camera.quaternion);
        p.mat.opacity = 0.6 * (1 - age / 0.7);
      }
    },
  };
}
