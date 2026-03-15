const WEAPON_PREVIEW: Record<"rifle" | "sniper", string> = {
  rifle: "/assets/branding/AKM.jpg",
  sniper: "/assets/branding/Sniper.png",
};

type WeaponThumbnailProps = {
  model?: unknown; // kept for call-site compatibility; unused
  kind: "rifle" | "sniper";
};

export function WeaponThumbnail({ kind }: WeaponThumbnailProps) {
  return (
    <img
      className="pubg-weapon-thumbnail"
      src={WEAPON_PREVIEW[kind]}
      alt={kind}
      draggable={false}
    />
  );
}
