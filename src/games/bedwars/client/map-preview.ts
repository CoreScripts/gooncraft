import { AIR, blockDef, TEAMS } from '../blocks'
import { arenaLayout } from '../maps/arena'
import { createArena } from '../maps/arena'
import type { World } from '../../../engine/world'

/** A short line under an arena's name in the lobby's vote cards. */
const THEME_LABELS: Record<string, string> = {
  forest: 'Forest Islands',
  village: 'Village At Dusk',
  desert: 'Desert Pyramids',
  frost: 'Frozen Peaks',
  ruins: 'Mossy Ruins',
}

export function arenaLabel(id: string): string {
  const layout = arenaLayout(id)
  return THEME_LABELS[layout.theme] ?? layout.theme
}

/** The generated arena world, kept after the first card needs it. */
const worlds = new Map<string, World>()
const images = new Map<string, string>()

function arenaWorld(id: string): World {
  const hit = worlds.get(id)
  if (hit) return hit
  const world = createArena(TEAMS, arenaLayout(id)).world
  worlds.set(id, world)
  return world
}

const shade = (hex: string, factor: number): string => {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * The thumbnail for an arena, or null while it is still being drawn. Arenas are
 * built one at a time between frames, so opening the vote screen never stalls
 * the game; `onPreviewReady` fires as each one lands.
 */
export function mapPreview(id: string): string | null {
  const hit = images.get(id)
  if (hit) return hit
  if (!queued.has(id)) {
    queued.add(id)
    queue.push(id)
    kick()
  }
  return null
}

const queue: string[] = []
const queued = new Set<string>()
/** The one HUD that is showing vote cards, if any. */
let listener: (() => void) | null = null
let scheduled = false

/** Notified once for each arena drawn, so the vote cards can fill in. */
export function onPreviewReady(fn: () => void): void {
  listener = fn
}

function kick() {
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    const id = queue.shift()
    if (!id) return
    try {
      images.set(id, draw(id))
    } catch {
      images.set(id, '')
    }
    listener?.()
    if (queue.length) kick()
  }, 20)
}

/**
 * A thumbnail of the real arena: the blocks the map is actually built from,
 * seen from above at an angle. Each column of blocks is drawn as its topmost
 * solid block with a short wall under it, so houses, trees and the islands
 * themselves show up as they are in play. Built once per arena, then cached.
 */
function draw(id: string): string {
  const world = arenaWorld(id)
  const layout = arenaLayout(id)
  const W = 960
  const H = 540
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Sky: the arena's own colour at the top, fading to a haze at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, layout.sky)
  sky.addColorStop(0.62, layout.sky)
  sky.addColorStop(1, shade(layout.sky, 0.72))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  for (let i = 0; i < 4; i++) {
    const y = H * (0.08 + i * 0.1)
    ctx.fillRect(W * ((i * 0.29) % 0.66), y, W * 0.2, 4)
    ctx.fillRect(W * ((i * 0.29) % 0.66) + 10, y - 4, W * 0.13, 4)
  }

  const u = 3.4

  type Column = { x: number; z: number; top: number; depth: number }
  const columns: Column[] = []
  const cell = world.sx / 2
  for (let x = 0; x < world.sx; x++) {
    for (let z = 0; z < world.sz; z++) {
      let top = -1
      let depth = 0
      for (let y = world.sy - 1; y >= 0; y--) {
        const id2 = world.get(x, y, z)
        if (id2 === AIR) {
          if (top >= 0) break
          continue
        }
        const def = blockDef(id2)
        if (top < 0) {
          if (def?.transparent && y > 0) continue
          top = y
        } else if (depth < 6) depth++
      }
      if (top >= 0) columns.push({ x, z, top, depth })
    }
  }
  columns.sort((a, b) => a.x + a.z - (b.x + b.z))

  const half = u * 0.98
  const hgt = u * 0.52
  const place = (c: Column) => {
    const px = (c.x - cell) * u - (c.z - cell) * u
    const py = ((c.x - cell) + (c.z - cell)) * u * 0.5 - c.top * u * 0.85
    return { px, py, wall: Math.min(c.depth, 6) * u * 0.85 + u * 0.5 }
  }

  // Frame the board: shrink or grow the whole drawing so it fills the card.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of columns) {
    const { px, py, wall } = place(c)
    minX = Math.min(minX, px - half)
    maxX = Math.max(maxX, px + half)
    minY = Math.min(minY, py - hgt)
    maxY = Math.max(maxY, py + hgt + wall)
  }
  const fit = Math.min(W * 0.94 / (maxX - minX), H * 0.92 / (maxY - minY), 1.5)
  ctx.setTransform(fit, 0, 0, fit, (W - (maxX - minX) * fit) / 2 - minX * fit, (H - (maxY - minY) * fit) / 2 - minY * fit)

  for (const c of columns) {
    const id2 = world.get(c.x, c.top, c.z)
    const def = blockDef(id2)
    const top = def?.texture?.top ?? '#8c8c8c'
    const { px, py, wall } = place(c)

    // Right wall, then left wall, then the top face.
    ctx.fillStyle = shade(top, 0.62)
    ctx.beginPath()
    ctx.moveTo(px, py + hgt)
    ctx.lineTo(px + half, py)
    ctx.lineTo(px + half, py + wall)
    ctx.lineTo(px, py + hgt + wall)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = shade(top, 0.78)
    ctx.beginPath()
    ctx.moveTo(px - half, py)
    ctx.lineTo(px, py + hgt)
    ctx.lineTo(px, py + hgt + wall)
    ctx.lineTo(px - half, py + wall)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = top
    ctx.beginPath()
    ctx.moveTo(px, py - hgt)
    ctx.lineTo(px + half, py)
    ctx.lineTo(px, py + hgt)
    ctx.lineTo(px - half, py)
    ctx.closePath()
    ctx.fill()
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const fade = ctx.createLinearGradient(0, H * 0.4, 0, H)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,0.4)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, W, H)

  return canvas.toDataURL()
}
