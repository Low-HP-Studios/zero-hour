import * as THREE from "three";

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createSkyTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = 512;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#6ab4e8");
  gradient.addColorStop(0.3, "#8ec8ee");
  gradient.addColorStop(0.52, "#c8dce8");
  gradient.addColorStop(0.68, "#f0c88a");
  gradient.addColorStop(0.82, "#e8a86a");
  gradient.addColorStop(1, "#c08050");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createLinearGradient(0, height * 0.55, 0, height);
  haze.addColorStop(0, "rgba(240, 210, 160, 0)");
  haze.addColorStop(0.5, "rgba(240, 200, 140, 0.25)");
  haze.addColorStop(1, "rgba(220, 180, 120, 0.5)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createNightSkyTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = 512;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  // Deep navy gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#050d1a");
  gradient.addColorStop(0.3, "#0a1628");
  gradient.addColorStop(0.6, "#0e1f38");
  gradient.addColorStop(0.85, "#121a2a");
  gradient.addColorStop(1, "#0c1220");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Stars
  const rng = createSeededRandom(77777);
  for (let i = 0; i < 300; i++) {
    const x = rng() * width;
    const y = rng() * height * 0.85; // Stars mostly in upper part
    const radius = 0.3 + rng() * 1.4;
    const brightness = 0.3 + rng() * 0.7;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // A few brighter / larger stars
  for (let i = 0; i < 20; i++) {
    const x = rng() * width;
    const y = rng() * height * 0.7;
    const radius = 1.2 + rng() * 1.0;
    ctx.beginPath();
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    grd.addColorStop(0, "rgba(200, 220, 255, 0.9)");
    grd.addColorStop(0.4, "rgba(180, 200, 240, 0.3)");
    grd.addColorStop(1, "rgba(150, 180, 220, 0)");
    ctx.fillStyle = grd;
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createGrassTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(45109);

  // Soft radial-ish base with gentle variation instead of a linear gradient
  ctx.fillStyle = "#3d7a35";
  ctx.fillRect(0, 0, size, size);

  // Layered noise patches for organic variation
  for (let i = 0; i < 2400; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 6 + rng() * 18;
    const tone = rng();
    const r = tone > 0.6 ? 72 : tone > 0.3 ? 58 : 48;
    const g = tone > 0.6 ? 138 : tone > 0.3 ? 118 : 96;
    const b = tone > 0.6 ? 60 : tone > 0.3 ? 48 : 36;
    const alpha = 0.04 + rng() * 0.08;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Small dots that look like grass clumps (not rectangles)
  for (let i = 0; i < 4000; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.4 + rng() * 1.2;
    const alpha = 0.06 + rng() * 0.12;
    const tone = rng();
    const r = tone > 0.7 ? 110 : tone > 0.35 ? 80 : 56;
    const g = tone > 0.7 ? 170 : tone > 0.35 ? 140 : 105;
    const b = tone > 0.7 ? 74 : tone > 0.35 ? 58 : 40;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle light highlights (no visible lines)
  for (let i = 0; i < 600; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 1.5 + rng() * 4;
    const alpha = 0.02 + rng() * 0.04;
    ctx.beginPath();
    ctx.fillStyle = `rgba(180, 220, 150, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  texture.needsUpdate = true;
  return texture;
}

export function createTundraTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(823451);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#edf4fb");
  base.addColorStop(0.4, "#d9e5f0");
  base.addColorStop(0.72, "#c6d4df");
  base.addColorStop(1, "#b2c0cd");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2600; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 8 + rng() * 26;
    const alpha = 0.025 + rng() * 0.07;
    const bright = 210 + Math.floor(rng() * 35);
    const tint = 225 + Math.floor(rng() * 25);
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grd.addColorStop(0, `rgba(${bright}, ${bright + 6}, ${Math.min(255, tint + 8)}, ${alpha})`);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  for (let i = 0; i < 300; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 10 + rng() * 34;
    const alpha = 0.08 + rng() * 0.1;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grd.addColorStop(0, `rgba(118, 130, 140, ${alpha})`);
    grd.addColorStop(0.55, `rgba(126, 136, 146, ${alpha * 0.45})`);
    grd.addColorStop(1, "rgba(126, 136, 146, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  ctx.lineCap = "round";
  for (let i = 0; i < 220; i += 1) {
    const startX = rng() * size;
    const startY = rng() * size;
    const length = 28 + rng() * 90;
    const angle = -0.38 + rng() * 0.28;
    const line = ctx.createLinearGradient(
      startX,
      startY,
      startX + Math.cos(angle) * length,
      startY + Math.sin(angle) * length,
    );
    const alpha = 0.025 + rng() * 0.04;
    line.addColorStop(0, "rgba(255,255,255,0)");
    line.addColorStop(0.3, `rgba(255,255,255,${alpha})`);
    line.addColorStop(0.7, `rgba(190, 208, 220, ${alpha * 0.75})`);
    line.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = line;
    ctx.lineWidth = 1 + rng() * 3.2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(
      startX + Math.cos(angle) * length,
      startY + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  for (let i = 0; i < 1800; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.4 + rng() * 1.1;
    const alpha = 0.04 + rng() * 0.1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.needsUpdate = true;
  return texture;
}

export function createIceTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(991177);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#9dd5de");
  base.addColorStop(0.35, "#6ea9bf");
  base.addColorStop(0.7, "#50839d");
  base.addColorStop(1, "#35586e");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1200; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 10 + rng() * 34;
    const alpha = 0.03 + rng() * 0.06;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grd.addColorStop(0, `rgba(205, 245, 255, ${alpha})`);
    grd.addColorStop(0.5, `rgba(170, 222, 240, ${alpha * 0.7})`);
    grd.addColorStop(1, "rgba(170, 222, 240, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  ctx.lineCap = "round";
  for (let i = 0; i < 180; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const length = 20 + rng() * 74;
    const angle = rng() * Math.PI * 2;
    const alpha = 0.04 + rng() * 0.08;
    ctx.strokeStyle = `rgba(220, 248, 255, ${alpha})`;
    ctx.lineWidth = 0.8 + rng() * 2.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  for (let i = 0; i < 40; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 36 + rng() * 82;
    const grd = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius);
    grd.addColorStop(0, "rgba(235, 252, 255, 0.18)");
    grd.addColorStop(0.5, "rgba(186, 230, 244, 0.08)");
    grd.addColorStop(1, "rgba(186, 230, 244, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.needsUpdate = true;
  return texture;
}
