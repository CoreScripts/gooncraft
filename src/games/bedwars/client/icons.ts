import { TEAM_COLORS, type TeamId } from '../blocks'
import { item, ITEMS } from '../items'
import { CELL, TILE, tileUV, type AtlasLayout } from '../../../engine/render/atlas-layout'

/**
 * 16×16 pixel art for non-block items: `h` handle, `m` the item's colour, `d` a
 * darker shade, `l` a lighter one, `x` outline, `s` string. Edit any grid here and
 * run `bun scripts/icon-preview.ts <item_id>` to see it as ASCII.
 */
const ART: Record<string, string[]> = {
  sword: [
    '.............xx.',
    '............xlmx',
    '...........xlmx.',
    '..........xlmx..',
    '.........xlmx...',
    '........xlmx....',
    '.......xlmx.....',
    '..xx..xlmx......',
    '..xdxxlmx.......',
    '...xdmmx........',
    '....xdx.........',
    '...xhxdx........',
    '..xhx.xx........',
    '.xhx............',
    'xhx.............',
    'xx..............',
  ],
  // Pickaxe: a pick head arching over a handle that runs down to the bottom left.
  pickaxe: [
    '................',
    '.....xxxx.......',
    '....xlllxx......',
    '......xxmmxxh...',
    '........xdmxx...',
    '.........xmmx...',
    '........xhxdmx..',
    '.......xhx.xmxx.',
    '......xhx...xlx.',
    '.....xhx....xlx.',
    '....xhx......lx.',
    '...xhx.......x..',
    '..xhx...........',
    '.xhx............',
    '.xx.............',
    '................',
  ],
  // A chunky head with the blade facing right and a straight, bright cutting edge
  // that comes to a point, over the handle running down to the bottom left.
  axe: [
    '.........xx.....',
    '........xlmx....',
    '.......xdlmx....',
    '......xdmdmxh...',
    '......xlmlmlx...',
    '.......xxdmmx...',
    '.........xxmdx..',
    '........xhxxx...',
    '.......xhx......',
    '......xhx.......',
    '.....xhx........',
    '....xhx.........',
    '...xhx..........',
    '..xhx...........',
    '..xx............',
    '................',
  ],
  shears: [
    '................',
    '................',
    '........xdsld...',
    '.......xhsld.d..',
    '......xhdld.dl..',
    '.....xhdsd.dls..',
    '....xhhhd.dlsd..',
    '....xhx..dsdhx..',
    '...xhhx.xhdhx...',
    '...xhhxxhhhx....',
    '...mmhhhhhx.....',
    '..m..mhhxx......',
    '..m..dxx........',
    '...dd...........',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '.....xxxxxxx....',
    '....xllllllmx...',
    '...xlmmmmmmmdx..',
    '..xlmmmmmmmmdx..',
    '.xmmmmmmmmmdx...',
    '.xdddddddddx....',
    '..xxxxxxxxx.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '......xxxx......',
    '.....xllmmx.....',
    '....xlmmmmdx....',
    '...xlmmmmmmdx...',
    '..xlmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '...xmmmmmmmdx...',
    '....xmmmmmdx....',
    '.....xmmmdx.....',
    '......xmdx......',
    '.......xx.......',
    '................',
    '................',
    '................',
  ],
  bow: [
    '................',
    '.........xxxxxx.',
    '.......xxdddddhx',
    '.....hshdxxxxxx.',
    '....sssxx....d..',
    '...dssx.....d...',
    '...ssx.....d....',
    '..xhx.....h.....',
    '..xdx....h......',
    '.xdx....h.......',
    '.xdx...h........',
    '.xdx..d.........',
    '.xdx.d..........',
    '.xdxd...........',
    '.xhx............',
    '..x.............',
  ],
  arrow: [
    '................',
    '............xxx.',
    '..........xxllx.',
    '.........xdslmx.',
    '..........xssx..',
    '.........xhxdx..',
    '........xhx.x...',
    '.......xhx......',
    '......xhx.......',
    '.....xhx........',
    '...xxhx.........',
    '..xsmx..........',
    '.xsssx..........',
    '..xsx...........',
    '...x............',
    '................',
  ],
  orb: [
    '................',
    '................',
    '.....xxxxxx.....',
    '....xllmmmdx....',
    '...xllddddmdx...',
    '..xlmdlmmmdmdx..',
    '..xmdlmdddmddx..',
    '..xmdmdlmdmldx..',
    '..xmdmddlmmldx..',
    '..xmdmlddddddx..',
    '...xmdmmmlldx...',
    '....xdddddddx...',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
  ],
  egg: [
    '................',
    '......xxxx......',
    '.....xllmmx.....',
    '....xllmmmmx....',
    '....xlmmmmmx....',
    '...xlmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmddx...',
    '...xmmmmmmddx...',
    '....xmmmmddx....',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
    '................',
  ],
  potion: [
    '................',
    '......xxxx......',
    '......xhhx......',
    '.......xx.......',
    '......xllx......',
    '.....xlmmmx.....',
    '....xlmmmmmx....',
    '...xlmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmddx...',
    '....xmmmmddx....',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
  ],
  shield: [
    '................',
    '..xxxxxxxxxxxx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '..xllllllllllx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '...xmmmllmmmx...',
    '...xmmmllmmmx...',
    '....xmmllmmx....',
    '.....xmllmx.....',
    '......xllx......',
    '.......xx.......',
    '................',
    '................',
  ],
  apple: [
    '................',
    '.......xx.......',
    '........hx......',
    '....xxxxhxxx....',
    '...xllmmmmmmx...',
    '..xlmmmmmmmmdx..',
    '..xlmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmddx..',
    '...xmmmmmmddx...',
    '....xddxxddx....',
    '.....xx..xx.....',
    '................',
    '................',
    '................',
  ],
  armor: [
    '................',
    '..xxxx....xxxx..',
    '.xmmmmxxxxmmmmx.',
    '.xmlmmmmmmmmlmx.',
    '.xmmmmmmmmmmmmx.',
    '..xxxmmmmmmxxx..',
    '....xmmmmmmx....',
    '....xmllmmmx....',
    '....xmmmmmmx....',
    '....xmmmmmmx....',
    '....xmmmmmmx....',
    '....xddddddx....',
    '....xxxxxxxx....',
    '................',
    '................',
    '................',
  ],
}

export type Vec3 = [number, number, number]

/** How an item sits in a hand: where it is gripped, and its offset and rotation there. */
export interface HeldPose {
  /** The art pixel that sits in the hand, or null for the centre of the drawing. */
  grip: [number, number] | null
  /** Offset from the hand, in blocks. */
  pos: Vec3
  /** Rotation in radians. */
  rot: Vec3
}

/** In your own hand: a small lean, tilted so the blade reads from the camera. */
export const HAND_POSE: Record<string, HeldPose> = {
  sword: { grip: null, pos: [-0.002, 0.209, 0.025], rot: [-0.896, -1.566, -0.25] },
  pickaxe: { grip: null, pos: [-0.002, 0.209, 0.025], rot: [-0.896, -1.566, -0.25] },
  axe: { grip: null, pos: [-0.002, 0.209, 0.025], rot: [-0.896, -1.566, -0.25] },
  shears: { grip: null, pos: [-0.09, 0.179, 0.006], rot: [0.72, 2.258, -0.25] },
  bow: { grip: [8, 7.5], pos: [-0.04, 0.205, 0.109], rot: [-0.264, -1.724, 0.08] },
}
export const DEFAULT_HAND_POSE: HeldPose = { grip: null, pos: [-0.02, 0.14, -0.1], rot: [0, 0.25, -0.25] }

/** In another player's hand: carried at the side of the arm, turned 45°. */
export const FIGURE_POSE: Record<string, HeldPose> = {
  sword: { grip: null, pos: [-0.019, -0.44, -0.361], rot: [5.528, 1.592, 0.785] },
  pickaxe: { grip: null, pos: [-0.019, -0.44, -0.361], rot: [5.528, 1.592, 0.785] },
  axe: { grip: null, pos: [-0.006, -0.44, -0.32], rot: [5.528, 4.744, 0.785] },
  shears: { grip: null, pos: [0, -0.604, -0.2], rot: [0, 0, 0.785] },
  bow: { grip: [8, 7.5], pos: [0.004, -0.562, 0.185], rot: [0.432, 1.568, 0.785] },
}
export const DEFAULT_FIGURE_POSE: HeldPose = { grip: null, pos: [0, -0.83, -0.2], rot: [0, 0, 0.7853982] }

/** Which entry of `ART` an item draws with (several items share one drawing). */
export function artKey(id: string): string | null {
  if (id.endsWith('_armor')) return 'armor'
  const def = item(id)
  if (!def) return null
  if (def.kind === 'sword') return 'sword'
  if (def.tool === 'pickaxe') return 'pickaxe'
  if (def.tool === 'axe') return 'axe'
  if (def.tool === 'shears') return 'shears'
  if (def.kind === 'shield') return 'shield'
  if (def.kind === 'food') return 'apple'
  if (id === 'iron' || id === 'gold') return 'ingot'
  if (id === 'diamond' || id === 'emerald') return 'gem'
  if (def.kind === 'bow') return 'bow'
  if (def.kind === 'ammo') return 'arrow'
  if (def.kind === 'potion') return 'potion'
  if (id === 'bridge_egg') return 'egg'
  if (def.kind === 'throwable') return 'orb'
  return null
}

export function artFor(id: string): string[] | null {
  const key = artKey(id)
  return key ? ART[key] ?? null : null
}

const ARMOR_ICON_COLORS: Record<string, string> = { chain_armor: '#9a9a9a', iron_armor: '#d8d8d8', diamond_armor: '#5fe0d8' }

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

/** Draws an item's pixel art onto a 16×16 canvas context at (0, 0). */
/** Draws an item's art; `rows` overrides the stored drawing (used by the art editor). */
export function drawItemArt(ctx: CanvasRenderingContext2D, id: string, rows?: string[]): boolean {
  const art = rows ?? artFor(id)
  if (!art) return false
  const color = ARMOR_ICON_COLORS[id] ?? item(id)?.color ?? '#ffffff'
  const palette: Record<string, string> = { h: '#7a5232', s: '#cfcfcf', m: shade(color, 1), d: shade(color, 0.7), l: shade(color, 1.25), x: 'rgba(20,16,12,0.9)' }
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = palette[ch]
      ctx.fillRect(x, y, 1, 1)
    }),
  )
  return true
}

/**
 * Item icons for the hotbar and shop: block items as small isometric cubes cut
 * from the atlas, everything else as pixel art. Cached per item and team.
 */
export class IconPainter {
  private cache = new Map<string, string>()
  constructor(
    private readonly atlas: HTMLCanvasElement,
    private readonly layout: AtlasLayout,
    private readonly blockFor: (id: string, team: TeamId) => number | undefined,
  ) {}

  url(id: string, team: TeamId = 'red'): string {
    const key = `${id}:${team}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const block = this.blockFor(id, team)
    if (block !== undefined) this.cube(ctx, block)
    else {
      const art = document.createElement('canvas')
      art.width = art.height = 16
      const actx = art.getContext('2d')!
      if (!drawItemArt(actx, id)) {
        actx.fillStyle = ITEMS[id]?.color ?? TEAM_COLORS[team]
        actx.fillRect(4, 4, 8, 8)
      }
      ctx.drawImage(art, 0, 0, 48, 48)
    }
    const url = canvas.toDataURL()
    this.cache.set(key, url)
    return url
  }

  private tileSource(tile: number): [number, number] {
    const [u0, , , v1] = tileUV(this.layout, tile)
    const size = this.layout.size * CELL
    return [Math.round(u0 * size), Math.round((1 - v1) * size)]
  }

  private cube(ctx: CanvasRenderingContext2D, block: number) {
    const [top, side] = this.layout.faces[block]
    const [tx, ty] = this.tileSource(top)
    const [sx, sy] = this.tileSource(side)
    const k = 1 / TILE
    // Top rhombus, then the left and right faces, each an affine map of the 16×16 tile.
    const faces: [number, number, number, number, number, number, number, number, number][] = [
      [tx, ty, 21 * k, 10.5 * k, -21 * k, 10.5 * k, 24, 2, 0],
      [sx, sy, 21 * k, 10.5 * k, 0, 22 * k, 3, 12.5, 0.22],
      [sx, sy, 21 * k, -10.5 * k, 0, 22 * k, 24, 23, 0.42],
    ]
    for (const [ux, uy, a, b, c, d, e, f, dark] of faces) {
      ctx.save()
      ctx.setTransform(a, b, c, d, e, f)
      ctx.drawImage(this.atlas, ux, uy, TILE, TILE, 0, 0, TILE, TILE)
      if (dark) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`
        ctx.fillRect(0, 0, TILE, TILE)
      }
      ctx.restore()
    }
  }
}
