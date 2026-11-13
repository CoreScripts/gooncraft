import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** How deep an item is, in art pixels. Paper-thin planes read as cards side-on. */
const DEPTH = 1.4
/** Side faces of the item: the dark outline colour of the pixel art. */
const EDGE = '#241c15'

/** One box per opaque pixel, merged into a single silhouette; cached per drawing and size. */
const silhouettes = new WeakMap<string[], Map<number, BufferGeometry>>()

function silhouette(art: string[], size: number): BufferGeometry {
  let sizes = silhouettes.get(art)
  if (!sizes) silhouettes.set(art, (sizes = new Map()))
  const cached = sizes.get(size)
  if (cached) return cached
  const k = size / 16
  const boxes: BufferGeometry[] = []
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (art[y][x] === '.') continue
      // Slight overlap so neighbouring pixels do not show a seam at grazing angles.
      const box = new BoxGeometry(k * 1.02, k * 1.02, k * DEPTH)
      box.translate((x - 7.5) * k, (7.5 - y) * k, 0)
      boxes.push(box)
    }
  const merged = boxes.length ? mergeGeometries(boxes) : new BoxGeometry(size, size, k * DEPTH)
  for (const box of boxes) box.dispose()
  sizes.set(size, merged)
  return merged
}

/**
 * A held item as a solid object: the pixel art on both faces over an extruded
 * silhouette, so it has visible thickness from the side. `grip` is the art pixel that
 * should sit at the origin (the hand), or null to keep the drawing centred.
 */
export function heldItemMesh(art: string[], texture: Texture, size: number, grip: [number, number] | null): Group {
  const group = new Group()
  const k = size / 16
  const depth = k * DEPTH
  // Art pixel (x, y) sits at ((x - 7.5) * k, (7.5 - y) * k), so this moves the grip point
  // to the group origin, where the hand is.
  const dx = grip ? (7.5 - grip[0]) * k : 0
  const dy = grip ? (grip[1] - 7.5) * k : 0

  const body = new Mesh(silhouette(art, size).clone(), new MeshLambertMaterial({ color: EDGE }))
  body.position.set(dx, dy, 0)
  group.add(body)

  // The art goes on both faces of the slab, lined up pixel for pixel. A copy rotated
  // 180° would mirror the drawing and show through the cut-out parts as a second item.
  const faceMaterial = new MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: DoubleSide })
  for (const z of [depth / 2 + 0.0025, -depth / 2 - 0.0025]) {
    const face = new Mesh(new PlaneGeometry(size, size), faceMaterial)
    face.position.set(dx, dy, z)
    group.add(face)
  }

  return group
}
