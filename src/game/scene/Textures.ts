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
  gradient.addColorStop(0, "#7ec2ff");
  gradient.addColorStop(0.42, "#a8d7ff");
  gradient.addColorStop(0.66, "#f6b894");
  gradient.addColorStop(0.86, "#dd8b67");
  gradient.addColorStop(1, "#b7654c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createLinearGradient(0, height * 0.62, 0, height);
  haze.addColorStop(0, "rgba(255, 228, 193, 0)");
  haze.addColorStop(1, "rgba(255, 170, 122, 0.36)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.62, width, height * 0.38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createSandTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(90210);
  ctx.fillStyle = "#e4cf9f";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2600; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.35 + rng() * 1.1;
    const alpha = 0.08 + rng() * 0.18;
    const tone = rng();
    const r = tone > 0.7 ? 249 : tone > 0.35 ? 232 : 196;
    const g = tone > 0.7 ? 237 : tone > 0.35 ? 212 : 175;
    const b = tone > 0.7 ? 203 : tone > 0.35 ? 178 : 141;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 42; i += 1) {
    const y = rng() * size;
    const amplitude = 2 + rng() * 4;
    const wavelength = 20 + rng() * 28;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.strokeStyle = `rgba(255, 247, 225, ${0.035 + rng() * 0.05})`;

    for (let x = -8; x <= size + 8; x += 6) {
      const rippleY = y + Math.sin(x / wavelength + phase) * amplitude;
      if (x <= -8) {
        ctx.moveTo(x, rippleY);
      } else {
        ctx.lineTo(x, rippleY);
      }
    }

    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.needsUpdate = true;
  return texture;
}

export function createOceanTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(404);
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#2a5f76");
  gradient.addColorStop(0.5, "#326e84");
  gradient.addColorStop(1, "#1e4a61");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 64; i += 1) {
    const y = rng() * size;
    const amplitude = 1.5 + rng() * 4;
    const wavelength = 10 + rng() * 22;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.lineWidth = 1 + rng() * 1.2;
    ctx.strokeStyle = `rgba(184, 233, 246, ${0.035 + rng() * 0.05})`;

    for (let x = -8; x <= size + 8; x += 5) {
      const waveY = y + Math.sin(x / wavelength + phase) * amplitude;
      if (x <= -8) {
        ctx.moveTo(x, waveY);
      } else {
        ctx.lineTo(x, waveY);
      }
    }

    ctx.stroke();
  }

  for (let i = 0; i < 850; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const alpha = 0.02 + rng() * 0.05;
    ctx.fillStyle = `rgba(220, 250, 255, ${alpha})`;
    ctx.fillRect(x, y, 1 + rng() * 1.5, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.needsUpdate = true;
  return texture;
}
