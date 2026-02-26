export async function loadGlbAsset(_url: string): Promise<null> {
  // Placeholder until we wire real free assets. The pipeline shape stays intact.
  return null;
}

export async function loadAudioAsset(_url: string): Promise<ArrayBuffer | null> {
  // Placeholder. Step 6 adds actual fetch/decode support with graceful fallback.
  return null;
}
