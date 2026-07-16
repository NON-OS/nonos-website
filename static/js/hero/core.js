import { CYAN } from './palette.js';

export function buildCore(THREE) {
  const core = new THREE.Group();

  core.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.1, 1),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.38 }),
  ));
  core.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.05, 2),
    new THREE.MeshStandardMaterial({
      color: 0x0e1418,
      metalness: 0.55,
      roughness: 0.32,
      emissive: CYAN,
      emissiveIntensity: 0.1,
    }),
  ));

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(4.1, 0),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.09 }),
  );

  return {
    core,
    shell,
    update(t) {
      core.rotation.y = t * 0.12;
      core.rotation.x = Math.sin(t * 0.18) * 0.08;
      shell.rotation.y = -t * 0.05;
      shell.rotation.z = Math.sin(t * 0.1) * 0.06;
    },
  };
}
