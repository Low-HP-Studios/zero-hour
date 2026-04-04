const CHARACTER_BASE = '/assets/models/character';

export type CharacterTextureEntry = {
  match: string;
  base: string;
  normal?: string;
};

export type CharacterDefinition = {
  id: string;
  displayName: string;
  modelUrl: string;
  textureBasePath: string;
  textures: CharacterTextureEntry[] | null;
};

export const DEFAULT_CHARACTER_ID = "trooper";

// Temporary lockdown while the other character rigs still break in FPP.
export const CHARACTER_REGISTRY: CharacterDefinition[] = [
  {
    id: "trooper",
    displayName: "Thulla",
    modelUrl: `${CHARACTER_BASE}/Trooper/tactical guy.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Trooper/tactical guy.fbm/`,
    textures: [
      {
        match: "Body",
        base: "Body_baseColor_0.png",
        normal: "Body_normal_1.png",
      },
      {
        match: "Bottom",
        base: "Bottom_baseColor_2.png",
        normal: "Bottom_normal_3.png",
      },
      {
        match: "Glove",
        base: "Glove_baseColor_4.png",
        normal: "Glove_normal_5.png",
      },
      {
        match: "material_6",
        base: "material_6_baseColor_12.png",
        normal: "material_6_normal_13.png",
      },
      {
        match: "material",
        base: "material_baseColor_6.png",
        normal: "material_normal_7.png",
      },
      {
        match: "Mask",
        base: "Mask_baseColor_8.png",
        normal: "Mask_normal_9.png",
      },
      {
        match: "Shoes",
        base: "Shoes_baseColor_10.png",
        normal: "Shoes_normal_11.png",
      },
    ],
  },
];

export function getCharacterById(id: string): CharacterDefinition {
  return (
    CHARACTER_REGISTRY.find((c) => c.id === id) ??
    CHARACTER_REGISTRY.find((c) => c.id === DEFAULT_CHARACTER_ID)!
  );
}

export function isCharacterId(id: unknown): id is CharacterDefinition["id"] {
  return typeof id === "string" && CHARACTER_REGISTRY.some((c) => c.id === id);
}

export function normalizeCharacterId(id: unknown): CharacterDefinition["id"] {
  return isCharacterId(id) ? id : DEFAULT_CHARACTER_ID;
}
