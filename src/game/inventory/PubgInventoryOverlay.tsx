import { type DragEvent, useMemo } from "react";
import type {
  ControlBindings,
  InventoryItemStackSnapshot,
  InventoryMoveLocation,
  InventoryMoveRequest,
  InventoryMoveResult,
  InventoryPanelSnapshot,
  InventoryWeaponEquipSlot,
  PlayerSnapshot,
} from "../types";
import { formatKeyCode } from "../SettingsPanels";

type PubgInventoryOverlayProps = {
  inventory: InventoryPanelSnapshot;
  player: PlayerSnapshot;
  keybinds: ControlBindings;
  onMoveItem: (request: InventoryMoveRequest) => InventoryMoveResult;
  onQuickMove: (location: InventoryMoveLocation) => InventoryMoveResult;
};

type DragPayload = {
  from: InventoryMoveLocation;
};

const DND_TYPE = "application/x-greytrace-inventory";
const DROP_ZONE_NEARBY = "__drop_to_ground__";

function encodePayload(payload: DragPayload) {
  return JSON.stringify(payload);
}

function decodePayload(raw: string | null): DragPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed || typeof parsed !== "object" || !parsed.from) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function stackQuantityLabel(stack: InventoryItemStackSnapshot | null) {
  if (!stack || stack.quantity <= 1) {
    return "";
  }
  return `x${stack.quantity}`;
}

function resolveWeaponLabel(player: PlayerSnapshot, slot: InventoryWeaponEquipSlot) {
  const snapshot = slot === "primary"
    ? player.weaponLoadout.slotA
    : player.weaponLoadout.slotB;
  if (!snapshot.hasWeapon || !snapshot.weaponKind) {
    return "Empty";
  }

  return snapshot.weaponKind === "rifle" ? "Primary / Rifle" : "Secondary / Sniper";
}

function resolveWeaponAmmo(player: PlayerSnapshot, slot: InventoryWeaponEquipSlot) {
  const snapshot = slot === "primary"
    ? player.weaponLoadout.slotA
    : player.weaponLoadout.slotB;
  if (!snapshot.hasWeapon) {
    return "No weapon equipped";
  }

  return `${snapshot.magAmmo}/${snapshot.maxMagAmmo} | ${
    snapshot.infiniteReserveAmmo ? "∞" : snapshot.reserveAmmo
  }`;
}

function resolveWeaponIcon(player: PlayerSnapshot, slot: InventoryWeaponEquipSlot) {
  const snapshot = slot === "primary"
    ? player.weaponLoadout.slotA
    : player.weaponLoadout.slotB;
  if (!snapshot.weaponKind) {
    return "--";
  }
  return snapshot.weaponKind === "rifle" ? "AR" : "SR";
}

export function PubgInventoryOverlay({
  inventory,
  player,
  keybinds,
  onMoveItem,
  onQuickMove,
}: PubgInventoryOverlayProps) {
  const backpackSlots = inventory.backpack.slots;
  const weaponSlots = player.singleWeaponMode
    ? (["primary"] as const)
    : (["primary", "secondary"] as const);

  const usageLabel = useMemo(() => {
    const used = backpackSlots
      .slice(0, inventory.backpack.capacity)
      .filter((slot) => slot !== null)
      .length;
    return `${used}/${inventory.backpack.capacity}`;
  }, [backpackSlots, inventory.backpack.capacity]);

  const startDrag = (event: DragEvent<HTMLElement>, from: InventoryMoveLocation) => {
    event.dataTransfer.setData(DND_TYPE, encodePayload({ from }));
    event.dataTransfer.effectAllowed = "move";
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const performDrop = (
    event: DragEvent<HTMLElement>,
    target: InventoryMoveLocation,
  ) => {
    event.preventDefault();
    const payload = decodePayload(event.dataTransfer.getData(DND_TYPE));
    if (!payload) {
      return;
    }

    onMoveItem({
      from: payload.from,
      to: target,
    });
  };

  return (
    <div className="inventory-overlay inventory-overlay--mono" role="dialog" aria-label="Inventory">
      <div className="inventory-backdrop" />
      <div className="inventory-shell">
        <section className="inventory-column inventory-column-nearby">
          <header className="inventory-column-header">
            <h2>Nearby / Ground Items</h2>
            <span>{inventory.nearby.length}</span>
          </header>
          <div
            className="inventory-nearby-list"
            onDragOver={allowDrop}
            onDrop={(event) =>
              performDrop(event, {
                zone: "nearby",
                id: DROP_ZONE_NEARBY,
              })}
          >
            {inventory.nearby.length === 0
              ? <div className="inventory-empty">Nothing close enough to loot.</div>
              : null}
            {inventory.nearby.map((item) => (
              <button
                key={item.id}
                type="button"
                className="inventory-item-row"
                draggable
                onDragStart={(event) =>
                  startDrag(event, {
                    zone: "nearby",
                    id: item.id,
                  })}
                onDoubleClick={() =>
                  onQuickMove({
                    zone: "nearby",
                    id: item.id,
                  })}
              >
                <span className="inventory-item-icon">{item.stack.icon}</span>
                <span className="inventory-item-meta">
                  <span className="inventory-item-name">{item.stack.name}</span>
                  <span className="inventory-item-sub">
                    {stackQuantityLabel(item.stack)} {item.distance.toFixed(1)}m
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="inventory-column inventory-column-backpack">
          <header className="inventory-column-header">
            <h2>Inventory / Backpack</h2>
            <span>{usageLabel}</span>
          </header>
          <div className="inventory-backpack-grid">
            {backpackSlots.map((stack, index) => {
              const withinCapacity = index < inventory.backpack.capacity;
              return (
                <div
                  key={`bp-${index}`}
                  className={`inventory-backpack-slot ${withinCapacity ? "" : "locked"}`}
                  onDragOver={withinCapacity ? allowDrop : undefined}
                  onDrop={withinCapacity
                    ? (event) =>
                      performDrop(event, {
                        zone: "backpack",
                        index,
                      })
                    : undefined}
                >
                  {stack
                    ? (
                      <button
                        type="button"
                        className="inventory-slot-chip"
                        draggable={withinCapacity}
                        onDragStart={(event) =>
                          startDrag(event, {
                            zone: "backpack",
                            index,
                          })}
                        onDoubleClick={() =>
                          onQuickMove({
                            zone: "backpack",
                            index,
                          })}
                      >
                        <span className="inventory-item-icon">{stack.icon}</span>
                        <span className="inventory-slot-name">{stack.name}</span>
                        <span className="inventory-slot-qty">{stackQuantityLabel(stack)}</span>
                      </button>
                    )
                    : <span className="inventory-slot-index">{withinCapacity ? index + 1 : ""}</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="inventory-column inventory-column-equipped">
          <header className="inventory-column-header">
            <h2>Equipped Weapons</h2>
            <span>{formatKeyCode(keybinds.tab)}</span>
          </header>

          <div className="inventory-weapon-blocks">
            {weaponSlots.map((weaponSlot) => {
              const isActive = player.weaponLoadout.weaponRaised &&
                (
                  (weaponSlot === "primary" &&
                    player.weaponLoadout.activeSlot === "slotA") ||
                  (weaponSlot === "secondary" &&
                    player.weaponLoadout.activeSlot === "slotB")
                );
              return (
                <div
                  key={weaponSlot}
                  className={`inventory-weapon-slot ${isActive ? "active" : ""}`}
                  onDragOver={allowDrop}
                  onDrop={(event) =>
                    performDrop(event, {
                      zone: "equip",
                      slot: weaponSlot,
                    })}
                >
                  <button
                    type="button"
                    className="inventory-weapon-main"
                    draggable={weaponSlot === "primary"
                      ? player.weaponLoadout.slotA.hasWeapon
                      : player.weaponLoadout.slotB.hasWeapon}
                    onDragStart={(event) =>
                      startDrag(event, {
                        zone: "equip",
                        slot: weaponSlot,
                      })}
                    onDoubleClick={() =>
                      onQuickMove({
                        zone: "equip",
                        slot: weaponSlot,
                      })}
                  >
                    <span className="inventory-item-icon">{resolveWeaponIcon(player, weaponSlot)}</span>
                    <span className="inventory-item-meta">
                      <span className="inventory-item-name">{resolveWeaponLabel(player, weaponSlot)}</span>
                      <span className="inventory-item-sub">{resolveWeaponAmmo(player, weaponSlot)}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
