import { AIR, blockDef } from './blocks'
import type { ItemDef } from './items'
import { boxesOverlap, type Box } from './physics'
import type { World } from './world'

export interface BuildRules {
  /** Highest y a block may be placed at. */
  maxY: number
  /** Lowest y a block may be placed at. */
  minY: number
  /** Inclusive cell ranges where nobody may place: spawns, generators, shopkeepers. */
  protectedZones: Box[]
  /** Let map blocks (not placed by a player) be broken too. */
  allowMapBreaking?: boolean
}

/** Ticks of continuous digging to break a block with the held item (Infinity if it cannot break). */
export function breakTicks(blockId: number, held: ItemDef | undefined): number {
  const def = blockDef(blockId)
  if (def.hardness === Infinity) return Infinity
  if (def.hardness === 0) return 0
  const rightTool = held?.kind === 'tool' && def.tool !== undefined && held.tool === def.tool
  // Same scale as the classic formula: hardness × 30 / speed with the right tool,
  // ×100 when the block needs a tool you are not holding.
  if (rightTool) return Math.ceil((def.hardness * 30) / (held.speed ?? 1))
  return Math.ceil(def.hardness * (def.requiresTool ? 100 : 30))
}

export type PlaceRefusal = 'occupied' | 'player' | 'protected' | 'height' | 'bounds' | 'floating'

export function checkPlace(world: World, rules: BuildRules, x: number, y: number, z: number, bodies: Box[]): PlaceRefusal | null {
  if (!world.inBounds(x, y, z)) return 'bounds'
  if (y > rules.maxY) return 'height'
  if (y < rules.minY) return 'bounds'
  if (world.get(x, y, z) !== AIR) return 'occupied'
  const cell: Box = [x, y, z, x + 1, y + 1, z + 1]
  for (const zone of rules.protectedZones)
    if (x >= zone[0] && x <= zone[3] && y >= zone[1] && y <= zone[4] && z >= zone[2] && z <= zone[5]) return 'protected'
  for (const b of bodies) if (boxesOverlap(cell, b)) return 'player'
  // A block must touch another block on some face.
  const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  if (!n.some(([dx, dy, dz]) => world.get(x + dx, y + dy, z + dz) !== AIR)) return 'floating'
  return null
}

export interface BridgeCell {
  /** Solid block the new one is placed against. */
  against: [number, number, number]
  face: [number, number, number]
  y: number
}

/**
 * The next cell a bridging block belongs in, one step along (sx, sz) at the
 * level of the floor you are walking on. Only the cell right in front of your
 * feet (or the one your feet are over, once you have stepped off the lip) is
 * considered, so the bridge is laid one block per cell as you walk into the air
 * rather than filling the gap ahead of you, and only ever at floor level, so it
 * cannot climb into a wall. Null when there is nothing to bridge.
 */
export function bridgeCell(world: World, feetX: number, feetZ: number, level: number, sx: number, sz: number): BridgeCell | null {
  if (sx === 0 && sz === 0) return null
  const candidates: [number, number][] = [
    [feetX + sx, feetZ + sz],
    [feetX, feetZ],
  ]
  for (const [x, z] of candidates) {
    if (world.get(x, level, z) !== AIR) continue
    // The block behind it, along the way you are walking, is what it attaches to.
    const bx = x - sx
    const bz = z - sz
    if (world.get(bx, level, bz) === AIR) continue
    return { against: [bx, level, bz], face: [sx, 0, sz], y: level }
  }
  return null
}

export type Unbreakable = 'air' | 'map' | 'unbreakable'

/** By default only blocks placed by players can be broken; map blocks stay. */
export function checkBreakable(world: World, rules: BuildRules, x: number, y: number, z: number): Unbreakable | null {
  const id = world.get(x, y, z)
  if (id === AIR) return 'air'
  if (blockDef(id).hardness === Infinity) return 'unbreakable'
  if (!world.isPlaced(x, y, z) && !rules.allowMapBreaking) return 'map'
  return null
}
