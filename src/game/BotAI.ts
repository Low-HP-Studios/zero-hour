import type { BlockingVolume } from './map-layout';
import type { BotState } from './types';

// ── Constants ──────────────────────────────────────────────
const BOT_RADIUS = 0.35;
const BOT_MAX_HP = 100;
const PATROL_SPEED = 2.5;
const CHASE_SPEED = 3.5;
const COVER_SPEED = 3.0;

const WAYPOINT_ARRIVE_DIST = 1.5;
const CHASE_TO_ATTACK_DIST = 20;
const ATTACK_MAX_DIST = 30;
const LOST_SIGHT_PATROL_MS = 3000;
const COVER_DURATION_MS = 4000;
const COVER_HP_THRESHOLD = 30;
const COVER_EXIT_HP = 50;

const BOT_FIRE_INTERVAL_MIN_MS = 600;
const BOT_FIRE_INTERVAL_MAX_MS = 1000;
const BOT_MISS_CHANCE = 0.35;

const RESPAWN_DELAY_MS = 3000;
const BOT_HEAD_Y = 1.4;

const LOS_CHECK_INTERVAL_MS = 200;

// ── Bot creation ───────────────────────────────────────────

export function createInitialBots(
  spawns: readonly [number, number, number][],
  count: number,
): BotState[] {
  if (spawns.length === 0) return [];
  const bots: BotState[] = [];
  for (let i = 0; i < count; i++) {
    const spawn = spawns[i % spawns.length];
    bots.push({
      id: `bot_${i}`,
      position: [spawn[0], spawn[1], spawn[2]],
      facingYaw: 0,
      radius: BOT_RADIUS,
      hp: BOT_MAX_HP,
      maxHp: BOT_MAX_HP,
      disabled: false,
      hitUntil: 0,
      aiState: 'patrol',
      currentWaypointIndex: i % 12, // stagger starting waypoints
      lastShotTime: 0,
      respawnAt: 0,
      targetVisible: false,
      moveSpeed: PATROL_SPEED,
      lostSightTime: 0,
      coverEnteredAt: 0,
    });
  }
  return bots;
}

// ── Line-of-sight (ray-AABB) ──────────────────────────────

function rayIntersectsAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
): boolean {
  const halfX = sx / 2;
  const halfY = sy / 2;
  const halfZ = sz / 2;
  const minX = cx - halfX, maxX = cx + halfX;
  const minY = cy - halfY, maxY = cy + halfY;
  const minZ = cz - halfZ, maxZ = cz + halfZ;

  let tmin = -Infinity;
  let tmax = Infinity;

  // X slab
  if (Math.abs(dx) > 1e-8) {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  } else if (ox < minX || ox > maxX) {
    return false;
  }

  // Y slab
  if (Math.abs(dy) > 1e-8) {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  } else if (oy < minY || oy > maxY) {
    return false;
  }

  // Z slab
  if (Math.abs(dz) > 1e-8) {
    let t1 = (minZ - oz) / dz;
    let t2 = (maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  } else if (oz < minZ || oz > maxZ) {
    return false;
  }

  // Intersection must be on the positive side of the ray and before reaching the target
  return tmax >= 0 && tmin <= 1;
}

export function checkBotLineOfSight(
  botPos: [number, number, number],
  playerPos: [number, number, number],
  blockingVolumes: readonly BlockingVolume[],
): boolean {
  const ox = botPos[0];
  const oy = botPos[1] + BOT_HEAD_Y;
  const oz = botPos[2];
  const px = playerPos[0];
  const py = playerPos[1] + BOT_HEAD_Y;
  const pz = playerPos[2];

  const dx = px - ox;
  const dy = py - oy;
  const dz = pz - oz;

  for (const vol of blockingVolumes) {
    if (
      rayIntersectsAABB(
        ox, oy, oz,
        dx, dy, dz,
        vol.center[0], vol.center[1], vol.center[2],
        vol.size[0], vol.size[1], vol.size[2],
      )
    ) {
      return false;
    }
  }
  return true;
}

// ── Collision resolution ──────────────────────────────────

export function resolveBotCollisions(
  pos: [number, number, number],
  radius: number,
  blockingVolumes: readonly BlockingVolume[],
): [number, number, number] {
  let x = pos[0];
  const y = pos[1];
  let z = pos[2];

  for (const vol of blockingVolumes) {
    const cx = vol.center[0];
    const cy = vol.center[1];
    const cz = vol.center[2];
    const hx = vol.size[0] / 2;
    const hy = vol.size[1] / 2;
    const hz = vol.size[2] / 2;

    // Check vertical overlap
    const botTop = y + 1.8; // approximate standing height
    const botFoot = y;
    const volMinY = cy - hy;
    const volMaxY = cy + hy;
    if (botTop <= volMinY || botFoot >= volMaxY) continue;

    // Check horizontal overlap
    const closestX = Math.max(cx - hx, Math.min(x, cx + hx));
    const closestZ = Math.max(cz - hz, Math.min(z, cz + hz));
    const distX = x - closestX;
    const distZ = z - closestZ;
    const distSq = distX * distX + distZ * distZ;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist > 1e-6) {
        const pushDist = radius - dist;
        x += (distX / dist) * pushDist;
        z += (distZ / dist) * pushDist;
      } else {
        // Inside the box, push along shortest axis
        const penX = hx + radius - Math.abs(x - cx);
        const penZ = hz + radius - Math.abs(z - cz);
        if (penX < penZ) {
          x += x < cx ? -penX : penX;
        } else {
          z += z < cz ? -penZ : penZ;
        }
      }
    }
  }
  return [x, y, z];
}

// ── Firing logic ──────────────────────────────────────────

export function botShouldFire(
  bot: BotState,
  playerPos: [number, number, number],
  nowMs: number,
): boolean {
  if (bot.aiState !== 'attack') return false;
  if (bot.disabled) return false;
  if (!bot.targetVisible) return false;

  const dx = playerPos[0] - bot.position[0];
  const dz = playerPos[2] - bot.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > ATTACK_MAX_DIST) return false;

  const fireInterval = BOT_FIRE_INTERVAL_MIN_MS +
    Math.random() * (BOT_FIRE_INTERVAL_MAX_MS - BOT_FIRE_INTERVAL_MIN_MS);
  return nowMs - bot.lastShotTime >= fireInterval;
}

export function resolveBotDamageToPlayer(
  _bot: BotState,
  distance: number,
): number {
  // Miss chance
  if (Math.random() < BOT_MISS_CHANCE) return 0;

  if (distance < 10) return 8 + Math.random() * 4; // 8-12
  if (distance < 25) return 5 + Math.random() * 3; // 5-8
  return 2 + Math.random() * 3; // 2-5
}

// ── Helper: distance between two xz points ────────────────

function distXZ(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function angleTo(
  from: [number, number, number],
  to: [number, number, number],
): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

// ── Find nearest cover position ───────────────────────────

function findNearestCover(
  pos: [number, number, number],
  blockingVolumes: readonly BlockingVolume[],
): [number, number, number] | null {
  let bestDist = Infinity;
  let bestPos: [number, number, number] | null = null;

  for (const vol of blockingVolumes) {
    if (vol.material !== 'cover') continue;
    const dist = distXZ(pos, vol.center);
    if (dist < bestDist) {
      bestDist = dist;
      // Go to the side of the cover facing away from center (z=0)
      const offsetZ = vol.center[2] > 0 ? vol.size[2] / 2 + 1 : -vol.size[2] / 2 - 1;
      bestPos = [vol.center[0], 0, vol.center[2] + offsetZ];
    }
  }
  return bestPos;
}

// ── Move toward a target position ─────────────────────────

function moveToward(
  pos: [number, number, number],
  target: [number, number, number],
  speed: number,
  delta: number,
  blockingVolumes: readonly BlockingVolume[],
): [number, number, number] {
  const dx = target[0] - pos[0];
  const dz = target[2] - pos[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.1) return pos;

  const step = Math.min(speed * delta, dist);
  const nx = pos[0] + (dx / dist) * step;
  const nz = pos[2] + (dz / dist) * step;

  return resolveBotCollisions(
    [nx, pos[1], nz],
    BOT_RADIUS,
    blockingVolumes,
  );
}

// ── Main AI update ────────────────────────────────────────

export function updateBotAI(
  bot: BotState,
  playerPos: [number, number, number],
  deltaSeconds: number,
  nowMs: number,
  blockingVolumes: readonly BlockingVolume[],
  waypoints: readonly [number, number, number][],
  canSeePlayer: boolean,
): BotState {
  // Dead: wait for respawn
  if (bot.aiState === 'dead' || bot.disabled) {
    if (bot.respawnAt > 0 && nowMs >= bot.respawnAt) {
      return {
        ...bot,
        disabled: false,
        hp: bot.maxHp,
        aiState: 'patrol',
        respawnAt: 0,
        hitUntil: 0,
        lostSightTime: 0,
        targetVisible: false,
      };
    }
    return { ...bot, targetVisible: false };
  }

  const dist = distXZ(bot.position, playerPos);
  let next: BotState = { ...bot, targetVisible: canSeePlayer };

  switch (bot.aiState) {
    // ── PATROL ──────────────────────────────────────────
    case 'patrol': {
      if (canSeePlayer) {
        next.aiState = 'chase';
        next.moveSpeed = CHASE_SPEED;
        next.lostSightTime = 0;
        break;
      }
      if (waypoints.length === 0) break;

      const wp = waypoints[bot.currentWaypointIndex % waypoints.length];
      const wpDist = distXZ(bot.position, wp);

      if (wpDist < WAYPOINT_ARRIVE_DIST) {
        next.currentWaypointIndex =
          (bot.currentWaypointIndex + 1) % waypoints.length;
      }

      const target = waypoints[next.currentWaypointIndex % waypoints.length];
      next.position = moveToward(
        bot.position, target, PATROL_SPEED, deltaSeconds, blockingVolumes,
      );
      next.facingYaw = angleTo(bot.position, target);
      next.moveSpeed = PATROL_SPEED;
      break;
    }

    // ── CHASE ───────────────────────────────────────────
    case 'chase': {
      if (bot.hp < COVER_HP_THRESHOLD) {
        next.aiState = 'cover';
        next.coverEnteredAt = nowMs;
        next.moveSpeed = COVER_SPEED;
        break;
      }
      if (canSeePlayer && dist < CHASE_TO_ATTACK_DIST) {
        next.aiState = 'attack';
        next.moveSpeed = 0;
        break;
      }
      if (!canSeePlayer) {
        const lostTime = bot.lostSightTime === 0 ? nowMs : bot.lostSightTime;
        next.lostSightTime = lostTime;
        if (nowMs - lostTime > LOST_SIGHT_PATROL_MS) {
          next.aiState = 'patrol';
          next.moveSpeed = PATROL_SPEED;
          next.lostSightTime = 0;
          break;
        }
      } else {
        next.lostSightTime = 0;
      }

      next.position = moveToward(
        bot.position, playerPos, CHASE_SPEED, deltaSeconds, blockingVolumes,
      );
      next.facingYaw = angleTo(bot.position, playerPos);
      next.moveSpeed = CHASE_SPEED;
      break;
    }

    // ── ATTACK ──────────────────────────────────────────
    case 'attack': {
      if (bot.hp < COVER_HP_THRESHOLD) {
        next.aiState = 'cover';
        next.coverEnteredAt = nowMs;
        next.moveSpeed = COVER_SPEED;
        break;
      }
      if (!canSeePlayer) {
        next.aiState = 'chase';
        next.moveSpeed = CHASE_SPEED;
        next.lostSightTime = nowMs;
        break;
      }
      if (dist > ATTACK_MAX_DIST) {
        next.aiState = 'chase';
        next.moveSpeed = CHASE_SPEED;
        break;
      }

      // Face the player, slight strafe
      next.facingYaw = angleTo(bot.position, playerPos);
      next.moveSpeed = 0;
      break;
    }

    // ── COVER ───────────────────────────────────────────
    case 'cover': {
      const coverTarget = findNearestCover(bot.position, blockingVolumes);
      if (coverTarget) {
        next.position = moveToward(
          bot.position, coverTarget, COVER_SPEED, deltaSeconds, blockingVolumes,
        );
        next.facingYaw = angleTo(bot.position, coverTarget);
      }
      next.moveSpeed = COVER_SPEED;

      // Slowly regenerate HP while in cover
      if (nowMs - bot.coverEnteredAt > 1000) {
        next.hp = Math.min(bot.maxHp, bot.hp + 10 * deltaSeconds);
      }

      // Exit cover
      if (
        bot.hp >= COVER_EXIT_HP ||
        nowMs - bot.coverEnteredAt > COVER_DURATION_MS
      ) {
        next.aiState = 'patrol';
        next.moveSpeed = PATROL_SPEED;
        next.coverEnteredAt = 0;
      }
      break;
    }
  }

  return next;
}

// ── Handle bot taking damage ──────────────────────────────

export function applyBotDamage(
  bot: BotState,
  damage: number,
  nowMs: number,
  respawnSpawns: readonly [number, number, number][],
): BotState {
  const newHp = Math.max(0, bot.hp - damage);
  const killed = newHp <= 0;

  if (killed) {
    const spawn = respawnSpawns[Math.floor(Math.random() * respawnSpawns.length)];
    return {
      ...bot,
      hp: 0,
      disabled: true,
      aiState: 'dead',
      hitUntil: nowMs + 180,
      respawnAt: nowMs + RESPAWN_DELAY_MS,
      position: spawn ? [spawn[0], spawn[1], spawn[2]] : bot.position,
      moveSpeed: 0,
    };
  }

  return {
    ...bot,
    hp: newHp,
    hitUntil: nowMs + 180,
  };
}

// ── Exported constants ────────────────────────────────────
export { BOT_RADIUS, LOS_CHECK_INTERVAL_MS };
