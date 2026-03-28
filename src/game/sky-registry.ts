export type SkyId =
  | "northern-lights"
  | "anime-sky"
  | "space-nebula";

export type RangeTextureKind = "tundra" | "ice" | "anime" | "space";

export type RangeSurfaceMaterialPreset = {
  floorColor: string;
  floorRoughness: number;
  floorMetalness: number;
  backdropColor: string;
  backdropRoughness: number;
  backdropMetalness: number;
  oceanColor: string;
  oceanRoughness: number;
  oceanMetalness: number;
};

export type RangeSurfaceTheme = {
  floorTexture: RangeTextureKind;
  backdropTexture: RangeTextureKind;
  oceanTexture: RangeTextureKind;
  menu: RangeSurfaceMaterialPreset;
  gameplay: RangeSurfaceMaterialPreset;
};

export type SceneLightingPreset = {
  background: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  skyLight: string;
  groundLight: string;
  hemisphereIntensity: number;
  ambientIntensity: number;
  sunIntensity: number;
  sunColor: string;
  fillIntensity: number;
  fillColor: string;
  menuKeyIntensity: number;
  menuKeyColor: string;
};

export type SkyEnvironmentTheme = {
  range: RangeSurfaceTheme;
  lighting: {
    menu: SceneLightingPreset;
    gameplay: SceneLightingPreset;
  };
};

export type SkyOption = {
  id: SkyId;
  label: string;
  assetUrl: string;
  description: string;
  environmentTheme: SkyEnvironmentTheme;
};

const NORTHERN_LIGHTS_THEME: SkyEnvironmentTheme = {
  range: {
    floorTexture: "tundra",
    backdropTexture: "tundra",
    oceanTexture: "ice",
    menu: {
      floorColor: "#d8e4ec",
      floorRoughness: 0.98,
      floorMetalness: 0.02,
      backdropColor: "#dbe6ee",
      backdropRoughness: 0.99,
      backdropMetalness: 0.02,
      oceanColor: "#8eb3c3",
      oceanRoughness: 0.72,
      oceanMetalness: 0.06,
    },
    gameplay: {
      floorColor: "#edf3f8",
      floorRoughness: 0.96,
      floorMetalness: 0.02,
      backdropColor: "#cfdbe5",
      backdropRoughness: 0.98,
      backdropMetalness: 0.03,
      oceanColor: "#72a6bc",
      oceanRoughness: 0.52,
      oceanMetalness: 0.14,
    },
  },
  lighting: {
    menu: {
      background: "#d3ecfb",
      fog: "#d9eaf4",
      fogNear: 90,
      fogFar: 520,
      skyLight: "#eef8ff",
      groundLight: "#bccbd7",
      hemisphereIntensity: 0.72,
      ambientIntensity: 0.42,
      sunIntensity: 0.72,
      sunColor: "#fff3dd",
      fillIntensity: 0.42,
      fillColor: "#9ccdf0",
      menuKeyIntensity: 0.86,
      menuKeyColor: "#fff0da",
    },
    gameplay: {
      background: "#bddae9",
      fog: "#d7e5ef",
      fogNear: 70,
      fogFar: 430,
      skyLight: "#e4f0fa",
      groundLight: "#afc4d1",
      hemisphereIntensity: 0.8,
      ambientIntensity: 0.32,
      sunIntensity: 0.58,
      sunColor: "#ffe8c9",
      fillIntensity: 0.38,
      fillColor: "#84bfe4",
      menuKeyIntensity: 0.2,
      menuKeyColor: "#ffe1bb",
    },
  },
};

const ANIME_SKY_THEME: SkyEnvironmentTheme = {
  range: {
    floorTexture: "anime",
    backdropTexture: "anime",
    oceanTexture: "anime",
    menu: {
      floorColor: "#c7ddb2",
      floorRoughness: 1,
      floorMetalness: 0,
      backdropColor: "#d9e7c6",
      backdropRoughness: 1,
      backdropMetalness: 0,
      oceanColor: "#9bcbdf",
      oceanRoughness: 0.9,
      oceanMetalness: 0.01,
    },
    gameplay: {
      floorColor: "#b9d39e",
      floorRoughness: 0.98,
      floorMetalness: 0,
      backdropColor: "#cde0b4",
      backdropRoughness: 0.98,
      backdropMetalness: 0,
      oceanColor: "#86bdd5",
      oceanRoughness: 0.84,
      oceanMetalness: 0.02,
    },
  },
  lighting: {
    menu: {
      background: "#bde6ff",
      fog: "#e7f5ff",
      fogNear: 100,
      fogFar: 540,
      skyLight: "#f8fbff",
      groundLight: "#d5ddb4",
      hemisphereIntensity: 0.84,
      ambientIntensity: 0.46,
      sunIntensity: 0.68,
      sunColor: "#fff0c9",
      fillIntensity: 0.48,
      fillColor: "#8fd7ff",
      menuKeyIntensity: 0.82,
      menuKeyColor: "#fff3dc",
    },
    gameplay: {
      background: "#b1dcfb",
      fog: "#dff0fb",
      fogNear: 72,
      fogFar: 460,
      skyLight: "#eff8ff",
      groundLight: "#ccd6ac",
      hemisphereIntensity: 0.78,
      ambientIntensity: 0.34,
      sunIntensity: 0.52,
      sunColor: "#ffe3b8",
      fillIntensity: 0.42,
      fillColor: "#7fcfff",
      menuKeyIntensity: 0.18,
      menuKeyColor: "#ffe3b6",
    },
  },
};

const SPACE_NEBULA_THEME: SkyEnvironmentTheme = {
  range: {
    floorTexture: "space",
    backdropTexture: "space",
    oceanTexture: "space",
    menu: {
      floorColor: "#2b3150",
      floorRoughness: 0.82,
      floorMetalness: 0.16,
      backdropColor: "#232a42",
      backdropRoughness: 0.92,
      backdropMetalness: 0.1,
      oceanColor: "#1d253d",
      oceanRoughness: 0.72,
      oceanMetalness: 0.16,
    },
    gameplay: {
      floorColor: "#303758",
      floorRoughness: 0.72,
      floorMetalness: 0.22,
      backdropColor: "#252c48",
      backdropRoughness: 0.86,
      backdropMetalness: 0.14,
      oceanColor: "#1a2340",
      oceanRoughness: 0.66,
      oceanMetalness: 0.18,
    },
  },
  lighting: {
    menu: {
      background: "#1b1f37",
      fog: "#2a2845",
      fogNear: 88,
      fogFar: 500,
      skyLight: "#b1abf2",
      groundLight: "#2c3150",
      hemisphereIntensity: 0.46,
      ambientIntensity: 0.28,
      sunIntensity: 0.2,
      sunColor: "#9c92ee",
      fillIntensity: 0.54,
      fillColor: "#8f87f0",
      menuKeyIntensity: 1.02,
      menuKeyColor: "#e4dfff",
    },
    gameplay: {
      background: "#181b31",
      fog: "#252844",
      fogNear: 58,
      fogFar: 390,
      skyLight: "#958ff0",
      groundLight: "#242a45",
      hemisphereIntensity: 0.42,
      ambientIntensity: 0.24,
      sunIntensity: 0.12,
      sunColor: "#8680df",
      fillIntensity: 0.46,
      fillColor: "#8e86ef",
      menuKeyIntensity: 0.24,
      menuKeyColor: "#ddd8ff",
    },
  },
};

export const SKY_OPTIONS: readonly SkyOption[] = [
  {
    id: "northern-lights",
    label: "Northern Lights",
    assetUrl: "/assets/sky/sky.glb",
    description: "The original tundra dome. Cold horizon, familiar ghosts.",
    environmentTheme: NORTHERN_LIGHTS_THEME,
  },
  {
    id: "anime-sky",
    label: "Anime Sky",
    assetUrl: "/assets/sky/Skybox Anime Sky.glb",
    description: "Clean daylight with a softer, stylized skyline.",
    environmentTheme: ANIME_SKY_THEME,
  },
  {
    id: "space-nebula",
    label: "Space Nebula",
    assetUrl: "/assets/sky/Skybox Space Nebula.glb",
    description: "Starfield haze for anyone who wants their firing range mildly cosmic.",
    environmentTheme: SPACE_NEBULA_THEME,
  },
] as const;

export const DEFAULT_SKY_ID: SkyId = "northern-lights";
export const DEFAULT_SKY_ASSET_URL = SKY_OPTIONS[0].assetUrl;
export const SKY_IDS = SKY_OPTIONS.map((option) => option.id) as readonly SkyId[];

const SKY_REGISTRY: Record<SkyId, SkyOption> = SKY_OPTIONS.reduce(
  (registry, option) => {
    registry[option.id] = option;
    return registry;
  },
  {} as Record<SkyId, SkyOption>,
);

export function isSkyId(value: unknown): value is SkyId {
  return SKY_IDS.includes(value as SkyId);
}

export function getSkyById(skyId: SkyId): SkyOption {
  return SKY_REGISTRY[skyId] ?? SKY_REGISTRY[DEFAULT_SKY_ID];
}
