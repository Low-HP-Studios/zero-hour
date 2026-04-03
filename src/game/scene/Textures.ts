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

export function createAnimeGroundTexture(): THREE.CanvasTexture | null {
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

  const rng = createSeededRandom(420221);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#dce9bf");
  base.addColorStop(0.45, "#b9d699");
  base.addColorStop(1, "#96c982");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 60; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 44 + rng() * 96;
    const tint = rng() > 0.5 ? [232, 243, 208] : [170, 214, 154];
    const alpha = 0.08 + rng() * 0.08;
    const grd = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius);
    grd.addColorStop(0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha})`);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (let i = 0; i < 18; i += 1) {
    const startX = rng() * size;
    const startY = rng() * size;
    const endX = startX + (-40 + rng() * 80);
    const endY = startY + (-40 + rng() * 80);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(
      (startX + endX) / 2 + (-24 + rng() * 48),
      (startY + endY) / 2 + (-24 + rng() * 48),
      endX,
      endY,
    );
    ctx.stroke();
  }

  for (let i = 0; i < 1600; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.8 + rng() * 2.6;
    const alpha = 0.03 + rng() * 0.08;
    const color = rng() > 0.68
      ? `rgba(244, 248, 231, ${alpha})`
      : `rgba(130, 184, 114, ${alpha})`;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
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

export function createSpaceFloorTexture(): THREE.CanvasTexture | null {
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

  const rng = createSeededRandom(880031);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#4a4f77");
  base.addColorStop(0.45, "#32385a");
  base.addColorStop(1, "#1a2036");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const panel = size / 4;
  ctx.lineWidth = 2;
  for (let x = 0; x <= size; x += panel) {
    ctx.strokeStyle = "rgba(160, 172, 244, 0.18)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += panel) {
    ctx.strokeStyle = "rgba(160, 172, 244, 0.18)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  for (let i = 0; i < 220; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 10 + rng() * 34;
    const alpha = 0.04 + rng() * 0.08;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grd.addColorStop(0, `rgba(160, 150, 255, ${alpha})`);
    grd.addColorStop(0.55, `rgba(128, 196, 255, ${alpha * 0.55})`);
    grd.addColorStop(1, "rgba(92,170,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  for (let i = 0; i < 900; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.3 + rng() * 1.2;
    const alpha = 0.05 + rng() * 0.1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(220, 228, 255, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(220, 226, 255, 0.13)";
  ctx.lineCap = "round";
  for (let i = 0; i < 120; i += 1) {
    const startX = rng() * size;
    const startY = rng() * size;
    const length = 10 + rng() * 30;
    const angle = rng() * Math.PI * 2;
    ctx.lineWidth = 0.6 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(
      startX + Math.cos(angle) * length,
      startY + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.needsUpdate = true;
  return texture;
}

export function createTdmTileTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 512;
  const tile = 64;
  const grout = 5;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(240913);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#b8b3ab");
  base.addColorStop(0.5, "#969189");
  base.addColorStop(1, "#747068");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      const shade = 118 + Math.floor(rng() * 42);
      const warm = 8 + Math.floor(rng() * 10);
      ctx.fillStyle = `rgb(${shade + warm}, ${shade + 2}, ${shade - 6})`;
      ctx.fillRect(x, y, tile - grout, tile - grout);

      const highlight = ctx.createLinearGradient(x, y, x + tile, y + tile);
      highlight.addColorStop(0, "rgba(255,255,255,0.14)");
      highlight.addColorStop(0.45, "rgba(255,255,255,0.03)");
      highlight.addColorStop(1, "rgba(0,0,0,0.10)");
      ctx.fillStyle = highlight;
      ctx.fillRect(x, y, tile - grout, tile - grout);

      for (let i = 0; i < 16; i += 1) {
        const px = x + rng() * (tile - grout);
        const py = y + rng() * (tile - grout);
        const radius = 0.8 + rng() * 1.8;
        const alpha = 0.03 + rng() * 0.06;
        ctx.beginPath();
        ctx.fillStyle = `rgba(40, 38, 36, ${alpha})`;
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.strokeStyle = "rgba(54, 51, 47, 0.85)";
  ctx.lineWidth = grout;
  for (let x = tile - grout / 2; x < size; x += tile) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = tile - grout / 2; y < size; y += tile) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.needsUpdate = true;
  return texture;
}

export function createTdmBrickTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = 512;
  const height = 512;
  const brickW = 128;
  const brickH = 58;
  const mortar = 4;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(711203);
  ctx.fillStyle = "#989086";
  ctx.fillRect(0, 0, width, height);

  for (let row = 0, y = 0; y < height + brickH; row += 1, y += brickH) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = -offset; x < width + brickW; x += brickW) {
      const tone = 138 + Math.floor(rng() * 42);
      const warm = 10 + Math.floor(rng() * 16);
      const brickWidth = brickW - mortar;
      const brickHeight = brickH - mortar;
      const brickX = x + mortar / 2;
      const brickY = y + mortar / 2;

      ctx.fillStyle = `rgb(${tone + warm}, ${tone + 8}, ${tone - 2})`;
      ctx.fillRect(brickX, brickY, brickWidth, brickHeight);

      const shade = ctx.createLinearGradient(
        brickX,
        brickY,
        brickX,
        brickY + brickHeight,
      );
      shade.addColorStop(0, "rgba(255,255,255,0.15)");
      shade.addColorStop(0.5, "rgba(255,255,255,0.04)");
      shade.addColorStop(1, "rgba(0,0,0,0.10)");
      ctx.fillStyle = shade;
      ctx.fillRect(brickX, brickY, brickWidth, brickHeight);

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(brickX, brickY, brickWidth, 2);
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(brickX, brickY + brickHeight - 2, brickWidth, 2);

      for (let i = 0; i < 10; i += 1) {
        const px = brickX + rng() * brickWidth;
        const py = brickY + rng() * brickHeight;
        const radius = 0.6 + rng() * 1.4;
        const alpha = 0.04 + rng() * 0.07;
        ctx.beginPath();
        ctx.fillStyle = `rgba(62, 54, 50, ${alpha})`;
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  for (let i = 0; i < 50; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const length = 12 + rng() * 26;
    const angle = rng() > 0.5 ? 0 : Math.PI / 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + rng() * 0.05})`;
    ctx.lineWidth = 1 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return texture;
}

export function createTdmContainerTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = 512;
  const height = 512;
  const ribSpacing = 28;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(407221);
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#c9ced3");
  base.addColorStop(0.5, "#8e969d");
  base.addColorStop(1, "#646b74");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  for (let x = 0; x < width; x += ribSpacing) {
    const rib = ctx.createLinearGradient(x, 0, x + ribSpacing, 0);
    rib.addColorStop(0, "rgba(255,255,255,0.12)");
    rib.addColorStop(0.25, "rgba(255,255,255,0.04)");
    rib.addColorStop(0.5, "rgba(0,0,0,0.10)");
    rib.addColorStop(0.75, "rgba(255,255,255,0.05)");
    rib.addColorStop(1, "rgba(0,0,0,0.08)");
    ctx.fillStyle = rib;
    ctx.fillRect(x, 0, ribSpacing, height);

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(x + 2, 0, 2, height);
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(x + ribSpacing - 3, 0, 2, height);
  }

  ctx.fillStyle = "rgba(34, 38, 44, 0.20)";
  ctx.fillRect(0, 0, width, 18);
  ctx.fillRect(0, height - 18, width, 18);
  ctx.fillRect(0, height * 0.33, width, 6);
  ctx.fillRect(0, height * 0.66, width, 6);

  for (let i = 0; i < 180; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const w = 12 + rng() * 38;
    const h = 1 + rng() * 2;
    const alpha = 0.035 + rng() * 0.06;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, w, h);
  }

  for (let i = 0; i < 160; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const radius = 1 + rng() * 2.8;
    const alpha = 0.03 + rng() * 0.05;
    ctx.beginPath();
    ctx.fillStyle = `rgba(28, 30, 34, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.needsUpdate = true;
  return texture;
}
