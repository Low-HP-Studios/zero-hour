import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const SCHOOL_SECOND_FLOOR_Y = 6;
const SURFACE_THICKNESS = 0.6;
const DEFAULT_OUTPUT_PATH = "build/school-blockout/school-blockout-v1.glb";

class NodeFileReader {
  constructor() {
    this.result = null;
    this.onloadend = null;
    this.onerror = null;
  }

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    }).catch((error) => {
      this.onerror?.(error);
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      const mimeType = blob.type || "application/octet-stream";
      const base64 = Buffer.from(buffer).toString("base64");
      this.result = `data:${mimeType};base64,${base64}`;
      this.onloadend?.();
    }).catch((error) => {
      this.onerror?.(error);
    });
  }
}

globalThis.FileReader = NodeFileReader;

const SURFACE_PALETTE = {
  yard: "#6d675d",
  interior: "#a49a88",
  upper: "#c2b8a4",
  poolDeck: "#d0c7b0",
  stair: "#968e81",
};

const BLOCKER_PALETTE = {
  wall: "#7f7567",
  railing: "#4f555c",
  cover: "#6a4f39",
};

function slab(minX, maxX, minZ, maxZ, y, material) {
  return {
    kind: "slab",
    minX,
    maxX,
    minZ,
    maxZ,
    y,
    material,
    thickness: SURFACE_THICKNESS,
  };
}

function ramp(minX, maxX, minZ, maxZ, axis, startY, endY, material) {
  return {
    kind: "ramp",
    minX,
    maxX,
    minZ,
    maxZ,
    axis,
    startY,
    endY,
    material,
    thickness: SURFACE_THICKNESS,
  };
}

function volume(minX, maxX, minY, maxY, minZ, maxZ, material = "wall") {
  return {
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    material,
  };
}

const WALKABLE_SURFACES = [
  slab(-48, 48, 18, 64, 0, "yard"),
  slab(-48, 48, -52, -18, 0, "yard"),
  slab(-48, -24, -18, 18, 0, "yard"),
  slab(24, 48, -18, 10, 0, "yard"),
  slab(-24, 24, -18, 18, 0, "interior"),
  slab(24, 30, 12, 18, 0, "poolDeck"),
  slab(30, 46, 10, 16, 0, "poolDeck"),
  slab(30, 46, 34, 40, 0, "poolDeck"),
  slab(28, 34, 16, 34, 0, "poolDeck"),
  slab(40, 46, 16, 34, 0, "poolDeck"),
  slab(-24, 24, -18, 18, SCHOOL_SECOND_FLOOR_Y, "upper"),
  ramp(-24, -18, -8, 8, "x", 0, SCHOOL_SECOND_FLOOR_Y, "stair"),
  ramp(18, 24, -8, 8, "x", SCHOOL_SECOND_FLOOR_Y, 0, "stair"),
];

const BLOCKING_VOLUMES = [
  volume(-24, -6, 0, 4.2, 17.5, 18.5),
  volume(6, 24, 0, 4.2, 17.5, 18.5),
  volume(-24, 24, 4.2, 8.8, 17.5, 18.5),
  volume(-24, -6, 0, 4.2, -18.5, -17.5),
  volume(6, 24, 0, 4.2, -18.5, -17.5),
  volume(-24, 24, 4.2, 8.8, -18.5, -17.5),
  volume(-24.5, -23.5, 0, 8.8, -18, 18),
  volume(23.5, 24.5, 0, 8.8, -18, 10),
  volume(23.5, 24.5, 4.2, 8.8, 10, 18),
  volume(-24, -12, 0, 3.4, -4.5, -3.5),
  volume(-8, 8, 0, 3.4, -4.5, -3.5),
  volume(12, 24, 0, 3.4, -4.5, -3.5),
  volume(-24, -12, 0, 3.4, 3.5, 4.5),
  volume(-8, 8, 0, 3.4, 3.5, 4.5),
  volume(12, 24, 0, 3.4, 3.5, 4.5),
  volume(-24, -12, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, -4.5, -3.5),
  volume(-8, 8, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, -4.5, -3.5),
  volume(12, 24, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, -4.5, -3.5),
  volume(-24, -12, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, 3.5, 4.5),
  volume(-8, 8, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, 3.5, 4.5),
  volume(12, 24, SCHOOL_SECOND_FLOOR_Y, SCHOOL_SECOND_FLOOR_Y + 3.2, 3.5, 4.5),
  volume(30, 46, 0, 2.6, 9.5, 10.5),
  volume(30, 46, 0, 2.6, 39.5, 40.5),
  volume(45.5, 46.5, 0, 2.6, 10, 40),
  volume(34, 40, 0, 1.25, 15.5, 16.5, "railing"),
  volume(34, 40, 0, 1.25, 33.5, 34.5, "railing"),
  volume(33.5, 34.5, 0, 1.25, 16, 34, "railing"),
  volume(39.5, 40.5, 0, 1.25, 16, 34, "railing"),
  volume(-14, -10, 0, 1.6, 30, 34, "cover"),
  volume(10, 14, 0, 1.6, 44, 48, "cover"),
  volume(-4, 4, 0, 1.8, -34, -30, "cover"),
];

function createMaterialCache(palette, prefix) {
  const cache = new Map();
  return (key) => {
    const resolved = key ?? Object.keys(palette)[0];
    if (cache.has(resolved)) {
      return cache.get(resolved);
    }
    const material = new THREE.MeshStandardMaterial({
      color: palette[resolved],
      roughness: 0.9,
      metalness: 0.04,
    });
    material.name = `${prefix}_${resolved}`;
    cache.set(resolved, material);
    return material;
  };
}

function addSurfaceMesh(group, surface, resolveMaterial) {
  const thickness = surface.thickness ?? SURFACE_THICKNESS;
  let geometry;
  let mesh;

  if (surface.kind === "slab") {
    geometry = new THREE.BoxGeometry(
      surface.maxX - surface.minX,
      thickness,
      surface.maxZ - surface.minZ,
    );
    mesh = new THREE.Mesh(geometry, resolveMaterial(surface.material));
    mesh.position.set(
      (surface.minX + surface.maxX) / 2,
      surface.y - thickness / 2,
      (surface.minZ + surface.maxZ) / 2,
    );
  } else {
    const run = surface.axis === "x"
      ? surface.maxX - surface.minX
      : surface.maxZ - surface.minZ;
    const rise = surface.endY - surface.startY;
    const angle = Math.atan2(rise, run);
    const length = Math.hypot(run, rise);
    const centerY = (surface.startY + surface.endY) / 2 -
      (thickness / 2) * Math.cos(angle);
    geometry = surface.axis === "x"
      ? new THREE.BoxGeometry(length, thickness, surface.maxZ - surface.minZ)
      : new THREE.BoxGeometry(surface.maxX - surface.minX, thickness, length);
    mesh = new THREE.Mesh(geometry, resolveMaterial(surface.material));
    mesh.position.set(
      (surface.minX + surface.maxX) / 2,
      centerY,
      (surface.minZ + surface.maxZ) / 2,
    );
    mesh.rotation.set(
      surface.axis === "x" ? 0 : -angle,
      0,
      surface.axis === "x" ? angle : 0,
    );
  }

  mesh.name = `walkable_${surface.kind}_${surface.material ?? "interior"}`;
  group.add(mesh);
}

function addBlockerMesh(group, blocker, resolveMaterial) {
  const geometry = new THREE.BoxGeometry(
    blocker.size[0],
    blocker.size[1],
    blocker.size[2],
  );
  const mesh = new THREE.Mesh(geometry, resolveMaterial(blocker.material));
  mesh.position.set(...blocker.center);
  mesh.name = `blocker_${blocker.material ?? "wall"}`;
  group.add(mesh);
}

function addPoolDetails(group) {
  const poolMaterial = new THREE.MeshStandardMaterial({
    color: "#2f7ea1",
    roughness: 0.22,
    metalness: 0.08,
    transparent: true,
    opacity: 0.86,
  });
  poolMaterial.name = "M_Pool_Water";

  const tileMaterial = new THREE.MeshStandardMaterial({
    color: "#9ba7aa",
    roughness: 0.9,
    metalness: 0.04,
  });
  tileMaterial.name = "M_Pool_Tile";

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.25, 18),
    tileMaterial,
  );
  floor.name = "pool_floor";
  floor.position.set(37, -1.75, 25);
  group.add(floor);

  const water = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 0.12, 17.8),
    poolMaterial,
  );
  water.name = "pool_water";
  water.position.set(37, -1.1, 25);
  group.add(water);
}

function buildSchoolGroup() {
  const group = new THREE.Group();
  group.name = "SchoolBlockout";

  const getSurfaceMaterial = createMaterialCache(SURFACE_PALETTE, "M_School");
  const getBlockerMaterial = createMaterialCache(BLOCKER_PALETTE, "M_Blocker");

  for (const surface of WALKABLE_SURFACES) {
    addSurfaceMesh(group, surface, getSurfaceMaterial);
  }

  for (const blocker of BLOCKING_VOLUMES) {
    addBlockerMesh(group, blocker, getBlockerMaterial);
  }

  addPoolDetails(group);
  return group;
}

async function exportSchoolBlockout(outputPath) {
  const scene = new THREE.Scene();
  scene.name = "SchoolBlockoutScene";
  scene.add(buildSchoolGroup());

  const exporter = new GLTFExporter();
  const buffer = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(Buffer.from(result));
          return;
        }
        reject(new Error("Expected binary GLB export output."));
      },
      (error) => reject(error),
      { binary: true, onlyVisible: true },
    );
  });

  const absoluteOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, buffer);
  return absoluteOutputPath;
}

const outputPath = process.argv[2] || DEFAULT_OUTPUT_PATH;
exportSchoolBlockout(outputPath).then((absolutePath) => {
  console.log(`Exported School blockout to: ${absolutePath}`);
}).catch((error) => {
  console.error("Failed to export School blockout GLB:");
  console.error(error);
  process.exit(1);
});
