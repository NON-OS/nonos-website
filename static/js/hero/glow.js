export function glowSprite(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(160,255,255,0.85)');
  grad.addColorStop(0.35, 'rgba(60,200,210,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  sprite.scale.setScalar(11);
  return sprite;
}
