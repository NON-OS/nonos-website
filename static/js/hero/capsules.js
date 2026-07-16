import { CYAN } from './palette.js';

const COUNT = 9;
const PULSE_PERIOD = 14;
const PULSE_LEN = 1.1;
const UP = { x: 0, y: 1, z: 0 };

export function buildCapsules(THREE, scene) {
  const geo = new THREE.CapsuleGeometry(0.3, 0.85, 6, 14);
  const beamGeo = new THREE.CylinderGeometry(0.035, 0.01, 1, 6, 1, true);
  const up = new THREE.Vector3(UP.x, UP.y, UP.z);
  const items = [];

  for (let i = 0; i < COUNT; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xa9ccd3,
      metalness: 0.3,
      roughness: 0.42,
      transparent: true,
      opacity: 0.95,
      emissive: CYAN,
      emissiveIntensity: 0.06,
    }));

    const pivot = new THREE.Group();
    pivot.rotation.set(
      (Math.PI / 7) * Math.sin(i * 2.39),
      0,
      (Math.PI / 9) * Math.cos(i * 1.7),
    );
    pivot.add(mesh);
    scene.add(pivot);

    const beamMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    scene.add(beam);

    items.push({
      mesh, beam, beamMat,
      r: 5.4 + (i % 4) * 0.95,
      speed: 0.1 + 0.028 * ((i * 5) % 7),
      phase: (i / COUNT) * Math.PI * 2,
      offset: (i / COUNT) * PULSE_PERIOD,
    });
  }

  const wp = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    update(t) {
      for (const c of items) {
        const a = c.phase + t * c.speed;
        c.mesh.position.set(Math.cos(a) * c.r, Math.sin(a * 0.9) * 0.7, Math.sin(a) * c.r * 0.55);
        c.mesh.rotation.x = a * 1.4;
        c.mesh.rotation.z = a * 0.8;

        const cycle = (t + c.offset) % PULSE_PERIOD;
        if (cycle < PULSE_LEN) {
          const k = 1 - Math.abs(cycle / PULSE_LEN - 0.5) * 2;
          c.mesh.getWorldPosition(wp);
          const len = wp.length();
          c.beam.position.copy(wp).multiplyScalar(0.5);
          c.beam.scale.set(1, len, 1);
          dir.copy(wp).normalize();
          c.beam.quaternion.setFromUnitVectors(up, dir);
          c.beamMat.opacity = k * 0.7;
          c.mesh.material.emissiveIntensity = 0.05 + k * 0.5;
        } else if (c.beamMat.opacity > 0) {
          c.beamMat.opacity = 0;
          c.mesh.material.emissiveIntensity = 0.05;
        }
      }
    },
  };
}
