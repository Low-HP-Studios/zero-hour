import type { WeaponKind } from "./Weapon";

const CHARACTER_BASE = '/assets/models/character';
const CUSTOM_CHARACTER_MODEL_URL = '/assets/models/player_with_animations.glb';

export type CharacterTextureEntry = {
  match: string;
  base: string;
  normal?: string;
};

export type CharacterAssetType = "fbx" | "glb";
export type CharacterAnimationMode = "external-fbx" | "embedded-glb";

export type EmbeddedWeaponDefinition = {
  meshName: string;
  socketName: string;
  weaponKind: WeaponKind;
};

export type CharacterDefinition = {
  id: string;
  displayName: string;
  modelUrl: string;
  assetType: CharacterAssetType;
  animationMode: CharacterAnimationMode;
  textureBasePath?: string | null;
  textures?: CharacterTextureEntry[] | null;
  embeddedWeapon?: EmbeddedWeaponDefinition | null;
};

export const DEFAULT_CHARACTER_ID = 'custom-operator';

function createFbxCharacter(
  id: string,
  displayName: string,
  modelPath: string,
  texturePath: string,
  textures: CharacterTextureEntry[] | null,
): CharacterDefinition {
  return {
    id,
    displayName,
    modelUrl: `${CHARACTER_BASE}/${modelPath}`,
    assetType: "fbx",
    animationMode: "external-fbx",
    textureBasePath: `${CHARACTER_BASE}/${texturePath}`,
    textures,
    embeddedWeapon: null,
  };
}

export const CHARACTER_REGISTRY: CharacterDefinition[] = [
  {
    id: 'custom-operator',
    displayName: 'Custom Operator',
    modelUrl: CUSTOM_CHARACTER_MODEL_URL,
    assetType: "glb",
    animationMode: "embedded-glb",
    textureBasePath: null,
    textures: null,
    embeddedWeapon: {
      meshName: "M4",
      socketName: "hand_r_wep",
      weaponKind: "rifle",
    },
  },
  createFbxCharacter(
    'trooper',
    'Trooper',
    'Trooper/tactical guy.fbx',
    'Trooper/tactical guy.fbm/',
    [
      {
        match: 'Body',
        base: 'Body_baseColor_0.png',
        normal: 'Body_normal_1.png',
      },
      {
        match: 'Bottom',
        base: 'Bottom_baseColor_2.png',
        normal: 'Bottom_normal_3.png',
      },
      {
        match: 'Glove',
        base: 'Glove_baseColor_4.png',
        normal: 'Glove_normal_5.png',
      },
      {
        match: 'material_6',
        base: 'material_6_baseColor_12.png',
        normal: 'material_6_normal_13.png',
      },
      {
        match: 'material',
        base: 'material_baseColor_6.png',
        normal: 'material_normal_7.png',
      },
      {
        match: 'Mask',
        base: 'Mask_baseColor_8.png',
        normal: 'Mask_normal_9.png',
      },
      {
        match: 'Shoes',
        base: 'Shoes_baseColor_10.png',
        normal: 'Shoes_normal_11.png',
      },
    ],
  ),
  createFbxCharacter(
    'arabian-girl',
    'Arabian Girl',
    'Arabian Girl/arabian girl.fbx',
    'Arabian Girl/arabian girl.fbm/',
    [
      {
        match: 'arabian_girl',
        base: 'arabian_girl_baseColor_0.png',
        normal: 'arabian_girl_normal_2.png',
      },
      { match: 'eyes', base: 'eyes_baseColor_3.png' },
      { match: 'teeth', base: 'teeth.002_baseColor_4.png' },
    ],
  ),
  createFbxCharacter(
    'chinese-girl',
    'Chinese Girl',
    'Chinese Girl/chinese girl animated.fbx',
    'Chinese Girl/chinese girl animated.fbm/',
    [
      {
        match: '',
        base: 'chinese_girl_baseColor_0.png',
        normal: 'chinese_girl_normal_2.png',
      },
    ],
  ),
  createFbxCharacter(
    'cyborg-girl',
    'Cyborg Girl',
    'Cyborg Girl/Cyborg Girl.fbx',
    'Cyborg Girl/Cyborg Girl.fbm/',
    [{ match: '', base: '_0.png', normal: '_2.png' }],
  ),
  createFbxCharacter(
    'elder-monty',
    'Elder Monty',
    'Elder Monty/dr monty.fbx',
    'Elder Monty/dr monty.fbm/',
    [
      {
        match: 'Body',
        base: 'Body_diffuse_3.png',
        normal: 'Body_normal_5.png',
      },
      {
        match: 'Bottom',
        base: 'Bottom_diffuse_10.png',
        normal: 'Bottom_normal_12.png',
      },
      { match: 'Eyes', base: 'Eyes_diffuse_6.png' },
      {
        match: 'Hair',
        base: 'Hair_diffuse_0.png',
        normal: 'Hair_normal_2.png',
      },
      {
        match: 'Shoes',
        base: 'Shoes_diffuse_7.png',
        normal: 'Shoes_normal_9.png',
      },
    ],
  ),
  createFbxCharacter(
    'indian-girl',
    'Indian Girl',
    'Indian Girl/india girl.fbx',
    'Indian Girl/india girl.fbm/',
    [
      {
        match: '',
        base: 'indian_girl_baseColor_0.png',
        normal: 'indian_girl_normal_2.png',
      },
    ],
  ),
  createFbxCharacter(
    'katherine',
    'Katherine Langford',
    'Katherine Langford/Katherine Langford.fbx',
    'Katherine Langford/Katherine Langford.fbm/',
    [
      {
        match: '',
        base: 'Wolf3D_Avatar.001_baseColor_0.png',
        normal: 'Wolf3D_Avatar.001_normal_2.png',
      },
    ],
  ),
  createFbxCharacter(
    'stylish-man',
    'Stylish Man',
    'Stylish Man/undercover cop.fbx',
    'Stylish Man/undercover cop.fbm/',
    [
      { match: 'body', base: 'body_baseColor_0.png' },
      {
        match: 'bottom',
        base: 'bottom_baseColor_1.png',
        normal: 'bottom_normal_3.png',
      },
      { match: 'eyes', base: 'eyes_baseColor_4.png' },
      {
        match: 'glasses',
        base: 'glasses_Bake1_baseColor_5.png',
        normal: 'glasses_Bake1_normal_7.png',
      },
      {
        match: 'hair',
        base: 'hair_baseColor_8.png',
        normal: 'hair_normal_9.png',
      },
      { match: 'head', base: 'head_baseColor_10.png' },
      {
        match: 'material',
        base: 'material_baseColor_15.png',
        normal: 'material_normal_17.png',
      },
      {
        match: 'shoes',
        base: 'shoes_baseColor_11.png',
        normal: 'shoes_normal_13.png',
      },
      { match: 'teeth', base: 'teeth_baseColor_14.png' },
    ],
  ),
  createFbxCharacter(
    'terrorist',
    'Terrorist',
    'Terrorist/Terrorist.fbx',
    'Terrorist/Terrorist.fbm/',
    [
      {
        match: 'bivakface',
        base: 'bivakface1_baseColor_3.png',
        normal: 'bivakface1_normal_5.png',
      },
      {
        match: 'body',
        base: 'body1A_baseColor_0.png',
        normal: 'body1A_normal_2.png',
      },
    ],
  ),
  createFbxCharacter(
    'winter-soldier',
    'Winter Soldier',
    'Winter Soldier/Male.fbx',
    'Winter Soldier/Male.fbm/',
    [
      {
        match: 'material_1',
        base: 'material_1_baseColor_3.png',
        normal: 'material_1_normal_5.png',
      },
      {
        match: 'material',
        base: 'material_baseColor_0.png',
        normal: 'material_normal_2.png',
      },
    ],
  ),
  createFbxCharacter(
    'zombie',
    'Zombie',
    'Zombie/Zombie.fbx',
    'Zombie/Zombie.fbm/',
    [
      {
        match: '',
        base: 'Scene_-_Root_baseColor_0.png',
        normal: 'Scene_-_Root_normal_3.png',
      },
    ],
  ),
];

export function getCharacterById(id: string): CharacterDefinition {
  return (
    CHARACTER_REGISTRY.find((c) => c.id === id) ??
    CHARACTER_REGISTRY.find((c) => c.id === DEFAULT_CHARACTER_ID)!
  );
}
