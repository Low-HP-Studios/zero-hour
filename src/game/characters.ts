const CHARACTER_BASE = "/assets/models/character";

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

export const CHARACTER_REGISTRY: CharacterDefinition[] = [
  {
    id: "trooper",
    displayName: "Trooper",
    modelUrl: `${CHARACTER_BASE}/Trooper/tactical guy.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Trooper/tactical guy.fbm/`,
    textures: [
      { match: "Body", base: "Body_baseColor_0.png", normal: "Body_normal_1.png" },
      { match: "Bottom", base: "Bottom_baseColor_2.png", normal: "Bottom_normal_3.png" },
      { match: "Glove", base: "Glove_baseColor_4.png", normal: "Glove_normal_5.png" },
      { match: "material_6", base: "material_6_baseColor_12.png", normal: "material_6_normal_13.png" },
      { match: "material", base: "material_baseColor_6.png", normal: "material_normal_7.png" },
      { match: "Mask", base: "Mask_baseColor_8.png", normal: "Mask_normal_9.png" },
      { match: "Shoes", base: "Shoes_baseColor_10.png", normal: "Shoes_normal_11.png" },
    ],
  },
  {
    id: "arabian-girl",
    displayName: "Arabian Girl",
    modelUrl: `${CHARACTER_BASE}/Arabian Girl/arabian girl.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Arabian Girl/arabian girl.fbm/`,
    textures: [
      { match: "arabian_girl", base: "arabian_girl_baseColor_0.png", normal: "arabian_girl_normal_2.png" },
      { match: "eyes", base: "eyes_baseColor_3.png" },
      { match: "teeth", base: "teeth.002_baseColor_4.png" },
    ],
  },
  {
    id: "chinese-girl",
    displayName: "Chinese Girl",
    modelUrl: `${CHARACTER_BASE}/Chinese Girl/chinese girl animated.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Chinese Girl/chinese girl animated.fbm/`,
    textures: [
      { match: "", base: "chinese_girl_baseColor_0.png", normal: "chinese_girl_normal_2.png" },
    ],
  },
  {
    id: "cyborg-girl",
    displayName: "Cyborg Girl",
    modelUrl: `${CHARACTER_BASE}/Cyborg Girl/Cyborg Girl.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Cyborg Girl/Cyborg Girl.fbm/`,
    textures: [
      { match: "", base: "_0.png", normal: "_2.png" },
    ],
  },
  {
    id: "elder-monty",
    displayName: "Elder Monty",
    modelUrl: `${CHARACTER_BASE}/Elder Monty/dr monty.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Elder Monty/dr monty.fbm/`,
    textures: [
      { match: "Body", base: "Body_diffuse_3.png", normal: "Body_normal_5.png" },
      { match: "Bottom", base: "Bottom_diffuse_10.png", normal: "Bottom_normal_12.png" },
      { match: "Eyes", base: "Eyes_diffuse_6.png" },
      { match: "Hair", base: "Hair_diffuse_0.png", normal: "Hair_normal_2.png" },
      { match: "Shoes", base: "Shoes_diffuse_7.png", normal: "Shoes_normal_9.png" },
    ],
  },
  {
    id: "indian-girl",
    displayName: "Indian Girl",
    modelUrl: `${CHARACTER_BASE}/Indian Girl/india girl.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Indian Girl/india girl.fbm/`,
    textures: [
      { match: "", base: "indian_girl_baseColor_0.png", normal: "indian_girl_normal_2.png" },
    ],
  },
  {
    id: "katherine",
    displayName: "Katherine Langford",
    modelUrl: `${CHARACTER_BASE}/Katherine Langford/Katherine Langford.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Katherine Langford/Katherine Langford.fbm/`,
    textures: [
      { match: "", base: "Wolf3D_Avatar.001_baseColor_0.png", normal: "Wolf3D_Avatar.001_normal_2.png" },
    ],
  },
  {
    id: "stylish-man",
    displayName: "Stylish Man",
    modelUrl: `${CHARACTER_BASE}/Stylish Man/undercover cop.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Stylish Man/undercover cop.fbm/`,
    textures: [
      { match: "body", base: "body_baseColor_0.png" },
      { match: "bottom", base: "bottom_baseColor_1.png", normal: "bottom_normal_3.png" },
      { match: "eyes", base: "eyes_baseColor_4.png" },
      { match: "glasses", base: "glasses_Bake1_baseColor_5.png", normal: "glasses_Bake1_normal_7.png" },
      { match: "hair", base: "hair_baseColor_8.png", normal: "hair_normal_9.png" },
      { match: "head", base: "head_baseColor_10.png" },
      { match: "material", base: "material_baseColor_15.png", normal: "material_normal_17.png" },
      { match: "shoes", base: "shoes_baseColor_11.png", normal: "shoes_normal_13.png" },
      { match: "teeth", base: "teeth_baseColor_14.png" },
    ],
  },
  {
    id: "terrorist",
    displayName: "Terrorist",
    modelUrl: `${CHARACTER_BASE}/Terrorist/Terrorist.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Terrorist/Terrorist.fbm/`,
    textures: [
      { match: "bivakface", base: "bivakface1_baseColor_3.png", normal: "bivakface1_normal_5.png" },
      { match: "body", base: "body1A_baseColor_0.png", normal: "body1A_normal_2.png" },
    ],
  },
  {
    id: "winter-soldier",
    displayName: "Winter Soldier",
    modelUrl: `${CHARACTER_BASE}/Winter Soldier/Male.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Winter Soldier/Male.fbm/`,
    textures: [
      { match: "material_1", base: "material_1_baseColor_3.png", normal: "material_1_normal_5.png" },
      { match: "material", base: "material_baseColor_0.png", normal: "material_normal_2.png" },
    ],
  },
  {
    id: "zombie",
    displayName: "Zombie",
    modelUrl: `${CHARACTER_BASE}/Zombie/Zombie.fbx`,
    textureBasePath: `${CHARACTER_BASE}/Zombie/Zombie.fbm/`,
    textures: [
      { match: "", base: "Scene_-_Root_baseColor_0.png", normal: "Scene_-_Root_normal_3.png" },
    ],
  },
];

export function getCharacterById(id: string): CharacterDefinition {
  return (
    CHARACTER_REGISTRY.find((c) => c.id === id) ??
    CHARACTER_REGISTRY.find((c) => c.id === DEFAULT_CHARACTER_ID)!
  );
}
