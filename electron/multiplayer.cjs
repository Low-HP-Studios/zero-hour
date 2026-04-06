const net = require("node:net");

const PROTOCOL_VERSION = 1;
const DEFAULT_HOST_PORT = 7777;
const SNAPSHOT_INTERVAL_MS = 100;
const SOCKET_HEARTBEAT_INTERVAL_MS = 2_000;
const SOCKET_TIMEOUT_MS = 6_500;
const MATCH_MAX_HEALTH = 100;
const MATCH_MAX_MAG_AMMO = 30;
const MATCH_FIRE_INTERVAL_MS = 130;
const MATCH_RELOAD_MS = 3_000;
const MATCH_RESPAWN_MS = 3_000;
const MAX_ALLOWED_STEP_METERS = 5.5;
const MAX_PLAYER_Y = 8;
const MATCH_ENDED_REASONS = new Set([
  "host_disconnected",
  "player_disconnected",
  "host_left",
  "player_left",
  "host_ended_match",
  "player_ended_match",
]);

const MAPS = {
  map1: {
    worldBounds: {
      minX: -41.85,
      maxX: 41.85,
      minZ: -54.85,
      maxZ: 54.85,
    },
    blockers: [
      { center: [0, 1.9, -55], size: [84, 3.8, 0.3] },
      { center: [0, 1.9, 55], size: [84, 3.8, 0.3] },
      { center: [-42, 1.9, 0], size: [0.3, 3.8, 110] },
      { center: [42, 1.9, 0], size: [0.3, 3.8, 110] },
      { center: [0, 1.9, -33], size: [40, 3.8, 0.3] },
      { center: [0, 1.9, 33], size: [40, 3.8, 0.3] },
      { center: [-14, 1.9, -18], size: [20, 3.8, 0.3] },
      { center: [14, 1.9, -18], size: [20, 3.8, 0.3] },
      { center: [-14, 1.9, 18], size: [20, 3.8, 0.3] },
      { center: [14, 1.9, 18], size: [20, 3.8, 0.3] },
      { center: [-24, 1.9, -11], size: [0.3, 3.8, 14] },
      { center: [-24, 1.9, 11], size: [0.3, 3.8, 14] },
      { center: [24, 1.9, -11], size: [0.3, 3.8, 14] },
      { center: [24, 1.9, 11], size: [0.3, 3.8, 14] },
      { center: [0, 3.95, 0], size: [48, 0.3, 36] },
      { center: [-12, 1.3, -6], size: [6, 2.6, 6] },
      { center: [12, 1.3, 6], size: [6, 2.6, 6] },
      { center: [-33, 1.3, -24], size: [5, 2.6, 5] },
      { center: [33, 1.3, -24], size: [5, 2.6, 5] },
      { center: [-33, 1.3, 24], size: [5, 2.6, 5] },
      { center: [33, 1.3, 24], size: [5, 2.6, 5] },
    ],
    spawns: [
      {
        position: [0, 0.5, -50],
        yaw: Math.PI,
        pitch: -0.05,
      },
      {
        position: [0, 0.5, 50],
        yaw: 0,
        pitch: -0.05,
      },
    ],
  },
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeAngleRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const twoPi = Math.PI * 2;
  let normalized = value % twoPi;
  if (normalized > Math.PI) {
    normalized -= twoPi;
  } else if (normalized < -Math.PI) {
    normalized += twoPi;
  }
  return normalized;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildPoint(x, y, z) {
  return { x, y, z };
}

function pointDistance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizePoint(point) {
  const length = Math.sqrt(
    point.x * point.x +
      point.y * point.y +
      point.z * point.z,
  );
  if (length <= 0.0001) {
    return { x: 0, y: 0, z: -1 };
  }
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  };
}

function directionFromYawPitch(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return normalizePoint({
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  });
}

function resolveRightFromYaw(yaw) {
  return {
    x: Math.cos(yaw),
    y: 0,
    z: -Math.sin(yaw),
  };
}

function resolveForwardFromYaw(yaw) {
  return {
    x: -Math.sin(yaw),
    y: 0,
    z: -Math.cos(yaw),
  };
}

function offsetPoint(origin, right, forward, side, up, front = 0) {
  return {
    x: origin.x + right.x * side + forward.x * front,
    y: origin.y + up,
    z: origin.z + right.z * side + forward.z * front,
  };
}

function resolveStandingHitSpheres(origin, right, forward) {
  return [
    { zone: "head", center: offsetPoint(origin, right, forward, 0, 1.54, 0.03), radius: 0.2 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 1.24, 0.05), radius: 0.2 },
    { zone: "body", center: offsetPoint(origin, right, forward, -0.22, 1.08, 0.04), radius: 0.22 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0.22, 1.08, 0.04), radius: 0.22 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 0.95, 0.03), radius: 0.29 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 0.72, 0.01), radius: 0.24 },
    { zone: "leg", center: offsetPoint(origin, right, forward, -0.12, 0.46, 0), radius: 0.21 },
    { zone: "leg", center: offsetPoint(origin, right, forward, 0.12, 0.46, 0), radius: 0.21 },
  ];
}

function resolveCrouchedHitSpheres(origin, right, forward) {
  return [
    { zone: "head", center: offsetPoint(origin, right, forward, 0, 1.18, 0.09), radius: 0.19 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 0.94, 0.08), radius: 0.21 },
    { zone: "body", center: offsetPoint(origin, right, forward, -0.18, 0.82, 0.05), radius: 0.2 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0.18, 0.82, 0.05), radius: 0.2 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 0.7, 0.04), radius: 0.24 },
    { zone: "body", center: offsetPoint(origin, right, forward, 0, 0.52, 0.02), radius: 0.21 },
    { zone: "leg", center: offsetPoint(origin, right, forward, -0.1, 0.34, 0), radius: 0.18 },
    { zone: "leg", center: offsetPoint(origin, right, forward, 0.1, 0.34, 0), radius: 0.18 },
  ];
}

function resolveHitSpheres(player) {
  const origin = buildPoint(player.pose.x, player.pose.y, player.pose.z);
  const right = resolveRightFromYaw(player.pose.bodyYaw);
  const forward = resolveForwardFromYaw(player.pose.bodyYaw);
  return player.pose.crouched
    ? resolveCrouchedHitSpheres(origin, right, forward)
    : resolveStandingHitSpheres(origin, right, forward);
}

function intersectRaySphere(origin, direction, center, radius) {
  const oc = {
    x: origin.x - center.x,
    y: origin.y - center.y,
    z: origin.z - center.z,
  };
  const a = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
  const b = 2 * (oc.x * direction.x + oc.y * direction.y + oc.z * direction.z);
  const c = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }
  const sqrt = Math.sqrt(discriminant);
  const near = (-b - sqrt) / (2 * a);
  if (near > 0) {
    return near;
  }
  const far = (-b + sqrt) / (2 * a);
  return far > 0 ? far : null;
}

function intersectRayAabb(origin, direction, blocker) {
  const minX = blocker.center[0] - blocker.size[0] / 2;
  const maxX = blocker.center[0] + blocker.size[0] / 2;
  const minY = blocker.center[1] - blocker.size[1] / 2;
  const maxY = blocker.center[1] + blocker.size[1] / 2;
  const minZ = blocker.center[2] - blocker.size[2] / 2;
  const maxZ = blocker.center[2] + blocker.size[2] / 2;

  const invX = Math.abs(direction.x) < 0.00001 ? Number.POSITIVE_INFINITY : 1 / direction.x;
  const invY = Math.abs(direction.y) < 0.00001 ? Number.POSITIVE_INFINITY : 1 / direction.y;
  const invZ = Math.abs(direction.z) < 0.00001 ? Number.POSITIVE_INFINITY : 1 / direction.z;

  let tMin = (minX - origin.x) * invX;
  let tMax = (maxX - origin.x) * invX;
  if (tMin > tMax) {
    const swap = tMin;
    tMin = tMax;
    tMax = swap;
  }

  let tyMin = (minY - origin.y) * invY;
  let tyMax = (maxY - origin.y) * invY;
  if (tyMin > tyMax) {
    const swap = tyMin;
    tyMin = tyMax;
    tyMax = swap;
  }

  if (tMin > tyMax || tyMin > tMax) {
    return null;
  }
  tMin = Math.max(tMin, tyMin);
  tMax = Math.min(tMax, tyMax);

  let tzMin = (minZ - origin.z) * invZ;
  let tzMax = (maxZ - origin.z) * invZ;
  if (tzMin > tzMax) {
    const swap = tzMin;
    tzMin = tzMax;
    tzMax = swap;
  }

  if (tMin > tzMax || tzMin > tMax) {
    return null;
  }
  tMin = Math.max(tMin, tzMin);
  tMax = Math.min(tMax, tzMax);

  if (tMax < 0) {
    return null;
  }
  return tMin >= 0 ? tMin : tMax >= 0 ? tMax : null;
}

function resolveEyeHeight(crouched) {
  return crouched ? 1.18 : 1.54;
}

function resolveRifleDamage(distance, zone) {
  if (zone === "head") {
    const oneShotRange = 16;
    const falloffEndRange = 58;
    const t = clamp01((distance - oneShotRange) / (falloffEndRange - oneShotRange));
    return Math.round(125 + (62 - 125) * t);
  }
  if (zone === "leg") {
    return 13;
  }
  return 15;
}

function getMapConfig(mapId) {
  return MAPS[mapId] ?? MAPS.map1;
}

function resolveSpawnConfig(mapId, slotIndex) {
  const map = getMapConfig(mapId);
  const spawn = map.spawns[slotIndex];
  if (spawn) {
    return spawn;
  }
  const ringIndex = Math.max(0, slotIndex - map.spawns.length);
  const angle = (ringIndex / 6) * Math.PI * 2;
  const radius = 26;
  return {
    position: [
      Math.round(Math.sin(angle) * radius * 10) / 10,
      0.5,
      Math.round(Math.cos(angle) * radius * 10) / 10,
    ],
    yaw: normalizeAngleRadians(angle + Math.PI),
    pitch: -0.05,
  };
}

function createSpawnPose(mapId, slotIndex, updatedAtMs, seq = 0) {
  const spawn = resolveSpawnConfig(mapId, slotIndex);
  return {
    seq,
    x: spawn.position[0],
    y: spawn.position[1],
    z: spawn.position[2],
    yaw: spawn.yaw,
    bodyYaw: spawn.yaw,
    pitch: spawn.pitch,
    moving: false,
    sprinting: false,
    crouched: false,
    grounded: true,
    ads: false,
    animState: "rifleIdle",
    locomotionScale: 1,
    lowerBodyState: null,
    lowerBodyLocomotionScale: 1,
    upperBodyState: null,
    updatedAtMs,
  };
}

function createPlayerRuntime(mapId, slot) {
  const nowMs = Date.parse(slot.startedAt);
  return {
    userId: slot.userId,
    slotIndex: slot.slotIndex,
    pose: createSpawnPose(mapId, slot.slotIndex, nowMs),
    health: MATCH_MAX_HEALTH,
    alive: true,
    respawnAtMs: null,
    magAmmo: MATCH_MAX_MAG_AMMO,
    reloadingUntilMs: null,
    lastShotAtMs: null,
  };
}

function buildRealtimePlayerState(player) {
  return {
    userId: player.userId,
    slotIndex: player.slotIndex,
    seq: player.pose.seq,
    x: player.pose.x,
    y: player.pose.y,
    z: player.pose.z,
    yaw: player.pose.yaw,
    bodyYaw: player.pose.bodyYaw,
    pitch: player.pose.pitch,
    moving: player.pose.moving,
    sprinting: player.pose.sprinting,
    crouched: player.pose.crouched,
    grounded: player.pose.grounded,
    ads: player.pose.ads,
    animState: player.pose.animState,
    locomotionScale: player.pose.locomotionScale,
    lowerBodyState: player.pose.lowerBodyState,
    lowerBodyLocomotionScale: player.pose.lowerBodyLocomotionScale,
    upperBodyState: player.pose.upperBodyState,
    alive: player.alive,
  };
}

function buildMatchPlayerState(player) {
  return {
    userId: player.userId,
    slotIndex: player.slotIndex,
    health: player.health,
    alive: player.alive,
    respawnAt: player.respawnAtMs === null ? null : new Date(player.respawnAtMs).toISOString(),
    magAmmo: player.magAmmo,
    reloadingUntil: player.reloadingUntilMs === null ? null : new Date(player.reloadingUntilMs).toISOString(),
  };
}

function buildSnapshot(match) {
  const sortedPlayers = [...match.players.values()].sort((left, right) => left.slotIndex - right.slotIndex);
  return {
    matchState: {
      startedAt: match.startedAt,
      mapId: match.mapId,
      players: sortedPlayers.map(buildMatchPlayerState),
    },
    playerStates: sortedPlayers.map(buildRealtimePlayerState),
    latestShotEvent: match.latestShotEvent,
  };
}

function applyDueTransitions(match, nowMs) {
  let changed = false;
  for (const player of match.players.values()) {
    if (player.reloadingUntilMs !== null && nowMs >= player.reloadingUntilMs) {
      player.reloadingUntilMs = null;
      player.magAmmo = MATCH_MAX_MAG_AMMO;
      changed = true;
    }

    if (!player.alive && player.respawnAtMs !== null && nowMs >= player.respawnAtMs) {
      player.alive = true;
      player.health = MATCH_MAX_HEALTH;
      player.respawnAtMs = null;
      player.magAmmo = MATCH_MAX_MAG_AMMO;
      player.reloadingUntilMs = null;
      player.lastShotAtMs = null;
      player.pose = createSpawnPose(match.mapId, player.slotIndex, nowMs, player.pose.seq);
      changed = true;
    }
  }
  return changed;
}

function pointInsideBounds(mapId, point) {
  const bounds = getMapConfig(mapId).worldBounds;
  return point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ &&
    point.y >= -2 &&
    point.y <= MAX_PLAYER_Y;
}

function pointInsideBlocker(mapId, point) {
  const blockers = getMapConfig(mapId).blockers;
  return blockers.some((blocker) => {
    const halfX = blocker.size[0] / 2;
    const halfY = blocker.size[1] / 2;
    const halfZ = blocker.size[2] / 2;
    return point.x >= blocker.center[0] - halfX &&
      point.x <= blocker.center[0] + halfX &&
      point.y >= blocker.center[1] - halfY &&
      point.y <= blocker.center[1] + halfY &&
      point.z >= blocker.center[2] - halfZ &&
      point.z <= blocker.center[2] + halfZ;
  });
}

function sanitizeDirection(rawDirection) {
  if (!rawDirection || !Array.isArray(rawDirection) || rawDirection.length !== 3) {
    return null;
  }
  const point = buildPoint(rawDirection[0], rawDirection[1], rawDirection[2]);
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y) || !isFiniteNumber(point.z)) {
    return null;
  }
  return normalizePoint(point);
}

function sanitizeOrigin(rawOrigin) {
  if (!rawOrigin || !Array.isArray(rawOrigin) || rawOrigin.length !== 3) {
    return null;
  }
  const point = buildPoint(rawOrigin[0], rawOrigin[1], rawOrigin[2]);
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z)
    ? point
    : null;
}

function applyInputFrame(match, userId, frame, nowMs) {
  applyDueTransitions(match, nowMs);
  const player = match.players.get(userId);
  if (!player || !player.alive) {
    return;
  }
  if (!frame || !Number.isInteger(frame.seq) || frame.seq <= player.pose.seq) {
    return;
  }
  const nextPoint = buildPoint(frame.x, frame.y, frame.z);
  if (
    !isFiniteNumber(nextPoint.x) ||
    !isFiniteNumber(nextPoint.y) ||
    !isFiniteNumber(nextPoint.z) ||
    !isFiniteNumber(frame.yaw) ||
    !isFiniteNumber(frame.bodyYaw) ||
    !isFiniteNumber(frame.pitch)
  ) {
    return;
  }
  if (!pointInsideBounds(match.mapId, nextPoint) || pointInsideBlocker(match.mapId, nextPoint)) {
    return;
  }
  const previousPoint = buildPoint(player.pose.x, player.pose.y, player.pose.z);
  if (pointDistance(previousPoint, nextPoint) > MAX_ALLOWED_STEP_METERS) {
    return;
  }

  player.pose = {
    seq: frame.seq,
    x: nextPoint.x,
    y: nextPoint.y,
    z: nextPoint.z,
    yaw: normalizeAngleRadians(frame.yaw),
    bodyYaw: normalizeAngleRadians(frame.bodyYaw),
    pitch: Math.max(-1.5, Math.min(0.85, frame.pitch)),
    moving: Boolean(frame.moving),
    sprinting: Boolean(frame.sprinting),
    crouched: Boolean(frame.crouched),
    grounded: Boolean(frame.grounded),
    ads: Boolean(frame.ads),
    animState: typeof frame.animState === "string" ? frame.animState : "rifleIdle",
    locomotionScale: isFiniteNumber(frame.locomotionScale) ? frame.locomotionScale : 1,
    lowerBodyState: typeof frame.lowerBodyState === "string" ? frame.lowerBodyState : null,
    lowerBodyLocomotionScale: isFiniteNumber(frame.lowerBodyLocomotionScale)
      ? frame.lowerBodyLocomotionScale
      : 1,
    upperBodyState: typeof frame.upperBodyState === "string" ? frame.upperBodyState : null,
    updatedAtMs: nowMs,
  };
}

function handleReload(match, userId, nowMs) {
  applyDueTransitions(match, nowMs);
  const player = match.players.get(userId);
  if (!player || !player.alive) {
    return;
  }
  if (player.reloadingUntilMs !== null && nowMs < player.reloadingUntilMs) {
    return;
  }
  if (player.magAmmo >= MATCH_MAX_MAG_AMMO) {
    return;
  }
  player.reloadingUntilMs = nowMs + MATCH_RELOAD_MS;
}

function handleFire(match, userId, payload, nowMs) {
  applyDueTransitions(match, nowMs);
  const shooter = match.players.get(userId);
  if (!shooter || !shooter.alive) {
    return;
  }
  if (shooter.reloadingUntilMs !== null && nowMs < shooter.reloadingUntilMs) {
    return;
  }
  if (shooter.magAmmo <= 0) {
    if (shooter.reloadingUntilMs === null) {
      shooter.reloadingUntilMs = nowMs + MATCH_RELOAD_MS;
    }
    return;
  }
  if (shooter.lastShotAtMs !== null && nowMs - shooter.lastShotAtMs < MATCH_FIRE_INTERVAL_MS) {
    return;
  }

  shooter.lastShotAtMs = nowMs;
  shooter.magAmmo = Math.max(0, shooter.magAmmo - 1);

  const defaultOrigin = buildPoint(
    shooter.pose.x,
    shooter.pose.y + resolveEyeHeight(shooter.pose.crouched),
    shooter.pose.z,
  );
  const origin = sanitizeOrigin(payload.origin);
  const direction = sanitizeDirection(payload.direction) ??
    directionFromYawPitch(shooter.pose.yaw, shooter.pose.pitch);
  const acceptedOrigin = origin && pointDistance(origin, defaultOrigin) <= 3
    ? origin
    : defaultOrigin;

  let closestHit = null;
  for (const target of match.players.values()) {
    if (target.userId === shooter.userId || !target.alive) {
      continue;
    }
    for (const sphere of resolveHitSpheres(target)) {
      const distance = intersectRaySphere(acceptedOrigin, direction, sphere.center, sphere.radius);
      if (distance === null) {
        continue;
      }
      if (!closestHit || distance < closestHit.distance) {
        closestHit = {
          target,
          zone: sphere.zone,
          distance,
        };
      }
    }
  }

  let hit = null;
  if (closestHit) {
    const blockerDistance = getMapConfig(match.mapId).blockers
      .map((blocker) => intersectRayAabb(acceptedOrigin, direction, blocker))
      .filter((distance) => distance !== null)
      .sort((left, right) => left - right)[0] ?? null;

    if (blockerDistance === null || blockerDistance > closestHit.distance) {
      const damage = resolveRifleDamage(closestHit.distance, closestHit.zone);
      const remainingHealth = Math.max(0, closestHit.target.health - damage);
      closestHit.target.health = remainingHealth;
      const killed = remainingHealth <= 0;
      if (killed) {
        closestHit.target.alive = false;
        closestHit.target.respawnAtMs = nowMs + MATCH_RESPAWN_MS;
        closestHit.target.reloadingUntilMs = null;
        closestHit.target.lastShotAtMs = null;
      }
      hit = {
        userId: closestHit.target.userId,
        zone: closestHit.zone,
        damage,
        remainingHealth,
        killed,
        impactPoint: [
          acceptedOrigin.x + direction.x * closestHit.distance,
          acceptedOrigin.y + direction.y * closestHit.distance,
          acceptedOrigin.z + direction.z * closestHit.distance,
        ],
      };
    }
  }

  if (shooter.magAmmo <= 0 && shooter.reloadingUntilMs === null) {
    shooter.reloadingUntilMs = nowMs + MATCH_RELOAD_MS;
  }

  match.latestShotEvent = {
    userId: shooter.userId,
    shotId: typeof payload.shotId === "string" ? payload.shotId : `shot-${nowMs}`,
    origin: [acceptedOrigin.x, acceptedOrigin.y, acceptedOrigin.z],
    direction: [direction.x, direction.y, direction.z],
    hit,
  };
}

function createHostRuntime(config) {
  const players = new Map();
  const startedAt = config.startedAt ?? new Date().toISOString();
  for (const slot of config.slots) {
    players.set(slot.userId, createPlayerRuntime(config.mapId, {
      ...slot,
      startedAt,
    }));
  }
  return {
    lobbyCode: config.lobbyCode,
    mapId: config.mapId,
    startedAt,
    players,
    latestShotEvent: null,
  };
}

function createMultiplayerService({ getMainWindow }) {
  let session = null;

  const sendToRenderer = (channel, payload) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send(channel, payload);
  };

  const emitConnectionState = (status, role) => {
    sendToRenderer("multiplayer:connection-state", { status, role });
  };

  const emitSnapshot = (snapshot) => {
    sendToRenderer("multiplayer:snapshot", snapshot);
  };

  const emitMatchEnded = (reason) => {
    sendToRenderer("multiplayer:match-ended", { reason });
  };

  const closeSocket = (socket) => {
    try {
      socket.end();
    } catch {
      // Socket is already doing something dramatic.
    }
    try {
      socket.destroy();
    } catch {
      // Ignore.
    }
  };

  const clearSession = () => {
    if (!session) {
      emitConnectionState("disconnected", "idle");
      return;
    }
    if (session.snapshotIntervalId) {
      clearInterval(session.snapshotIntervalId);
    }
    if (session.timeoutIntervalId) {
      clearInterval(session.timeoutIntervalId);
    }
    if (session.heartbeatIntervalId) {
      clearInterval(session.heartbeatIntervalId);
    }
    if (session.server) {
      try {
        session.server.close();
      } catch {
        // Ignore.
      }
    }
    if (session.socket) {
      closeSocket(session.socket);
    }
    if (session.clients) {
      for (const client of session.clients.values()) {
        closeSocket(client.socket);
      }
      session.clients.clear();
    }
    session = null;
    emitConnectionState("disconnected", "idle");
  };

  const writeMessage = (socket, payload) => {
    if (!socket || socket.destroyed) {
      return;
    }
    socket.write(`${JSON.stringify(payload)}\n`);
  };

  const broadcastSnapshot = () => {
    if (!session || session.mode !== "host") {
      return;
    }
    applyDueTransitions(session.match, Date.now());
    const snapshot = buildSnapshot(session.match);
    emitSnapshot(snapshot);
    for (const client of session.clients.values()) {
      writeMessage(client.socket, {
        type: "snapshot",
        snapshot,
      });
    }
  };

  const finishHostedMatch = (reason) => {
    if (!MATCH_ENDED_REASONS.has(reason)) {
      reason = "host_disconnected";
    }
    if (!session) {
      emitMatchEnded(reason);
      return;
    }

    if (session.mode === "host") {
      for (const client of session.clients.values()) {
        writeMessage(client.socket, { type: "end_match", reason });
      }
    }

    clearSession();
    emitMatchEnded(reason);
  };

  const attachSocketReader = (socket, onMessage, onClose) => {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          onMessage(JSON.parse(line));
        } catch {
          onClose();
          return;
        }
      }
    });

    socket.on("close", onClose);
    socket.on("error", onClose);
  };

  const hostMatch = async (config) => {
    const normalizedPort = Number.isInteger(config.hostPort) ? config.hostPort : DEFAULT_HOST_PORT;
    if (
      session &&
      session.mode === "host" &&
      session.match.lobbyCode === config.lobbyCode &&
      session.port === normalizedPort
    ) {
      emitConnectionState("connected", "host");
      emitSnapshot(buildSnapshot(session.match));
      return { ok: true, port: normalizedPort, protocolVersion: PROTOCOL_VERSION };
    }

    clearSession();

    const match = createHostRuntime({
      lobbyCode: config.lobbyCode,
      mapId: config.mapId,
      startedAt: config.startedAt,
      slots: config.slots,
    });

    const server = net.createServer((socket) => {
      if (!session || session.mode !== "host") {
        closeSocket(socket);
        return;
      }

      const clientState = {
        socket,
        userId: null,
        lastSeenAtMs: Date.now(),
      };
      const clientKey = `${socket.remoteAddress ?? "remote"}:${socket.remotePort ?? 0}`;
      session.clients.set(clientKey, clientState);

      const handleClose = () => {
        if (!session || session.mode !== "host") {
          return;
        }
        const connectedUserId = clientState.userId;
        session.clients.delete(clientKey);
        if (connectedUserId) {
          finishHostedMatch("player_disconnected");
        }
      };

      attachSocketReader(socket, (message) => {
        if (!session || session.mode !== "host") {
          return;
        }

        clientState.lastSeenAtMs = Date.now();
        if (message.type === "hello") {
          if (
            message.protocolVersion !== PROTOCOL_VERSION ||
            message.lobbyCode !== session.match.lobbyCode ||
            typeof message.userId !== "string"
          ) {
            closeSocket(socket);
            return;
          }

          const expectedRemote = session.expectedRemoteUserIds.has(message.userId);
          if (!expectedRemote || message.userId === session.localUserId) {
            closeSocket(socket);
            return;
          }

          clientState.userId = message.userId;
          writeMessage(socket, {
            type: "welcome",
            protocolVersion: PROTOCOL_VERSION,
            snapshot: buildSnapshot(session.match),
          });
          return;
        }

        if (!clientState.userId) {
          closeSocket(socket);
          return;
        }

        if (message.type === "heartbeat") {
          return;
        }

        if (message.type === "input_frame") {
          applyInputFrame(session.match, clientState.userId, message.frame, Date.now());
          return;
        }

        if (message.type === "fire_intent") {
          handleFire(session.match, clientState.userId, message.intent ?? {}, Date.now());
          broadcastSnapshot();
          return;
        }

        if (message.type === "reload_intent") {
          handleReload(session.match, clientState.userId, Date.now());
          broadcastSnapshot();
          return;
        }

        if (message.type === "leave_match") {
          finishHostedMatch(
            MATCH_ENDED_REASONS.has(message.reason) ? message.reason : "player_left",
          );
        }
      }, handleClose);
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(normalizedPort, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    session = {
      mode: "host",
      server,
      port: normalizedPort,
      localUserId: config.localUserId,
      expectedRemoteUserIds: new Set(config.slots.map((slot) => slot.userId).filter((userId) => userId !== config.localUserId)),
      match,
      clients: new Map(),
      snapshotIntervalId: setInterval(() => {
        broadcastSnapshot();
      }, SNAPSHOT_INTERVAL_MS),
      timeoutIntervalId: setInterval(() => {
        if (!session || session.mode !== "host") {
          return;
        }
        const nowMs = Date.now();
        for (const client of session.clients.values()) {
          if (client.userId && nowMs - client.lastSeenAtMs > SOCKET_TIMEOUT_MS) {
            finishHostedMatch("player_disconnected");
            return;
          }
        }
      }, 1_000),
    };

    emitConnectionState("connected", "host");
    emitSnapshot(buildSnapshot(match));
    return { ok: true, port: normalizedPort, protocolVersion: PROTOCOL_VERSION };
  };

  const joinMatch = async (config) => {
    if (
      session &&
      session.mode === "client" &&
      session.lobbyCode === config.lobbyCode &&
      session.socket &&
      !session.socket.destroyed
    ) {
      emitConnectionState("connected", "client");
      return { ok: true, protocolVersion: PROTOCOL_VERSION };
    }

    clearSession();
    emitConnectionState("connecting", "client");

    const socket = net.createConnection({
      host: config.hostAddress,
      port: config.hostPort,
    });

    session = {
      mode: "client",
      socket,
      lobbyCode: config.lobbyCode,
      localUserId: config.localUserId,
      heartbeatIntervalId: null,
    };

    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    writeMessage(socket, {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      lobbyCode: config.lobbyCode,
      userId: config.localUserId,
    });

    attachSocketReader(socket, (message) => {
      if (!session || session.mode !== "client") {
        return;
      }

      if (message.type === "welcome" || message.type === "snapshot") {
        if (message.snapshot) {
          emitSnapshot(message.snapshot);
        }
        emitConnectionState("connected", "client");
        return;
      }

      if (message.type === "end_match") {
        finishHostedMatch(
          MATCH_ENDED_REASONS.has(message.reason) ? message.reason : "host_disconnected",
        );
      }
    }, () => {
      if (session && session.mode === "client") {
        finishHostedMatch("host_disconnected");
      }
    });

    session.heartbeatIntervalId = setInterval(() => {
      if (!session || session.mode !== "client") {
        return;
      }
      writeMessage(socket, { type: "heartbeat" });
    }, SOCKET_HEARTBEAT_INTERVAL_MS);

    return { ok: true, protocolVersion: PROTOCOL_VERSION };
  };

  const leaveMatch = async ({ reason = null, notifyRemote = false } = {}) => {
    if (!session) {
      emitConnectionState("disconnected", "idle");
      return { ok: true };
    }

    if (session.mode === "host" && notifyRemote && MATCH_ENDED_REASONS.has(reason)) {
      for (const client of session.clients.values()) {
        writeMessage(client.socket, { type: "end_match", reason });
      }
    }

    if (session.mode === "client" && notifyRemote && MATCH_ENDED_REASONS.has(reason)) {
      writeMessage(session.socket, { type: "leave_match", reason });
    }

    clearSession();
    return { ok: true };
  };

  const sendInputFrame = async (frame) => {
    if (!session) {
      return { ok: false };
    }

    if (session.mode === "host") {
      applyInputFrame(session.match, session.localUserId, frame, Date.now());
      return { ok: true };
    }

    writeMessage(session.socket, {
      type: "input_frame",
      frame,
    });
    return { ok: true };
  };

  const sendFireIntent = async (intent) => {
    if (!session) {
      return { ok: false };
    }

    if (session.mode === "host") {
      handleFire(session.match, session.localUserId, intent ?? {}, Date.now());
      broadcastSnapshot();
      return { ok: true };
    }

    writeMessage(session.socket, {
      type: "fire_intent",
      intent,
    });
    return { ok: true };
  };

  const sendReloadIntent = async () => {
    if (!session) {
      return { ok: false };
    }

    if (session.mode === "host") {
      handleReload(session.match, session.localUserId, Date.now());
      broadcastSnapshot();
      return { ok: true };
    }

    writeMessage(session.socket, {
      type: "reload_intent",
    });
    return { ok: true };
  };

  return {
    getProtocolVersion() {
      return PROTOCOL_VERSION;
    },
    getDefaultHostPort() {
      return DEFAULT_HOST_PORT;
    },
    hostMatch,
    joinMatch,
    leaveMatch,
    sendInputFrame,
    sendFireIntent,
    sendReloadIntent,
    dispose() {
      clearSession();
    },
  };
}

module.exports = {
  PROTOCOL_VERSION,
  DEFAULT_HOST_PORT,
  createMultiplayerService,
};
