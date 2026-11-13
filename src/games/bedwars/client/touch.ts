import type { Game } from './game'
import { saveSettings, TOUCH_PARTS, TOUCH_SIZE_MAX, TOUCH_SIZE_MIN, type TouchPart } from './settings'

/** A 16×16 canvas holding drawn pixel art, as a data URL for a button icon. */
function pixelIcon(draw: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  return canvas.toDataURL()
}

/** Pixel art from 16 rows of 16 characters: '#' is ink, anything else stays clear. */
function art(rows: string[], ink = '#2b2b2b'): string {
  return pixelIcon((ctx) => {
    ctx.fillStyle = ink
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(x, y, 1, 1)
    })
  })
}

/** Bedrock's chunky jump arrow. */
const ARROW_UP = [
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
]

/** The same arrow, mirrored, for sneak. */
const ARROW_DOWN = [
  '................',
  '................',
  '................',
  '................',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '..############..',
  '...##########...',
  '....########....',
  '.....######.....',
  '......####......',
  '.......##.......',
  '................',
]

/** Two fat chevrons: the sprint button. */
function sprintIcon(): string {
  return pixelIcon((ctx) => {
    ctx.fillStyle = '#2b2b2b'
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(1 + i, 3 + i, 2, 2)
      ctx.fillRect(1 + i, 13 - i, 2, 2)
      ctx.fillRect(8 + i, 3 + i, 2, 2)
      ctx.fillRect(8 + i, 13 - i, 2, 2)
    }
  })
}

/** A broad sword on the diagonal, with a guard and a grip: mine and attack. */
function swordIcon(): string {
  return pixelIcon((ctx) => {
    ctx.fillStyle = '#2b2b2b'
    // Blade, from the grip up to the top right corner.
    for (let i = 0; i < 8; i++) ctx.fillRect(4 + i, 11 - i, 3, 2)
    ctx.fillRect(12, 2, 2, 2)
    // Guard, across the blade, and the grip below it.
    for (let i = 0; i < 5; i++) ctx.fillRect(1 + i, 9 + i, 2, 2)
    for (let i = 0; i < 3; i++) ctx.fillRect(2 - i, 12 + i, 2, 2)
  })
}

/** A little camera: switches first person → third person behind → third person in front. */
function cameraIcon(): string {
  return pixelIcon((ctx) => {
    ctx.fillStyle = '#2b2b2b'
    // Body, and the viewfinder bump on top.
    ctx.fillRect(1, 5, 14, 9)
    ctx.fillRect(5, 3, 4, 2)
    // Lens, punched out of the body.
    ctx.fillStyle = '#c8c8c8'
    for (let y = 6; y < 14; y++) {
      for (let x = 5; x < 11; x++) {
        const d = Math.hypot(x - 7.5, y - 9.5)
        if (d <= 2.6) ctx.fillRect(x, y, 1, 1)
      }
    }
    ctx.fillStyle = '#2b2b2b'
    for (let y = 6; y < 14; y++) {
      for (let x = 5; x < 11; x++) {
        const d = Math.hypot(x - 7.5, y - 9.5)
        if (d <= 1.1) ctx.fillRect(x, y, 1, 1)
      }
    }
    // The red record light.
    ctx.fillStyle = '#c0302a'
    ctx.fillRect(12, 6, 2, 2)
  })
}

/** A crosshair with a hitmark centre: place a block, use the station you are looking at. */
function crosshairIcon(): string {
  return pixelIcon((ctx) => {
    ctx.fillStyle = '#2b2b2b'
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5)
        if (d >= 4.2 && d <= 6.2) ctx.fillRect(x, y, 1, 1)
      }
    }
    ctx.fillRect(7, 0, 2, 3)
    ctx.fillRect(7, 13, 2, 3)
    ctx.fillRect(0, 7, 3, 2)
    ctx.fillRect(13, 7, 3, 2)
    ctx.fillRect(7, 7, 2, 2)
  })
}

/**
 * On-screen controls for phones and tablets, in the blocky stone style of the
 * rest of the HUD: a thumb stick bottom-left for walking, drag anywhere else on
 * the world to look, hold to mine, and buttons to place, jump, sneak, shop and
 * pause. They drive the same state the mouse and keyboard do (see Game.look and
 * Game.touchInput), so movement, mining and placing behave identically.
 */

/** `?touch=1` turns the on-screen controls on for a desktop, to try them with a mouse. */
export const touchForced = () => new URLSearchParams(location.search).get('touch') === '1'

/** True when the main pointer is a finger: touch exists and no mouse is attached. */
export function isTouchDevice(): boolean {
  if (touchForced()) return true
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window
  return touch && !matchMedia('(pointer: fine)').matches
}

/**
 * Stops the browser's own touch gestures from fighting the game: a stray double tap
 * no longer zooms the page, two fingers no longer pinch it, and a long press no
 * longer opens a callout. Only the second tap of a double tap is cancelled, so
 * every single tap still reaches its button.
 */
export function installTouchGuards() {
  if (!((navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window)) return
  let lastTap = 0
  document.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length > 0) return
      const now = performance.now()
      const doubleTap = now - lastTap < 350
      lastTap = now
      if (doubleTap && e.cancelable) e.preventDefault()
    },
    { passive: false },
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault()
    },
    { passive: false },
  )
  const stop = (e: Event) => {
    if (e.cancelable) e.preventDefault()
  }
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, stop, { passive: false })
  }
}

export class TouchControls {
  private readonly root = document.createElement('div')
  private stick!: HTMLElement
  private knob!: HTMLElement
  private menuEl!: HTMLElement
  private appliedLayout = ''
  private sneakButton!: HTMLElement
  /** The pointer holding the stick, and the one dragging the view. */
  private stickPointer: number | null = null
  private lookPointer: number | null = null
  private lookLast = { x: 0, y: 0 }
  /** The small grey dot that marks where a finger is about to act. */
  private tapMark = document.createElement('div')
  private markHide: number | null = null
  private sneakOn = false
  /** The layout editor: buttons are dragged around instead of pressed. */
  private editing = false
  private editBar!: HTMLElement
  /** The control being dragged in the editor, and where the finger is. */
  private dragPart: TouchPart | null = null
  private dragPointer: number | null = null
  private dragStart = { x: 0, y: 0 }
  private dragFrom: [number, number] = [0, 0]
  /** How far the finger has moved since the drag started, to tell a tap from a drag. */
  private dragMoved = 0
  /** The control the size slider is pointed at. */
  private picked: TouchPart | null = null
  /** Where the picked control may be dragged to, as fractions of the screen, so it stays visible. */
  private dragBox = { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  private sizeInput!: HTMLInputElement
  /** The sprint button is a toggle, the way it is on a phone: tap on, tap off. */
  private sprintOn = false
  private buttons = new Set<string>()

  constructor(private readonly game: Game) {
    this.root.className = 'touch'
    this.root.innerHTML = `
      <div class="touch-look" aria-label="Look around: drag, and hold to mine"></div>
      <div class="touch-stick" role="presentation"><i class="knob"></i></div>
      <div class="touch-actions">
        <button class="touch-btn attack" data-act="attack" aria-label="Mine: hold"><img src="${swordIcon()}" alt=""></button>
        <button class="touch-btn" data-act="use" aria-label="Place"><img src="${crosshairIcon()}" alt=""></button>
        <button class="touch-btn" data-act="jump" aria-label="Jump"><img src="${art(ARROW_UP)}" alt=""></button>
        <button class="touch-btn" data-act="sneak" aria-label="Sneak"><img src="${art(ARROW_DOWN)}" alt=""></button>
        <button class="touch-btn" data-act="sprint" aria-label="Sprint"><img src="${sprintIcon()}" alt=""></button>
      </div>
      <div class="touch-menu">
        <button class="touch-mini" data-act="pause" aria-label="Pause">lll</button>
        <button class="touch-mini" data-act="chat" aria-label="Chat">Chat</button>
        <button class="touch-mini" data-act="camera" aria-label="Camera view"><img src="${cameraIcon()}" alt=""></button>
        <button class="touch-mini" data-act="bag" aria-label="Inventory">Bag</button>
      </div>`
    this.editBar = document.createElement('div')
    this.editBar.className = 'touch-editbar'
    // Tap a control to pick it, drag it to move it, and the slider sizes whatever
    // is picked, so a control can be sized while looking straight at it.
    this.editBar.innerHTML = `<span class="touch-edit-name">Drag to move \u00b7 tap to size</span>
      <label class="touch-size"><i>S</i><input type="range" min="${Math.round(TOUCH_SIZE_MIN * 100)}" max="${Math.round(TOUCH_SIZE_MAX * 100)}" step="5" value="100" data-edit="size" disabled></label>
      <button class="touch-mini" data-edit="save">Save</button><button class="touch-mini" data-edit="reset">Reset</button>`
    this.root.append(this.editBar)
    this.sizeInput = this.editBar.querySelector<HTMLInputElement>('[data-edit="size"]')!
    this.sizeInput.addEventListener('input', () => {
      if (!this.picked) return
      this.writeSizes({ ...this.game.settings.touchSizes, [this.picked]: Number(this.sizeInput.value) / 100 })
    })
    this.wireSizeSlider()
    this.editBar.querySelector('[data-edit="save"]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.endEdit()
    })
    this.editBar.querySelector('[data-edit="reset"]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.writeLayout({})
      this.writeSizes({})
    })
    this.stick = this.root.querySelector('.touch-stick')!
    this.knob = this.root.querySelector('.knob')!
    this.menuEl = this.root.querySelector('.touch-menu')!
    this.sneakButton = this.root.querySelector('[data-act="sneak"]')!
    this.tapMark.className = 'touch-tap'
    this.root.append(this.tapMark)
    // Under the HUD's own windows, so the pause card and the shop stay on top.
    game.hud.addTouchLayer(this.root)
    // The first tap is the gesture a browser needs before it plays audio.
    this.root.addEventListener('pointerdown', () => game.sound.unlock(), { once: true })
    this.wireView()
    this.wireStick()
    this.wireButtons()
    this.wireEditDrag()
  }

  destroy() {
    this.release()
    this.root.remove()
  }

  /** Called every frame: the controls are only there while they can be used. */
  update() {
    this.applyLayout()
    const g = this.game
    const show = this.editing || (g.touchPlaying && !g.uiOpen && !!g.self)
    if (this.root.classList.contains('hidden') !== !show) this.root.classList.toggle('hidden', !show)
    if (!show) this.release()
  }

  /**
   * Placement from the layout editor: the overall size, plus wherever each
   * control was dragged to, as fractions of the screen from its default spot.
   */
  private applyLayout() {
    const s = this.game.settings
    const key = `${s.touchScale}|${JSON.stringify(s.touchLayout)}|${JSON.stringify(s.touchSizes)}`
    if (key === this.appliedLayout) return
    this.appliedLayout = key
    const w = window.innerWidth
    const h = window.innerHeight
    for (const part of TOUCH_PARTS) {
      const el = this.partEl(part)
      if (!el) continue
      el.dataset.part = part
      const [x, y] = s.touchLayout[part] ?? [0, 0]
      const size = s.touchScale * (s.touchSizes[part] ?? 1)
      el.style.transform = `translate(${Math.round(x * w)}px, ${Math.round(y * h)}px) scale(${size.toFixed(3)})`
    }
    this.menuEl.style.transformOrigin = 'right top'
  }

  /** The element behind a part name: the stick, the menu group, or a button. */
  private partEl(part: TouchPart): HTMLElement | null {
    if (part === 'stick') return this.stick
    if (part === 'menu') return this.menuEl
    return this.root.querySelector<HTMLElement>(`[data-act="${part}"]`)
  }

  /** Where a control sits before it is dragged or scaled, for keeping it on screen. */
  private baseRect(el: HTMLElement): DOMRect {
    const prev = el.style.transform
    el.style.transform = 'none'
    const box = el.getBoundingClientRect()
    el.style.transform = prev
    return box
  }

  /** Switches to dragging the controls around; nothing else responds to a finger. */
  startEdit() {
    if (this.editing) return
    // Resuming first closes the pause card that opened this; the dragged controls
    // never feed input, so you stand still while you rearrange them.
    this.game.setTouchPlaying(true)
    this.editing = true
    this.release()
    this.root.classList.add('editing')
    this.root.classList.remove('hidden')
    this.showEditBar(true)
  }

  /** Saves where everything sits and goes back to playing. */
  endEdit() {
    if (!this.editing) return
    this.editing = false
    this.dragPart = this.dragPointer = null
    this.root.classList.remove('editing')
    this.showEditBar(false)
    const layout = this.game.settings.touchLayout
    // Drop the entries that are back at their default spot, to keep the file tidy.
    const kept: typeof layout = {}
    for (const [part, [x, y]] of Object.entries(layout)) if (x || y) kept[part as TouchPart] = [x, y]
    this.writeLayout(kept)
  }

  get layoutEditing(): boolean {
    return this.editing
  }

  /** Saves where every control sits. */
  private writeLayout(layout: Game['settings']['touchLayout']) {
    const s = { ...this.game.settings, touchLayout: layout }
    this.game.applySettings(s)
    saveSettings(s)
    this.appliedLayout = ''
    this.applyLayout()
  }

  /**
   * The size slider follows the finger itself: the native thumb is a few pixels
   * wide and a phone's drag never caught it. Pressing anywhere on the track sets
   * the size there, and dragging keeps setting it.
   */
  private wireSizeSlider() {
    const slider = this.sizeInput
    let pointer: number | null = null
    const setFrom = (clientX: number) => {
      if (!this.picked) return
      const box = slider.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - box.left) / Math.max(1, box.width)))
      const min = TOUCH_SIZE_MIN * 100
      const max = TOUCH_SIZE_MAX * 100
      const step = 5
      const value = Math.round((min + t * (max - min)) / step) * step
      if (Number(slider.value) === value) return
      slider.value = String(value)
      this.writeSizes({ ...this.game.settings.touchSizes, [this.picked]: value / 100 })
    }
    slider.addEventListener('pointerdown', (e) => {
      if (slider.disabled || pointer !== null) return
      e.preventDefault()
      e.stopPropagation()
      pointer = e.pointerId
      try {
        slider.setPointerCapture(e.pointerId)
      } catch {}
      setFrom(e.clientX)
    })
    slider.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return
      e.preventDefault()
      e.stopPropagation()
      setFrom(e.clientX)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      e.stopPropagation()
    }
    slider.addEventListener('pointerup', end)
    slider.addEventListener('pointercancel', end)
  }

  /** Saves the size of every control, from the editor's slider. */
  private writeSizes(sizes: Game['settings']['touchSizes']) {
    const s = { ...this.game.settings, touchSizes: sizes }
    this.game.applySettings(s)
    saveSettings(s)
    this.appliedLayout = ''
    this.applyLayout()
    this.syncPicked()
  }

  /** Picks a control for the size slider, and marks it on screen. */
  private pick(part: TouchPart | null) {
    this.picked = part
    this.syncPicked()
  }

  private syncPicked() {
    for (const part of TOUCH_PARTS) this.partEl(part)?.classList.toggle('picked', part === this.picked)
    const size = this.picked ? this.game.settings.touchSizes[this.picked] ?? 1 : 1
    this.sizeInput.disabled = !this.picked
    this.sizeInput.value = String(Math.round(size * 100))
    const label = this.editBar.querySelector('.touch-edit-name')!
    label.textContent = this.picked ? `Size of ${this.picked}` : 'Drag to move \u00b7 tap to size'
  }

  private showEditBar(on: boolean) {
    this.editBar.classList.toggle('show', on)
    const view = this.root.querySelector<HTMLElement>('.touch-look')!
    view.style.pointerEvents = on ? 'none' : ''
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act]')) b.classList.toggle('draggable', on)
    this.stick.classList.toggle('draggable', on)
    this.menuEl.classList.toggle('draggable', on)
    if (on) this.syncPicked()
    else this.pick(null)
  }

  /** In the editor: the finger drags whichever control it started on. */
  private wireEditDrag() {
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.editing || this.dragPointer !== null) return
        const target = e.target as HTMLElement
        const act = target.closest<HTMLElement>('[data-act]')?.dataset.act
        const named = TOUCH_PARTS.find((p) => p === act)
        const part: TouchPart | null =
          target.closest('.touch-stick') ? 'stick' :
          named ?? (target.closest('.touch-menu') ? 'menu' : null)
        if (!part) return
        e.preventDefault()
        e.stopPropagation()
        this.dragPart = part
        this.dragPointer = e.pointerId
        this.dragMoved = 0
        this.dragStart = { x: e.clientX, y: e.clientY }
        this.dragFrom = [...(this.game.settings.touchLayout[part] ?? [0, 0])] as [number, number]
        // Room to move: a control may go anywhere it still fits on the screen, not
        // just a short way from where it started.
        const el = this.partEl(part)
        const w = window.innerWidth
        const h = window.innerHeight
        const box = el ? this.baseRect(el) : null
        this.dragBox = box
          ? { minX: -box.left / w, maxX: (w - box.right) / w, minY: -box.top / h, maxY: (h - box.bottom) / h }
          : { minX: -1, maxX: 1, minY: -1, maxY: 1 }
      },
      true,
    )
    this.root.addEventListener(
      'pointermove',
      (e) => {
        if (!this.editing || e.pointerId !== this.dragPointer || !this.dragPart) return
        e.preventDefault()
        e.stopPropagation()
        const w = window.innerWidth
        const h = window.innerHeight
        const dx = (e.clientX - this.dragStart.x) / w
        const dy = (e.clientY - this.dragStart.y) / h
        this.dragMoved = Math.max(this.dragMoved, Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y))
        const nx = Math.max(this.dragBox.minX, Math.min(this.dragBox.maxX, this.dragFrom[0] + dx))
        const ny = Math.max(this.dragBox.minY, Math.min(this.dragBox.maxY, this.dragFrom[1] + dy))
        this.writeLayout({ ...this.game.settings.touchLayout, [this.dragPart]: [nx, ny] })
      },
      true,
    )
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.dragPointer) return
      // A tap, not a drag: pick that control and point the size slider at it.
      if (this.dragPart && this.dragMoved < 6) this.pick(this.dragPart)
      this.dragPart = null
      this.dragPointer = null
    }
    this.root.addEventListener('pointerup', end, true)
    this.root.addEventListener('pointercancel', end, true)
  }

  /** Lets go of everything held, for when a window opens over the controls. */
  private release() {
    this.stickPointer = this.lookPointer = null
    this.tapMark.classList.remove('on')
    this.knob.style.transform = ''
    this.buttons.clear()
    this.sneakOn = false
    this.sneakButton.classList.remove('on')
    this.sprintOn = false
    this.root.querySelector('[data-act="sprint"]')?.classList.remove('held')
    const t = this.game.touchInput
    t.forward = t.strafe = 0
    t.jump = t.sneak = t.sprint = false
    this.game.touchAttack(false)
    this.game.touchUse(false)
  }

  /**
   * The world behind the controls: drag to look, tap to act. A drag never
   * clicks, so sliding the camera around no longer hits or places by mistake;
   * a finger that stays put for a moment mines, as holding a left click does.
   */
  private wireView() {
    const view = this.root.querySelector<HTMLElement>('.touch-look')!
    let start = { x: 0, y: 0 }
    let startedAt = 0
    let dragged = false
    let mining = false
    /** Holding the screen with food selected eats, as holding mine would dig. */
    let using = false
    let holdTimer: number | null = null
    const stopHold = () => {
      if (holdTimer !== null) window.clearTimeout(holdTimer)
      holdTimer = null
    }
    view.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return
      e.preventDefault()
      this.lookPointer = e.pointerId
      this.lookLast = { x: e.clientX, y: e.clientY }
      start = { x: e.clientX, y: e.clientY }
      startedAt = performance.now()
      dragged = false
      mining = false
      using = false
      try {
        view.setPointerCapture(e.pointerId)
      } catch {}
      this.showMark(e.clientX, e.clientY)
      holdTimer = window.setTimeout(() => {
        holdTimer = null
        if (dragged || this.lookPointer !== e.pointerId) return
        if (this.game.heldDef()?.kind === 'food') {
          using = true
          this.game.touchUse(true)
          return
        }
        mining = true
        this.game.touchAttack(true)
      }, 260)
    })
    view.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        dragged = true
        stopHold()
      }
      // A finger is coarser than a mouse, so a drag turns a little further.
      this.game.turn((e.clientX - this.lookLast.x) * 1.6, (e.clientY - this.lookLast.y) * 1.6)
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.showMark(e.clientX, e.clientY)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointer) return
      this.lookPointer = null
      stopHold()
      const quick = performance.now() - startedAt < 260
      if (mining) this.game.touchAttack(false)
      if (using) this.game.touchUse(false)
      if (!mining && !using && !dragged && quick) this.game.touchTap(e.clientX, e.clientY)
      this.hideMark()
    }
    view.addEventListener('pointerup', end)
    view.addEventListener('pointercancel', end)
    view.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** The grey dot under the finger, moved as it drags. */
  private showMark(x: number, y: number) {
    // With the crosshair as the pointer the finger leaves no mark behind.
    if (this.game.settings.touchAim === 'crosshair') return
    if (this.markHide !== null) window.clearTimeout(this.markHide)
    this.markHide = null
    this.tapMark.style.transform = `translate(${x}px, ${y}px)`
    this.tapMark.classList.add('on')
  }

  /** It flashes out a moment after the finger lifts. */
  private hideMark() {
    this.markHide = window.setTimeout(() => this.tapMark.classList.remove('on'), 160)
  }

  /** The thumb stick: push to walk, push all the way out to sprint. */
  private wireStick() {
    const radius = 46
    const put = (x: number, y: number) => {
      const t = this.game.touchInput
      const len = Math.hypot(x, y)
      const clamped = len > radius ? radius / len : 1
      this.knob.style.transform = `translate(${x * clamped}px, ${y * clamped}px)`
      const nx = (x * clamped) / radius
      const ny = (y * clamped) / radius
      const strength = Math.hypot(nx, ny)
      if (strength < 0.18) {
        t.forward = t.strafe = 0
        t.sprint = this.sprintOn
      } else {
        t.forward = -ny
        t.strafe = nx
        t.sprint = strength > 0.92 || this.sprintOn
      }
    }
    const move = (e: PointerEvent) => {
      const box = this.stick.getBoundingClientRect()
      put(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2))
    }
    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return
      e.preventDefault()
      this.stickPointer = e.pointerId
      this.stick.setPointerCapture(e.pointerId)
      move(e)
    })
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) move(e)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return
      this.stickPointer = null
      this.knob.style.transform = ''
      const t = this.game.touchInput
      t.forward = t.strafe = 0
      t.sprint = this.sprintOn
    }
    this.stick.addEventListener('pointerup', end)
    this.stick.addEventListener('pointercancel', end)
  }

  /** Press-and-hold buttons for the actions a mouse's two buttons would do. */
  private wireButtons() {
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-act]')) {
      const act = button.dataset.act!
      if (act === 'attack' || act === 'use' || act === 'jump') {
        const set = (down: boolean) => {
          if (down) this.buttons.add(act)
          else this.buttons.delete(act)
          if (act === 'attack') this.game.touchAttack(down)
          if (act === 'use') this.game.touchUse(down)
          if (act === 'jump') this.game.touchInput.jump = down
          button.classList.toggle('held', down)
        }
        button.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          button.setPointerCapture(e.pointerId)
          set(true)
        })
        const up = () => set(false)
        button.addEventListener('pointerup', up)
        button.addEventListener('pointercancel', up)
        button.addEventListener('lostpointercapture', up)
        continue
      }
      // Sprint follows the setting, checked when pressed so changing it works
      // straight away: toggle mode latches on a tap, otherwise the button only
      // sprints while it is held down.
      if (act === 'sprint') {
        const toggleMode = () => this.game.settings.sprintMode === 'toggle'
        const set = (down: boolean) => {
          this.sprintOn = down
          this.game.touchInput.sprint = down
          button.classList.toggle(toggleMode() ? 'on' : 'held', down)
        }
        button.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          if (toggleMode()) set(!this.sprintOn)
          else {
            try {
              button.setPointerCapture(e.pointerId)
            } catch {}
            set(true)
          }
        })
        const up = () => {
          if (toggleMode()) return
          set(false)
          button.classList.remove('held', 'on')
        }
        button.addEventListener('pointerup', up)
        button.addEventListener('pointercancel', up)
        button.addEventListener('lostpointercapture', up)
        continue
      }
      // Pointer down, not click: a tap that lands soon after another touch is
      // swallowed by the browser's double-tap guard, which used to make sprint
      // and sneak unpressable while the stick was in use.
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        if (act === 'sneak') {
          this.sneakOn = !this.sneakOn
          this.game.touchInput.sneak = this.sneakOn
          this.sneakButton.classList.toggle('on', this.sneakOn)
        } else if (act === 'sprint') {
          this.sprintOn = !this.sprintOn
          this.game.touchInput.sprint = this.sprintOn
          button.classList.toggle('on', this.sprintOn)
        } else if (act === 'pause') this.game.setTouchPlaying(false)
        else if (act === 'chat') this.game.hud.openChat('')
        else if (act === 'camera') this.game.cycleView()
        else if (act === 'bag') this.game.hud.openInventory()
      })
    }
  }
}
