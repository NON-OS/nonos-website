import { CYAN, stdLights, glow, dust, gridFloor, textSprite, setOrb } from './lib.js';

const STAGES = [
  { label: 'BOOTLOADER', log: 'ed25519 verify .. ok', kind: 'octa' },
  { label: 'KERNEL', log: 'rollback 1000 >= floor', kind: 'icosa' },
  { label: 'CAPSULES', log: 'manifests 14/14 ok', kind: 'capsule' },
  { label: 'ATTESTATION', log: '[ZK-ATTEST] ok', kind: 'ring' },
  { label: 'DESKTOP', log: 'compositor up', kind: 'screen' },
];
const SEG = 1.5;
const X0 = -4.0;
const SP = 2.0;
const HOLD = 3.4;
const FADE = 1.0;
const CYCLE = 0.5 + SEG * (STAGES.length - 1) + HOLD + FADE;
const DIST = 9.5;
const FOV_TAN = Math.tan((38 / 2) * (Math.PI / 180));
const RAW_SPAN = SP * 4 + 2.4;
const RAW_CENTER = X0 + SP * 2;

function emblem(THREE, kind) {
  if (kind === 'icosa') return new THREE.IcosahedronGeometry(0.44, 0);
  if (kind === 'capsule') return new THREE.CapsuleGeometry(0.25, 0.48, 6, 12);
  if (kind === 'ring') return new THREE.TorusGeometry(0.34, 0.1, 10, 32);
  if (kind === 'screen') return new THREE.BoxGeometry(0.72, 0.48, 0.1);
  return new THREE.OctahedronGeometry(0.42);
}

export function buildBootseq(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -1.85, size: 34, opacity: 0.24 });
  dust(THREE, scene, { count: 100, spread: 9 });

  const g = new THREE.Group();
  scene.add(g);

  const railMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, SP * 4 + 0.8, 6, 1, true), railMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.x = X0 + SP * 2;
  g.add(rail);

  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 10),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0 }),
  );
  spark.add(glow(THREE, { scale: 1.2, opacity: 0.6 }));
  g.add(spark);

  const items = STAGES.map((s, i) => {
    const x = X0 + i * SP;

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.72, 0.12, 24),
      new THREE.MeshStandardMaterial({
        color: 0x10161c, metalness: 0.5, roughness: 0.4,
        emissive: CYAN, emissiveIntensity: 0.08,
      }),
    );
    pedestal.position.set(x, -1.05, 0);
    g.add(pedestal);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2128, metalness: 0.5, roughness: 0.32,
      emissive: CYAN, emissiveIntensity: 0.05,
    });
    const mesh = new THREE.Mesh(emblem(THREE, s.kind), mat);
    mesh.position.set(x, 0, 0);
    g.add(mesh);

    const halo = glow(THREE, { scale: 2, opacity: 0.08 });
    halo.position.copy(mesh.position);
    g.add(halo);

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.09, 0.9, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    column.position.set(x, -0.55, 0);
    g.add(column);

    const ringMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.022, 8, 40), ringMat);
    ring.position.copy(mesh.position);
    g.add(ring);

    const tag = textSprite(THREE, s.label, { scale: 0.5, color: 'rgba(150,240,244,0.8)' });
    tag.position.set(x, -1.55, 0);
    tag.material.opacity = 0.25;
    g.add(tag);

    const logY = 1.25 + (i % 2) * 0.62;
    const log = textSprite(THREE, s.log, { scale: 0.5, color: 'rgba(225,255,255,0.95)' });
    log.position.set(x, logY, 0.3 + i * 0.02);
    log.material.opacity = 0;
    g.add(log);

    return { mesh, mat, halo, ring, ringMat, tag, log, pedestal, column, x, logY, kind: s.kind, igniteAt: 0.5 + i * SEG };
  });

  return {
    camera,
    update(t) {
      const local = t % CYCLE;
      const fadeK = local > CYCLE - FADE ? 1 - (local - (CYCLE - FADE)) / FADE : 1;
      const allAt = 0.5 + SEG * (STAGES.length - 1);

      /* the pulse walks the chain */
      if (local >= 0.5 && local < allAt) {
        const prog = (local - 0.5) / SEG;
        const seg = Math.floor(prog);
        const p = prog - seg;
        spark.position.set(X0 + (seg + p) * SP, 0, 0.15);
        setOrb(spark, 0.95 * fadeK);
      } else if (local < 0.5) {
        spark.position.set(X0, 0, 0.15);
        setOrb(spark, (local / 0.5) * 0.9);
      } else {
        setOrb(spark, 0);
      }

      for (const it of items) {
        const lit = local >= it.igniteAt;
        const age = local - it.igniteAt;
        it.mesh.rotation.y = t * (lit ? 0.9 : 0.25);
        it.mesh.position.y = Math.sin(t * 0.9 + it.x) * 0.06;
        it.halo.position.y = it.mesh.position.y;
        if (it.kind === 'ring') it.mesh.rotation.x = t * 0.5;

        if (lit) {
          const pop = age < 0.7 ? Math.sin(Math.min(age / 0.7, 1) * Math.PI) : 0;
          it.mat.emissiveIntensity = (0.42 + pop * 0.45) * fadeK;
          it.halo.material.opacity = (0.2 + pop * 0.35) * fadeK;
          it.mesh.scale.setScalar(1 + pop * 0.2);
          it.tag.material.opacity = Math.min(0.25 + age * 1.6, 0.95) * fadeK;
          it.log.material.opacity = Math.min(age * 2.4, 0.95) * fadeK;
          it.log.position.y = it.logY + Math.min(age * 0.3, 0.12);
          it.pedestal.material.emissiveIntensity = (0.22 + pop * 0.2) * fadeK;
          it.column.material.opacity = (0.16 + pop * 0.25) * fadeK;
          if (age < 0.8) {
            it.ring.scale.setScalar(1 + age * 2.6);
            it.ringMat.opacity = 0.6 * (1 - age / 0.8) * fadeK;
          } else {
            it.ringMat.opacity = 0;
          }
          if (local > allAt + 0.7) {
            const wave = Math.max(Math.sin(t * 2.4 - it.x * 0.8), 0);
            it.mat.emissiveIntensity = (0.4 + wave * 0.3) * fadeK;
          }
        } else {
          it.mat.emissiveIntensity = 0.05;
          it.halo.material.opacity = 0.04;
          it.mesh.scale.setScalar(1);
          it.tag.material.opacity = 0.25;
          it.log.material.opacity = 0;
          it.ringMat.opacity = 0;
          it.pedestal.material.emissiveIntensity = 0.08;
          it.column.material.opacity = 0.05;
        }
      }

      const litCount = items.filter((it) => local >= it.igniteAt).length;
      railMat.opacity = (0.08 + (litCount / items.length) * 0.16) * fadeK;

      /* fit the rail into the zone the copy leaves free, at any viewport */
      const hw = DIST * FOV_TAN * camera.aspect;
      const sideCopy = camera.aspect > 1.35;
      const left = -0.94 * hw;
      const right = sideCopy ? -0.06 * hw : 0.94 * hw;
      const s = Math.min(1, (right - left) / RAW_SPAN);
      g.scale.setScalar(s);
      g.position.x = (left + right) / 2 - RAW_CENTER * s;

      const az = Math.sin(t * 0.08) * 0.05;
      camera.position.set(Math.sin(az) * DIST, 0.7 + Math.sin(t * 0.05) * 0.25, Math.cos(az) * DIST);
      camera.lookAt(0, -0.1, 0);
    },
  };
}
