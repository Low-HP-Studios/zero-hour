import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_PATH = "public/assets/map/map1.glb";
const DEFAULT_OUTPUT_PATH = "build/school-blockout/school-blockout-v1.glb";
const DEFAULT_GRASS_TEXTURE_PATH = "public/assets/grass-texture.jpg";
const MODEL_SCALE = 0.25;
const WORLD_MIN = -100;
const WORLD_MAX = 100;
const OUTER_PAD = 20;
const GROUND_Y = -0.02;
const GRASS_METERS_PER_TILE = 400 / 60;

function align4(value) {
  return (value + 3) & ~3;
}

function padBinaryBufferTo4(buffer) {
  const aligned = align4(buffer.length);
  if (aligned === buffer.length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(aligned - buffer.length, 0x00)]);
}

function padJsonBufferTo4(buffer) {
  const aligned = align4(buffer.length);
  if (aligned === buffer.length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(aligned - buffer.length, 0x20)]);
}

function parseGlb(fileBuffer) {
  if (fileBuffer.length < 20) {
    throw new Error("Invalid GLB: file too small.");
  }
  const magic = fileBuffer.readUInt32LE(0);
  const version = fileBuffer.readUInt32LE(4);
  if (magic !== 0x46546c67) {
    throw new Error("Invalid GLB: bad magic.");
  }
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }
  let offset = 12;
  let jsonChunk = null;
  let binChunk = null;
  while (offset + 8 <= fileBuffer.length) {
    const chunkLength = fileBuffer.readUInt32LE(offset);
    const chunkType = fileBuffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > fileBuffer.length) {
      throw new Error("Invalid GLB: chunk overruns file.");
    }
    const chunkData = fileBuffer.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === 0x4e4f534a) {
      jsonChunk = chunkData;
    } else if (chunkType === 0x004e4942) {
      binChunk = chunkData;
    }
  }
  if (!jsonChunk || !binChunk) {
    throw new Error("Invalid GLB: missing JSON or BIN chunk.");
  }
  const jsonText = jsonChunk.toString("utf8").replace(/\0+$/, "");
  return {
    json: JSON.parse(jsonText),
    bin: Buffer.from(binChunk),
  };
}

function createGlb(json, bin) {
  const jsonString = JSON.stringify(json);
  const jsonBuffer = padJsonBufferTo4(Buffer.from(jsonString, "utf8"));
  const binBuffer = padBinaryBufferTo4(bin);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([
    header,
    jsonChunkHeader,
    jsonBuffer,
    binChunkHeader,
    binBuffer,
  ]);
}

function appendBinData(bin, typedArrayOrBuffer) {
  const source = Buffer.isBuffer(typedArrayOrBuffer)
    ? typedArrayOrBuffer
    : Buffer.from(
      typedArrayOrBuffer.buffer,
      typedArrayOrBuffer.byteOffset,
      typedArrayOrBuffer.byteLength,
    );
  const start = align4(bin.length);
  const paddedBin = start > bin.length
    ? Buffer.concat([bin, Buffer.alloc(start - bin.length, 0x00)])
    : bin;
  const nextBin = Buffer.concat([paddedBin, source]);
  return {
    nextBin,
    byteOffset: start,
    byteLength: source.length,
  };
}

function ensureRootArrays(doc) {
  if (!doc.buffers) doc.buffers = [];
  if (!doc.bufferViews) doc.bufferViews = [];
  if (!doc.accessors) doc.accessors = [];
  if (!doc.images) doc.images = [];
  if (!doc.samplers) doc.samplers = [];
  if (!doc.textures) doc.textures = [];
  if (!doc.materials) doc.materials = [];
  if (!doc.meshes) doc.meshes = [];
  if (!doc.nodes) doc.nodes = [];
  if (!doc.scenes) doc.scenes = [{ nodes: [] }];
}

function addOuterGround(doc, bin, grassTexturePath) {
  const mapSpan = (WORLD_MAX - WORLD_MIN) + OUTER_PAD;
  const half = mapSpan / 2;
  const tiles = mapSpan / GRASS_METERS_PER_TILE;
  const positions = new Float32Array([
    -half, 0, -half,
    half, 0, -half,
    half, 0, half,
    -half, 0, half,
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    tiles, 0,
    tiles, tiles,
    0, tiles,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const grassBytes = fs.readFileSync(grassTexturePath);

  let nextBin = bin;
  const posAppended = appendBinData(nextBin, positions);
  nextBin = posAppended.nextBin;
  const normalAppended = appendBinData(nextBin, normals);
  nextBin = normalAppended.nextBin;
  const uvAppended = appendBinData(nextBin, uvs);
  nextBin = uvAppended.nextBin;
  const indexAppended = appendBinData(nextBin, indices);
  nextBin = indexAppended.nextBin;
  const imageAppended = appendBinData(nextBin, grassBytes);
  nextBin = imageAppended.nextBin;

  const bufferIndex = 0;

  const posViewIndex = doc.bufferViews.push({
    buffer: bufferIndex,
    byteOffset: posAppended.byteOffset,
    byteLength: posAppended.byteLength,
    target: 34962,
  }) - 1;
  const normalViewIndex = doc.bufferViews.push({
    buffer: bufferIndex,
    byteOffset: normalAppended.byteOffset,
    byteLength: normalAppended.byteLength,
    target: 34962,
  }) - 1;
  const uvViewIndex = doc.bufferViews.push({
    buffer: bufferIndex,
    byteOffset: uvAppended.byteOffset,
    byteLength: uvAppended.byteLength,
    target: 34962,
  }) - 1;
  const indexViewIndex = doc.bufferViews.push({
    buffer: bufferIndex,
    byteOffset: indexAppended.byteOffset,
    byteLength: indexAppended.byteLength,
    target: 34963,
  }) - 1;
  const imageViewIndex = doc.bufferViews.push({
    buffer: bufferIndex,
    byteOffset: imageAppended.byteOffset,
    byteLength: imageAppended.byteLength,
  }) - 1;

  const posAccessorIndex = doc.accessors.push({
    bufferView: posViewIndex,
    byteOffset: 0,
    componentType: 5126,
    count: 4,
    type: "VEC3",
    min: [-half, 0, -half],
    max: [half, 0, half],
  }) - 1;
  const normalAccessorIndex = doc.accessors.push({
    bufferView: normalViewIndex,
    byteOffset: 0,
    componentType: 5126,
    count: 4,
    type: "VEC3",
  }) - 1;
  const uvAccessorIndex = doc.accessors.push({
    bufferView: uvViewIndex,
    byteOffset: 0,
    componentType: 5126,
    count: 4,
    type: "VEC2",
  }) - 1;
  const indexAccessorIndex = doc.accessors.push({
    bufferView: indexViewIndex,
    byteOffset: 0,
    componentType: 5123,
    count: 6,
    type: "SCALAR",
    min: [0],
    max: [3],
  }) - 1;

  const imageIndex = doc.images.push({
    bufferView: imageViewIndex,
    mimeType: "image/jpeg",
    name: "grass-texture",
  }) - 1;
  const samplerIndex = doc.samplers.push({
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497,
  }) - 1;
  const textureIndex = doc.textures.push({
    sampler: samplerIndex,
    source: imageIndex,
    name: "T_Outer_Grass",
  }) - 1;
  const materialIndex = doc.materials.push({
    name: "M_Outer_Grass",
    pbrMetallicRoughness: {
      baseColorTexture: { index: textureIndex },
      baseColorFactor: [0.95, 0.98, 0.95, 1],
      metallicFactor: 0,
      roughnessFactor: 0.96,
    },
  }) - 1;
  const meshIndex = doc.meshes.push({
    name: "OuterGround",
    primitives: [{
      attributes: {
        POSITION: posAccessorIndex,
        NORMAL: normalAccessorIndex,
        TEXCOORD_0: uvAccessorIndex,
      },
      indices: indexAccessorIndex,
      material: materialIndex,
      mode: 4,
    }],
  }) - 1;
  const nodeIndex = doc.nodes.push({
    name: "OuterGround",
    mesh: meshIndex,
    translation: [0, GROUND_Y, 0],
  }) - 1;

  return {
    nextBin,
    outerGroundNodeIndex: nodeIndex,
  };
}

function wrapOriginalMapNodes(doc) {
  const defaultSceneIndex = doc.scene ?? 0;
  const defaultScene = doc.scenes[defaultSceneIndex];
  const originalNodes = [...(defaultScene.nodes ?? [])];
  const wrapperNodeIndex = doc.nodes.push({
    name: "SchoolMapScaled",
    scale: [MODEL_SCALE, MODEL_SCALE, MODEL_SCALE],
    children: originalNodes,
  }) - 1;
  defaultScene.nodes = [wrapperNodeIndex];
  return { defaultSceneIndex };
}

function exportComposedMap(sourcePath, outputPath, grassTexturePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source map not found: ${sourcePath}`);
  }
  if (!fs.existsSync(grassTexturePath)) {
    throw new Error(`Grass texture not found: ${grassTexturePath}`);
  }

  const sourceBytes = fs.readFileSync(sourcePath);
  const { json, bin } = parseGlb(sourceBytes);
  ensureRootArrays(json);
  if (json.buffers.length === 0) {
    json.buffers.push({ byteLength: 0 });
  }
  if (!json.buffers[0]) {
    json.buffers[0] = { byteLength: 0 };
  }

  const { defaultSceneIndex } = wrapOriginalMapNodes(json);
  const outer = addOuterGround(json, bin, grassTexturePath);
  json.scenes[defaultSceneIndex].nodes.push(outer.outerGroundNodeIndex);
  json.buffers[0].byteLength = outer.nextBin.length;

  const outputBytes = createGlb(json, outer.nextBin);
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, outputBytes);
  return outputPath;
}

function resolvePaths() {
  const sourceArg = process.argv[2];
  const outputArg = process.argv[3];
  const grassArg = process.argv[4];
  return {
    sourcePath: path.resolve(sourceArg || DEFAULT_SOURCE_PATH),
    outputPath: path.resolve(outputArg || DEFAULT_OUTPUT_PATH),
    grassTexturePath: path.resolve(grassArg || DEFAULT_GRASS_TEXTURE_PATH),
  };
}

try {
  const { sourcePath, outputPath, grassTexturePath } = resolvePaths();
  const absolutePath = exportComposedMap(sourcePath, outputPath, grassTexturePath);
  console.log(`Exported composed map to: ${absolutePath}`);
} catch (error) {
  console.error("Failed to export composed map:");
  console.error(error);
  process.exit(1);
}
