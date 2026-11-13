/**
 * Prints an item icon as ASCII so you can design it without launching the game.
 * Each character is one pixel: `.` empty, `x` outline, `m` the item's colour,
 * `l` a lighter shade, `d` a darker shade, `h` the brown handle, `s` string grey.
 *
 *   bun scripts/icon-preview.ts wood_pickaxe
 */
import { drawItemArt } from '../src/games/bedwars/client/icons'
import { item } from '../src/games/bedwars/items'

/** Same shade maths as `drawItemArt`, so the letters printed match the letters you type. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

const id = process.argv[2] ?? 'wood_pickaxe'
const grid = Array.from({ length: 16 }, () => Array<string>(16).fill('.'))
const base = item(id)?.color ?? '#ffffff'
const palette: Record<string, string> = {
  'rgba(20,16,12,0.9)': 'x',
  '#7a5232': 'h',
  '#cfcfcf': 's',
  [shade(base, 1)]: 'm',
  [shade(base, 0.7)]: 'd',
  [shade(base, 1.25)]: 'l',
}
const unknown = new Map<string, string>()
let color = ''
const ctx = {
  set fillStyle(v: string) {
    color = v
  },
  get fillStyle() {
    return color
  },
  fillRect(x: number, y: number) {
    let ch = palette[color]
    if (!ch) {
      ch = unknown.get(color) ?? String.fromCharCode(65 + unknown.size)
      unknown.set(color, ch)
    }
    grid[y][x] = ch
  },
}

if (!drawItemArt(ctx as never, id)) {
  console.error(`no pixel art for "${id}"`)
  process.exit(1)
}
grid.forEach((row) => console.log(row.join('')))
if (unknown.size) console.log('shades:', [...unknown].map(([c, ch]) => `${ch}=${c}`).join(' '))
