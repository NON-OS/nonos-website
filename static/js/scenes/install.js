import { CYAN, stdLights, edges, glow, dust, gridFloor, ease } from './lib.js';

const CYCLE = 5.2;
const SLOTS = 6;
const DIST = 10.4;
const FOV_TAN = Math.tan((40 / 2) * (Math.PI / 180));
const RAW_SPAN = 10.8;
const RAW_CENTER = -0.5;

export function buildInstall(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -1.7, size: 30, opacity: 0.22 });
  dust(THREE, scene, { count: 80, spread: 8 });

  const g = new THREE.Group();
  scene.add(g);

  const track = new THREE.Mesh(
    new THREE.BoxGeometry(10.5, 0.05, 0.7),
    new THREE.MeshStandardMaterial({
      color: 0x10161c, metalness: 0.5, roughness: 0.45,
      emissive: CYAN, emissiveIntensity: 0.06,
    }),
  );
  track.position.y = -0.9;
  g.add(track);

  /* signing station: two pillars, a beam, and a press */
  const pillarGeo = new THREE.BoxGeometry(0.22, 2.5, 0.22);
  const stationMat = new THREE.MeshStandardMaterial({
    color: 0x161d24, metalness: 0.55, roughness: 0.35,
    emissive: CYAN, emissiveIntensity: 0.12,
  });
  for (const z of [-0.75, 0.75]) {
    const p = new THREE.Mesh(pillarGeo, stationMat);
    p.position.set(-1.2, 0.35, z);
    g.add(p);
    const pe = edges(THREE, pillarGeo, CYAN, 0.25);
    pe.position.copy(p.position);
    g.add(pe);
  }
  const beamGeo = new THREE.BoxGeometry(0.32, 0.26, 1.9);
  const beam = new THREE.Mesh(beamGeo, stationMat);
  beam.position.set(-1.2, 1.72, 0);
  g.add(beam);

  const press = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.9, 10),
    stationMat.clone(),
  );
  const stamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.18, 20),
    new THREE.MeshStandardMaterial({
      color: 0x1c2830, metalness: 0.6, roughness: 0.3,
      emissive: CYAN, emissiveIntensity: 0.3,
    }),
  );
  stamp.position.y = -0.52;
  press.add(shaft, stamp);
  press.position.set(-1.2, 1.2, 0);
  g.add(press);

  const stampGlow = glow(THREE, { scale: 2, opacity: 0 });
  stampGlow.position.set(-1.2, -0.2, 0);
  g.add(stampGlow);

  const flashMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
  });
  const flashRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40), flashMat);
  flashRing.rotation.x = Math.PI / 2;
  flashRing.position.set(-1.2, -0.45, 0);
  g.add(flashRing);

  /* payload: crate before signing, capsule after */
  const crate = new THREE.Group();
  const crateGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x2a323b, metalness: 0.35, roughness: 0.5, transparent: true,
  });
  crate.add(new THREE.Mesh(crateGeo, crateMat));
  const crateEdges = edges(THREE, crateGeo, 0xffffff, 0.3);
  crate.add(crateEdges);
  g.add(crate);

  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.5, 6, 14),
    new THREE.MeshStandardMaterial({
      color: 0xd7e6ea, metalness: 0.3, roughness: 0.28,
      transparent: true, emissive: CYAN, emissiveIntensity: 0.4,
    }),
  );
  capsule.rotation.z = Math.PI / 2;
  g.add(capsule);
  const capGlow = glow(THREE, { scale: 1.4, opacity: 0 });
  g.add(capGlow);

  /* the rack of installed capsules */
  const rack = new THREE.Group();
  rack.position.set(3.9, 0.5, 0);
  rack.rotation.y = -0.35;
  g.add(rack);
  const slotGeo = new THREE.BoxGeometry(0.95, 0.72, 0.16);
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const y = 1.0 - row * 0.86;
    const x = (col - 0.5) * 1.1;
    const frame = edges(THREE, slotGeo, CYAN, 0.22);
    frame.position.set(x, y, 0);
    rack.add(frame);
    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.4, 6, 12),
      new THREE.MeshStandardMaterial({
        color: 0xd7e6ea, metalness: 0.3, roughness: 0.3,
        transparent: true, opacity: 0,
        emissive: CYAN, emissiveIntensity: 0.25,
      }),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.set(x, y, 0.05);
    rack.add(cap);
    slots.push({ cap, x, y });
  }

  const slotWorld = new THREE.Vector3();

  return {
    camera,
    update(t) {
      const cycle = Math.floor(t / CYCLE);
      const local = (t % CYCLE) / CYCLE;
      const filled = cycle % (SLOTS + 1);
      const slot = slots[filled % SLOTS];

      for (let i = 0; i < SLOTS; i++) {
        const target = i < filled ? 0.95 : 0;
        slots[i].cap.material.opacity += (target - slots[i].cap.material.opacity) * 0.1;
        slots[i].cap.rotation.x = t * 0.6 + i;
      }

      slot.cap.getWorldPosition(slotWorld);
      g.worldToLocal(slotWorld);

      let crateV = 0;
      let capV = 0;
      let pressY = 1.2;

      if (local < 0.32) {
        const q = ease(local / 0.32);
        crate.position.set(-5.4 + q * 4.2, -0.45, 0);
        crate.rotation.y = q * 1.2;
        crateV = Math.min(local * 12, 1);
      } else if (local < 0.46) {
        const q = (local - 0.32) / 0.14;
        crate.position.set(-1.2, -0.45, 0);
        crateV = 1;
        pressY = 1.2 - Math.sin(q * Math.PI) * 0.62;
        if (q > 0.4 && q < 0.75) {
          flashMat.opacity = 0.7;
          flashRing.scale.setScalar(1);
          stampGlow.material.opacity = 0.5;
        }
      } else if (local < 0.52) {
        const q = (local - 0.46) / 0.06;
        crateV = 1 - q;
        capV = q;
        capsule.position.set(-1.2, -0.45, 0);
        crate.position.set(-1.2, -0.45, 0);
        crate.scale.setScalar(1 - q * 0.4);
      } else if (local < 0.88) {
        const q = ease((local - 0.52) / 0.36);
        capV = 1;
        const arcY = -0.45 + (slotWorld.y + 0.45) * q + Math.sin(q * Math.PI) * 1.1;
        capsule.position.set(-1.2 + (slotWorld.x + 1.2) * q, arcY, slotWorld.z * q);
        capsule.rotation.x = q * 6;
      } else {
        capV = Math.max(1 - (local - 0.88) / 0.06, 0);
        capsule.position.set(slotWorld.x, slotWorld.y, slotWorld.z);
        if (filled < SLOTS) {
          slot.cap.material.opacity = Math.max(slot.cap.material.opacity, (local - 0.88) / 0.12 * 0.95);
        }
      }

      crate.visible = crateV > 0.01;
      crateMat.opacity = crateV;
      crateEdges.material.opacity = crateV * 0.3;
      if (crateV <= 0) crate.scale.setScalar(1);
      capsule.material.opacity = capV;
      capsule.visible = capV > 0.01;
      capGlow.position.copy(capsule.position);
      capGlow.material.opacity = capV * 0.35;

      press.position.y = pressY;
      flashMat.opacity *= 0.9;
      flashRing.scale.setScalar(flashRing.scale.x + flashMat.opacity * 0.12);
      stampGlow.material.opacity *= 0.92;

      /* the line fits the zone the copy leaves free */
      const hw = DIST * FOV_TAN * camera.aspect;
      const sideCopy = camera.aspect > 1.35;
      const left = -0.92 * hw;
      const right = sideCopy ? -0.06 * hw : 0.92 * hw;
      const s = Math.min(1, (right - left) / RAW_SPAN);
      g.scale.setScalar(s);
      g.position.x = (left + right) / 2 - RAW_CENTER * s;

      const az = Math.sin(t * 0.07) * 0.06;
      camera.position.set(Math.sin(az) * DIST, 1.5 + Math.sin(t * 0.05) * 0.3, Math.cos(az) * DIST);
      camera.lookAt(0, -0.1, 0);
    },
  };
}
