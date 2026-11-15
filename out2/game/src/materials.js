// Procedural textures — Canvas2D only, zero image files, zero network.
// Each texture is drawn once at boot and shared by every mesh that uses it.
import * as THREE from 'three';

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, s, n, colors, rMin = 1, rMax = 3) {
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = 0.12 + Math.random() * 0.25;
    const r = rMin + Math.random() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createMaterials() {
  // Concrete yard floor: warm grey slabs with expansion joints and dust stains.
  const floorTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 900, ['#3a332b', '#5a5145', '#2e2822']);
    ctx.strokeStyle = 'rgba(20,16,12,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * s) / 4, 0); ctx.lineTo((i * s) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 4); ctx.lineTo(s, (i * s) / 4); ctx.stroke();
    }
    // tyre arcs
    ctx.strokeStyle = 'rgba(20,16,12,0.28)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(70, 200, 60, 0.4, 2.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(190, 60, 46, 2.6, 4.6); ctx.stroke();
  }, 8, 6);

  // Corrugated container steel: vertical ribs + rust streaks.
  const containerTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#6e5b3e';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 8, 0, 3, s);
    }
    speckle(ctx, s, 260, ['#7a3b22', '#4a2c1c', '#8a6a45'], 1, 4);
    ctx.fillStyle = 'rgba(240,168,48,0.85)';
    ctx.font = 'bold 34px monospace';
    ctx.fillText('07', 18, 52);
  }, 2, 1);

  // Plaster wall panels with a dado line.
  const wallTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5d5546';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 500, ['#4c4436', '#6b6252', '#3c352c']);
    ctx.fillStyle = 'rgba(20,16,12,0.4)';
    ctx.fillRect(0, s - 26, s, 26);
    ctx.fillStyle = 'rgba(240,168,48,0.5)';
    ctx.fillRect(0, s - 30, s, 3);
  }, 4, 1);

  // Hazard chevrons for bomb-site gates.
  const hazardTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1a1712';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f0a830';
    for (let i = -2; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 32, s);
      ctx.lineTo(i * 32 + 32, 0);
      ctx.lineTo(i * 32 + 48, 0);
      ctx.lineTo(i * 32 + 16, s);
      ctx.closePath();
      ctx.fill();
    }
  }, 3, 1);

  // Big painted site letters + arrows, drawn on sign boards.
  function signTexture(letter, sub, bg, fg) {
    return canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 10;
      ctx.strokeRect(10, 10, s - 20, s - 20);
      ctx.fillStyle = fg;
      ctx.font = 'bold 150px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, s / 2, s / 2 - 18);
      ctx.font = 'bold 26px monospace';
      ctx.fillText(sub, s / 2, s - 52);
    });
  }

  const std = (map, color = 0xffffff, rough = 0.92) => new THREE.MeshStandardMaterial({
    map, color, roughness: rough, metalness: 0.04,
  });

  return {
    floor: std(floorTex, 0xffffff, 0.96),
    container: std(containerTex, 0xffffff, 0.85),
    containerBlue: std(containerTex, 0x7d9bb5, 0.85),
    wall: std(wallTex, 0xffffff, 0.94),
    hazard: std(hazardTex, 0xffffff, 0.9),
    crate: new THREE.MeshStandardMaterial({ color: 0x6b5d43, roughness: 0.9, metalness: 0.05 }),
    crateDark: new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.9, metalness: 0.05 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x3f382c, roughness: 0.85, metalness: 0.08 }),
    silo: new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.6, metalness: 0.35 }),
    signA: new THREE.MeshBasicMaterial({ map: signTexture('A', 'DEPOT', '#241d14', '#f0a830') }),
    signB: new THREE.MeshBasicMaterial({ map: signTexture('B', 'SILO', '#141c24', '#5aa9e6') }),
    dune: new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 1, metalness: 0 }),
  };
}
