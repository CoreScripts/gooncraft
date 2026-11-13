import {
  AmbientLight,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  DirectionalLight,
  Fog,
  HemisphereLight,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { AIR, blockDef } from '../blocks'
import { breakTicks, bridgeCell, checkPlace } from '../../../engine/building'
import { checkBreak } from '../beds'
import { ATTACK_REACH, BLOCK_REACH, EAT_SLOWDOWN, EYE_HEIGHT, SNEAK_EYE_HEIGHT, TICK_MS, TPS } from '../constants'
import { countItem, HOTBAR } from '../../../engine/inventory'
import { item, JUMP_BOOST, placedBlock, SPEED_BOOST } from '../items'
import type { MapMeta } from '../maps/types'
import { IDLE_INPUT, lookDirection, playerBox, stepMovement, type MoveInput, type Mover } from '../../../engine/physics'
import type { ClientMessage, GameView, PlayerView, SelfView, ServerMessage } from '../protocol'
import type { BotLevel } from '../rules'
import { raycastBlock, rayBox, type BlockHit } from '../../../engine/raycast'
import { fromBase64, World } from '../../../engine/world'
import type { Connection } from '../../../engine/net/client'
import { atlasLayout } from '../../../engine/render/atlas-layout'
import { ChunkRenderer } from '../../../engine/render/chunks'
import { BlockCursor } from '../../../engine/render/entities'
import { ItemDrops } from './drops'
import { createMapDecor, PlayerModels } from './models'
import { IconPainter } from './icons'
import { createChunkMaterial, defaultEnvironment } from '../../../engine/render/shaders'
import { createSky } from '../../../engine/render/sky'
import { crackTextures, createAtlasTexture } from '../../../engine/render/textures'
import { ViewModel } from './viewmodel'
import { Hud } from './hud'
import { actionFor, pixelRatio, type Action, type Settings } from './settings'
import { Particles } from './particles'
import { ProjectileModels } from './projectiles'
import { FloatingText } from './floating-text'
import { GeneratorDisplays } from './generators'
import { Avatar } from './avatar'
import { loadLook } from './wardrobe'
import { encodeLook, KILL_EFFECTS, TRAILS, type Look } from '../look'
import { falloff, Sound } from './sound'
import { isTouchDevice, TouchControls } from './touch'

type Target = { kind: 'block'; hit: BlockHit } | { kind: 'player'; id: number; distance: number } | { kind: 'npc'; npc: MapMeta['npcs'][number]; distance: number } | null


/**
 * The client: predicts its own movement with the shared physics at the
 * server's tick rate, renders everything else from snapshots, and turns
 * input into the same messages a bot or test would send.
 */
export class Game {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 600)
  readonly hud: Hud
  private env = defaultEnvironment()
  private layout = atlasLayout()
  private atlas = createAtlasTexture(this.layout)
  private material = createChunkMaterial(this.atlas.texture, this.layout.size, this.env)
  private glassMaterial = createChunkMaterial(this.atlas.texture, this.layout.size, this.env, true)
  private cracks = crackTextures()
  private viewModel = new ViewModel(this.atlas.texture, this.layout)
  private players = new PlayerModels(
    this.layout,
    this.atlas.texture,
    (x, y, z, trail) => this.trail(x, y, z, trail),
    (x, y, z) => this.groundBelow(x, y, z),
  )
  /** Your own figure, drawn in the third-person view. */
  private selfAvatar = new Avatar(this.layout, this.atlas.texture)
  /** 0 first person, 1 third person behind, 2 third person in front. */
  viewMode = 0

  /** Cycles first person → third person behind → third person in front → first person. */
  cycleView(): void {
    this.viewMode = ((this.viewMode + 1) % 3) as 0 | 1 | 2
  }

  /** True in both third-person modes, where your own figure is drawn. */
  private get thirdPerson(): boolean {
    return this.viewMode !== 0
  }
  private selfTrailClock = 0
  private dropModels = new ItemDrops()
  private cursor = new BlockCursor(this.cracks)
  private sky: ReturnType<typeof createSky> | null = null
  private decor: Object3D | null = null
  private chunks: ChunkRenderer | null = null

  world: World | null = null
  map: MapMeta | null = null
  myId = 0
  self: SelfView | null = null
  gameView: GameView | null = null
  views: PlayerView[] = []
  private viewMap = new Map<number, PlayerView>()
  /** Lobby map vote state, and this player's own vote. */
  votes: Extract<ServerMessage, { t: 'votes' }> | null = null
  /** The lobby's start vote: who clicked Start, and how many it takes. */
  ready: Extract<ServerMessage, { t: 'ready' }> | null = null
  myVote: string | null = null
  /** The level bots will play at, as the host last set it. */
  botLevel: BotLevel = 'normal'
  private tick = 0

  /** Our own body, predicted locally. */
  me: Mover = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, sneaking: false, sprinting: false, fallDistance: 0 }
  private prev = { x: 0, y: 0, z: 0 }
  private tp = 0
  private eye = EYE_HEIGHT
  private spectator = { x: 0, y: 0, z: 0 }

  private keys = new Set<string>()
  private leftDown = false
  private rightDown = false
  private clickQueue: ('attack' | 'use')[] = []
  private lastForwardTap = 0
  /** Sprint started by a double-tap or a toggle press; the physics drops it when you stop going forward. */
  private sprintLatched = false
  private placeCooldown = 0
  /** Tick a block was last placed on, so one tick never spends two. */
  private placedTick = -1
  /** Floor level of the bridge being laid, held while you are in the air between cells. */
  private bridgeY = 0
  private digCooldown = 0
  private dig: { x: number; y: number; z: number; progress: number } | null = null
  private target: Target = null
  private remoteBoxes: ReturnType<PlayerModels['boxes']> = []
  private accumulator = 0
  private lastFrame = performance.now()
  private fps = 60
  private lastCountdown = 0
  readonly sound = new Sound()
  private particles = new Particles()
  private projectiles = new ProjectileModels(this.layout, this.atlas.texture)
  private damageText = new FloatingText()
  private gens = new GeneratorDisplays()
  private shake = 0
  private hurtRoll = 0
  private pendingHit: { id: number; at: number; crit: boolean } | null = null
  private lastKnock: { vx: number; vz: number; at: number } | null = null
  private running = true
  readonly icons: IconPainter
  settings: Settings

  constructor(
    private readonly container: HTMLElement,
    private readonly connection: Connection<ClientMessage, ServerMessage>,
    settings: Settings,
    readonly mode: { offline: boolean; world: 'arena' | 'sandbox' },
  ) {
    this.settings = settings
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.outputColorSpace = SRGBColorSpace
    // The chunk shader applies Voxelize's light curve itself.
    this.renderer.toneMapping = NoToneMapping
    this.renderer.autoClear = false
    this.renderer.setClearColor(this.env.skyMiddle)
    container.appendChild(this.renderer.domElement)

    this.scene.add(new HemisphereLight(0xcfe6ff, 0x5a6a80, 1.6))
    this.scene.add(new AmbientLight(0xffffff, 0.35))
    const sun = new DirectionalLight(0xfff4e0, 1.6)
    sun.position.copy(this.env.sunDirection).multiplyScalar(100)
    this.scene.add(sun)
    this.scene.fog = new Fog(this.env.skyMiddle, this.env.fogNear, this.env.fogFar)
    this.scene.add(this.players.group, this.dropModels.group, this.cursor.group, this.particles.mesh, this.projectiles.group, this.damageText.group, this.selfAvatar.root, this.gens.group)
    this.selfAvatar.root.visible = false
    this.camera.rotation.order = 'YXZ'

    this.icons = new IconPainter(this.atlas.canvas, this.layout, (id, team) => {
      const def = item(id)
      return def?.kind === 'block' ? placedBlock(def, team) : def?.kind === 'tnt' ? def.block : undefined
    })
    this.hud = new Hud(container, this)
    // Phones and tablets get on-screen controls instead of a locked pointer.
    if (isTouchDevice()) {
      this.touchUi = new TouchControls(this)
      this.touchPlaying = true
    }

    this.hud.setLoading('Joining the game')
    connection.onMessage((m) => this.onMessage(m))
    connection.onClose((reason) => this.hud.showError(reason))
    this.bindInput()
    window.addEventListener('resize', this.resize)
    this.resize()
    requestAnimationFrame(this.frame)
  }

  send(msg: ClientMessage) {
    this.connection.send(msg)
  }

  destroy() {
    this.running = false
    this.touchUi?.destroy()
    this.connection.close()
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
    this.hud.destroy()
    this.renderer.domElement.remove()
  }

  // Server messages -----------------------------------------------------------

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id
        this.tp = m.tp
        this.loadWorld(m.world, m.map)
        this.send({ t: 'look', look: encodeLook(this.look) })
        break
      case 'world':
        this.loadWorld(m.world, m.map)
        break
      case 'tick': {
        this.tick = m.tick
        for (const d of m.players) {
          const prev = this.viewMap.get(d.id)
          const next = { ...prev, ...d } as PlayerView
          // Someone took a hit: a puff of red, a thump and the damage over their head.
          if (prev && d.hurtAt !== undefined && d.id !== this.myId && next.alive) {
            const mine = this.pendingHit && this.pendingHit.id === d.id && performance.now() - this.pendingHit.at < 600
            this.particles.burst(next.x, next.y + 1.1, next.z, '#c0302a', mine ? 14 : 8, 0.6, mine ? 3 : 2)
            this.sound.play('hit', mine ? 1 : falloff(Math.hypot(next.x - this.me.x, next.y - this.me.y, next.z - this.me.z)))
            const lost = (prev.health ?? next.health) - next.health
            if (lost > 0) this.damageText.show(next.x, next.y + 2.4, next.z, `-${lost}`, mine && this.pendingHit!.crit ? '#ffe14a' : '#ff5a4a')
            if (mine) {
              if (this.pendingHit!.crit) this.particles.burst(next.x, next.y + 1.5, next.z, '#fff3a0', 12, 0.8, 4)
              this.hud.hitMarker(this.pendingHit!.crit)
              this.pendingHit = null
            }
          }
          this.viewMap.set(d.id, next)
        }
        for (const id of m.gone ?? []) this.viewMap.delete(id)
        this.views = [...this.viewMap.values()]
        if (m.game) {
          const was = this.gameView?.phase
          this.gameView = m.game
          // Back in the lobby after a round: hand the pointer back, so the room panel
          // (with the host's controls, or the normal one) is what you see.
          if (was && was !== 'waiting' && m.game.phase === 'waiting' && this.locked) document.exitPointerLock?.()
        }
        this.players.update(this.views, this.myId, m.tick, performance.now(), this.self?.team ?? null)
        if (m.drops) this.dropModels.update(m.drops)
        break
      }
      case 'self': {
        const before = this.self
        this.self = m.self
        if (!before) this.hud.setLoading(null)
        if (before && m.self.health < before.health && m.self.alive) {
          this.hud.hurtFlash()
          this.sound.play('hurt')
          // Knockback points away from whoever hit us: show where it came from and tilt the view.
          const k = this.lastKnock
          if (k && performance.now() - k.at < 400 && Math.hypot(k.vx, k.vz) > 0.05) {
            const fx = -Math.sin(this.me.yaw)
            const fz = -Math.cos(this.me.yaw)
            const ahead = -(k.vx * fx + k.vz * fz)
            const right = -(k.vx * -fz + k.vz * fx)
            const angle = Math.atan2(right, ahead)
            this.hud.damageFrom(angle)
            this.hurtRoll = Math.sign(right || 1) * 0.12
          } else this.hurtRoll = 0.08
        }
        if (before && ['iron', 'gold', 'diamond', 'emerald'].some((r) => countItem(m.self.inventory, r) > countItem(before.inventory, r))) this.sound.play('pickup', 0.6)
        if (!m.self.alive && before?.alive) {
          this.dig = null
          this.spectator = { x: this.map?.spectator[0] ?? 0, y: this.map?.spectator[1] ?? 0, z: this.map?.spectator[2] ?? 0 }
          this.me.yaw = this.map?.spectator[3] ?? 0
          this.me.pitch = this.map?.spectator[4] ?? 0
        }
        break
      }
      case 'blocks':
        for (const [x, y, z, raw] of m.changes) {
          const before = this.world?.get(x, y, z) ?? AIR
          this.world?.set(x, y, z, raw & 0x7f, (raw & 0x80) !== 0)
          const d = Math.hypot(x + 0.5 - this.me.x, y + 0.5 - this.me.y, z + 0.5 - this.me.z)
          if (before !== AIR && (raw & 0x7f) === AIR) {
            this.particles.burst(x + 0.5, y + 0.5, z + 0.5, blockDef(before).texture.top, 14)
            this.sound.play('break', falloff(d))
          } else if (before === AIR && (raw & 0x7f) !== AIR) this.sound.play('place', falloff(d) * 0.7)
        }
        break
      case 'velocity':
        this.me.vx = m.vx
        this.me.vy = m.vy
        this.me.vz = m.vz
        this.me.onGround = false
        this.lastKnock = { vx: m.vx, vz: m.vz, at: performance.now() }
        break
      case 'teleport':
        this.me.x = this.prev.x = m.x
        this.me.y = this.prev.y = m.y
        this.me.z = this.prev.z = m.z
        this.me.yaw = m.yaw
        this.me.pitch = m.pitch
        this.me.vx = this.me.vy = this.me.vz = 0
        this.me.fallDistance = 0
        this.tp = m.tp
        break
      case 'event':
        this.hud.event(m)
        if (m.kind === 'bed') this.sound.play('bed')
        else if (m.kind === 'kill' && this.self && m.text.includes(` by ${this.viewMap.get(this.myId)?.name}`)) this.sound.play('kill')
        else if (m.kind === 'error') this.sound.play('deny')
        else if (m.kind === 'title' && m.text === 'Protect your bed') this.sound.play('start')
        break
      case 'summary':
        this.hud.showSummary(m)
        break
      case 'projectiles':
        this.projectiles.update(m.list, performance.now())
        break
      case 'explosion': {
        const d = Math.hypot(m.x - this.me.x, m.y - this.me.y, m.z - this.me.z)
        this.particles.burst(m.x, m.y, m.z, '#ff9a2a', 30, m.power, 7)
        this.particles.burst(m.x, m.y, m.z, '#5a5a5a', 24, m.power * 1.2, 4)
        this.sound.play('explode', falloff(d, 48))
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / (m.power * 6)))
        break
      }
      case 'gens':
        this.gens.update(m.list)
        break
      case 'effect':
        this.killEffect(m.effect, m.x, m.y, m.z)
        break
      case 'votes':
        // A freshly opened map vote clears our own pick along with everyone else's.
        if (m.open && !this.votes?.open) this.myVote = null
        this.votes = m
        break
      case 'ready':
        this.ready = m
        break
      case 'lobby':
        this.botLevel = m.botLevel
        break
    }
  }

  private loadWorld(encoded: string, map: MapMeta) {
    this.chunks?.dispose()
    if (this.chunks) this.scene.remove(this.chunks.group)
    if (this.decor) this.scene.remove(this.decor)
    if (this.sky) this.scene.remove(this.sky.root)
    this.players.clear()
    this.dropModels.clear()
    this.projectiles.clear()
    this.viewMap.clear()
    this.world = World.decode(fromBase64(encoded))
    this.map = map
    this.chunks = new ChunkRenderer(this.world, this.layout, this.material, this.glassMaterial)
    this.chunks.buildAll()
    this.scene.add(this.chunks.group)
    this.decor = createMapDecor(map.npcs, map.labels.filter((l) => l.text !== 'Diamond' && l.text !== 'Emerald'), this.layout, this.atlas.texture)
    this.gens.load(map.generators)
    this.scene.add(this.decor)
    const top = map.bases[0]?.spawn[1] ?? 40
    this.sky = createSky(this.env, top + 45, [this.world.sx / 2, this.world.sz / 2])
    this.sky.clouds.visible = this.settings.clouds
    this.scene.add(this.sky.root)
    this.spectator = { x: map.spectator[0], y: map.spectator[1], z: map.spectator[2] }
  }

  // Input ---------------------------------------------------------------------

  /** The on-screen controls, on phones and tablets; null on a desktop. */
  private touchUi: TouchControls | null = null
  /** True while the touch controls are driving the game: there is no pointer to lock. */
  touchPlaying = false
  /** Where the thumb stick is pushed and which touch buttons are held, as client/touch.ts last set them. */
  readonly touchInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }

  get uiOpen(): boolean {
    return this.hud.modalOpen
  }

  /** Waiting on the deck for a round, where Q is a start vote rather than a drop. */
  private lobbyWaiting(): boolean {
    const v = this.gameView
    return !!v && v.mode === 'arena' && v.phase === 'waiting'
  }

  get locked(): boolean {
    return document.pointerLockElement === this.renderer.domElement
  }

  /** Whether input should move you: a locked pointer, the touch controls, or scripted play. */
  get playing(): boolean {
    return this.locked || this.touchPlaying || this.automation
  }

  lock() {
    this.sound.unlock()
    if (this.uiOpen) return
    // A phone has no pointer to lock: the on-screen controls are the game.
    if (this.touchUi) {
      this.setTouchPlaying(true)
      return
    }
    this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {})
  }

  /** Resumes or pauses the touch controls; pausing brings up the same menu Esc does. */
  setTouchPlaying(on: boolean) {
    if (!this.touchUi) return
    this.touchPlaying = on
    if (!on) this.releaseTouch()
    this.hud.setLocked(this.locked)
  }

  /** Opens the touch layout editor: drag every control into place, then save. */
  editTouchLayout() {
    if (!this.touchUi) {
      this.hud.toast('The on-screen controls are only on touch screens.')
      return
    }
    this.touchUi.startEdit()
  }

  /** Lets go of the stick and every touch button, e.g. when a window opens over them. */
  private releaseTouch() {
    const t = this.touchInput
    t.forward = t.strafe = 0
    t.jump = t.sneak = t.sprint = false
    this.touchAttack(false)
    this.touchUse(false)
  }

  /** Turns the view by a pointer delta in pixels, from the mouse or a touch drag. */
  turn(dx: number, dy: number) {
    const s = this.settings.sensitivity * 0.0022
    this.me.yaw -= dx * s
    this.me.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.me.pitch - dy * s * (this.settings.invertY ? -1 : 1)))
  }

  /**
   * A finger tapped the world. With `touchAim: 'tap'` the tap point is the
   * pointer, so the game looks through the screen at that spot: a player there
   * is hit, a block face with room in front of it takes the block you hold,
   * and any other block starts being mined. With `touchAim: 'crosshair'` the
   * crosshair in the middle is the pointer and the tap just clicks it.
   */
  touchTap(clientX: number, clientY: number) {
    if (!this.world || this.uiOpen) return
    if (this.settings.touchAim !== 'crosshair') this.target = this.pickAt(clientX, clientY)
    this.actOnTarget()
  }

  /** What the screen is pointing at from the camera, the way a tap sees it. */
  private pickAt(clientX: number, clientY: number): Target {
    if (!this.world || !this.map) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const point = new Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1), 0.5).unproject(this.camera)
    const eye: [number, number, number] = [this.camera.position.x, this.camera.position.y, this.camera.position.z]
    const dir: [number, number, number] = [point.x - eye[0], point.y - eye[1], point.z - eye[2]]
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    dir[0] /= len
    dir[1] /= len
    dir[2] /= len
    const block = raycastBlock(this.world, eye, dir, BLOCK_REACH)
    // Only a solid block hides a player behind it, as with the crosshair.
    const wall = raycastBlock(this.world, eye, dir, BLOCK_REACH, true)
    let best: Target = block ? { kind: 'block', hit: block } : null
    let bestD = wall ? wall.distance : BLOCK_REACH
    for (const n of this.map.npcs) {
      if (n.kind === 'dummy') continue
      const hit = rayBox(eye, dir, playerBox(n.x, n.y, n.z, false), BLOCK_REACH)
      if (hit && hit.distance < bestD) {
        bestD = hit.distance
        best = { kind: 'npc', npc: n, distance: hit.distance }
      }
    }
    for (const p of this.remoteBoxes) {
      const hit = rayBox(eye, dir, playerBox(p.x, p.y, p.z, p.sneak), ATTACK_REACH)
      if (hit && hit.distance < bestD) {
        bestD = hit.distance
        best = { kind: 'player', id: p.id, distance: hit.distance }
      }
    }
    return best
  }

  /** One tap's action on whatever the pointer is on: hit, place, mine or talk. */
  private actOnTarget() {
    const held = this.heldDef()
    // Food, potions, a bow or a throwable are used wherever you tap, the way a
    // right click uses them wherever the crosshair points. Before this, a tap on
    // a block swung the pickaxe instead, and a tap on the sky did nothing at all.
    if (held && held.kind !== 'block' && held.kind !== 'shield' && held.kind !== 'tool') {
      this.secondary()
      return
    }
    const t = this.target
    if (!t) return
    if (t.kind === 'npc') {
      this.npcTarget = t
      this.secondary()
      return
    }
    if (t.kind === 'player') {
      this.primary()
      return
    }
    const { x, y, z, face } = t.hit
    const open = this.world?.get(x + face[0], y + face[1], z + face[2]) === AIR
    if (held?.kind === 'block' && open) this.place(t.hit)
    else this.startDig(t.hit)
  }

  /** The touch MINE button and the drag-to-mine gesture: the same press a left click makes. */
  touchAttack(down: boolean) {
    if (down) {
      if (this.uiOpen) return
      this.leftDown = true
      this.clickQueue.push('attack')
    } else {
      this.leftDown = false
      this.stopDig()
    }
  }

  /** The touch PLACE button: right click, for blocks, food, bows and shopkeepers. */
  touchUse(down: boolean) {
    if (down) {
      if (this.uiOpen) return
      this.rightDown = true
      this.placeCooldown = 0
      this.clickQueue.push('use')
    } else {
      this.rightDown = false
      this.releaseBow()
    }
  }

  private bindInput() {
    const canvas = this.renderer.domElement
    canvas.addEventListener('click', () => this.lock())
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) {
        this.leftDown = this.rightDown = false
        this.keys.clear()
        this.stopDig()
      }
      this.hud.setLocked(this.locked)
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      this.turn(e.movementX, e.movementY)
    })
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return
      if (e.button === 0) {
        this.leftDown = true
        this.clickQueue.push('attack')
      } else if (e.button === 2) {
        this.rightDown = true
        this.placeCooldown = 0
        this.clickQueue.push('use')
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.leftDown = false
        this.stopDig()
      } else if (e.button === 2) {
        this.rightDown = false
        this.releaseBow()
      }
    })
    // Right click is the game's use button, so the browser's own menu must never
    // open: it covers the canvas and the whole HUD over it, including the
    // shopkeeper you just talked to. Chat keeps its paste menu.
    document.addEventListener('contextmenu', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.target === canvas || (e.target instanceof Node && this.container.contains(e.target))) e.preventDefault()
    })
    document.addEventListener('wheel', (e) => {
      if (!this.locked || !this.self) return
      const next = (this.self.selected + (e.deltaY > 0 ? 1 : HOTBAR - 1)) % HOTBAR
      this.select(next)
    })
    window.addEventListener('keydown', (e) => {
      if (this.hud.chatOpen || this.hud.settingsOpen) return
      const action = actionFor(this.settings, e.code)
      if (action === 'players') {
        e.preventDefault()
        this.hud.setScoreboard(true)
      }
      // In the lobby Q is the start vote, as the sidebar says; the pointer is not
      // locked there, so it cannot be the drop key.
      if (e.code === 'KeyQ' && !e.repeat && this.lobbyWaiting()) {
        e.preventDefault()
        this.send({ t: 'ready', ready: !this.ready?.ids.includes(this.myId) })
        return
      }
      if (this.uiOpen) {
        if (e.code === 'Escape' || action === 'inventory' || action === 'shop') this.hud.closeModal()
        return
      }
      if (action === 'forward' && !e.repeat) {
        if (this.settings.doubleTapSprint && performance.now() - this.lastForwardTap < 280) this.sprintLatched = true
        this.lastForwardTap = performance.now()
      }
      if (action === 'sprint' && !e.repeat && this.settings.sprintMode === 'toggle') this.sprintLatched = !this.sprintLatched
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5))
        if (n >= 1 && n <= 9) this.select(n - 1)
      }
      if (action === 'chat' || action === 'command') {
        e.preventDefault()
        this.hud.openChat(action === 'command' ? '/' : '')
        return
      }
      if (action === 'perspective') this.cycleView()
      if (action === 'debug') {
        e.preventDefault()
        this.hud.toggleDebug()
      }
      if (action === 'inventory') this.hud.openInventory()
      if (action === 'shop') this.openNearestShop()
      // Q throws one of what you hold; with Ctrl, the whole stack.
      if (action === 'drop' && this.locked) this.send({ t: 'drop', all: e.ctrlKey })
      // Keep the page from scrolling or the browser acting on game keys while playing.
      if (this.locked && (action || e.code === 'Space')) e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
      const action = actionFor(this.settings, e.code)
      if (action === 'players') this.hud.setScoreboard(false)
      // A double-tap sprint lasts while forward is held; a toggled one until toggled off.
      if (action === 'forward' && this.settings.sprintMode !== 'toggle') this.sprintLatched = false
    })
    window.addEventListener('blur', () => this.keys.clear())
  }

  /** Whether any key bound to `action` is held. */
  private down(action: Action): boolean {
    return (this.settings.keys[action] ?? []).some((c) => this.keys.has(c))
  }

  /** Applies settings live: render size, fog distance, volume. */
  applySettings(s: Settings) {
    this.settings = s
    this.renderer.setPixelRatio(pixelRatio(s.quality, window.devicePixelRatio))
    this.resize()
    const near = s.renderDistance * 0.45
    for (const m of [this.material, this.glassMaterial]) {
      m.uniforms.uFogNear.value = near
      m.uniforms.uFogFar.value = s.renderDistance
    }
    if (this.sky) {
      this.sky.cloudMaterial.uniforms.uFogNear.value = near * 2
      this.sky.cloudMaterial.uniforms.uFogFar.value = s.renderDistance * 2.4
      this.sky.clouds.visible = s.clouds
    }
    const fog = this.scene.fog as Fog
    fog.near = near
    fog.far = s.renderDistance
    // Far enough for the sky dome (radius 400) whatever the fog distance.
    this.camera.far = Math.max(600, s.renderDistance * 2)
    this.camera.updateProjectionMatrix()
    this.sound.setVolume(s.volume)
  }

  /** Bow draw in progress (local clock, for the view model and charge bar). */
  private drawStart: number | null = null

  /** Local clock for the bite in progress: the eat animation runs until then. */
  private eatUntil = 0

  /** Local clock for the drink in progress: the bottle stays at the mouth until then. */
  private drinkUntil = 0

  private get eating(): boolean {
    return performance.now() < this.eatUntil
  }

  private get drinking(): boolean {
    return performance.now() < this.drinkUntil
  }

  /** Eating or drinking: the hand comes up and you shuffle along at the same slow pace. */
  private get using(): boolean {
    return this.eating || this.drinking
  }

  /** Letting go of the use button stops the bite: nothing is eaten, drunk or healed. */
  private cancelEat() {
    if (this.eatUntil === 0 && this.drinkUntil === 0) return
    this.eatUntil = 0
    this.drinkUntil = 0
    this.send({ t: 'eatCancel' })
  }

  drawCharge(): number {
    return this.drawStart === null ? 0 : Math.min(1, (performance.now() - this.drawStart) / 1000)
  }

  private releaseBow() {
    if (this.drawStart === null) return
    this.drawStart = null
    this.send({ t: 'release' })
    this.sound.play('bow')
  }

  select(slot: number) {
    if (!this.self) return
    this.cancelEat()
    this.releaseBow()
    this.self.selected = slot
    this.stopDig()
    this.send({ t: 'select', slot })
  }

  openNearestShop() {
    const npc = this.map?.npcs
      .filter((n) => n.kind !== 'dummy')
      .map((n) => ({ n, d: Math.hypot(n.x - this.me.x, n.z - this.me.z) }))
      .sort((a, b) => a.d - b.d)[0]
    if (npc && npc.d < 5) this.hud.openShop(npc.n.kind === 'upgrades' ? 'upgrades' : 'shop')
    else this.hud.toast('Walk up to a shopkeeper first.')
  }

  // Simulation ------------------------------------------------------------------

  get alive(): boolean {
    return !!this.self?.alive
  }

  /** Lets scripts and tests drive input without pointer lock (set from the console: game.automation = true). */
  automation = false

  private input(): MoveInput {
    const t = this.touchUi && this.touchPlaying ? this.touchInput : null
    if (this.uiOpen || !this.playing) return { ...IDLE_INPUT, yaw: this.me.yaw, pitch: this.me.pitch, sneak: this.me.sneaking && (this.down('sneak') || !!t?.sneak) }
    const k = (a: Action) => this.down(a)
    // The stick is analogue; keys push the same axis to its end.
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    const forward = clamp((k('forward') ? 1 : 0) - (k('back') ? 1 : 0) + (t?.forward ?? 0))
    const strafe = clamp((k('right') ? 1 : 0) - (k('left') ? 1 : 0) + (t?.strafe ?? 0))
    // The physics stops a sprint when you stop moving forward, sneak or hit a wall.
    const mode = this.settings.sprintMode
    if (forward <= 0 && mode === 'toggle') this.sprintLatched = false
    const sprint = mode === 'always' || this.sprintLatched || (mode === 'hold' && k('sprint')) || !!t?.sprint
    const held = this.heldDef()
    const effect = (e: 'speed' | 'jump' | 'invisible') => (this.self?.effects?.[e] ?? 0) > this.tick
    return {
      speedBoost: effect('speed') ? SPEED_BOOST : 1,
      eatSlow: this.using ? EAT_SLOWDOWN : 1,
      jumpBoost: effect('jump') ? JUMP_BOOST : 0,
      forward,
      strafe,
      jump: k('jump') || !!t?.jump,
      sneak: k('sneak') || !!t?.sneak,
      sprint,
      shield: this.rightDown && held?.kind === 'shield',
      // The sneak edge guard only holds you at the lip while you still have a
      // block to bridge with. Out of blocks, you walk off and fall, as you would
      // expect, instead of being stopped by an invisible barrier.
      yaw: this.me.yaw,
      pitch: this.me.pitch,
    }
  }

  heldDef() {
    if (!this.self) return undefined
    return item(this.self.inventory[this.self.selected]?.id)
  }

  private stepTick() {
    if (!this.world || !this.self) return
    if (!this.alive) {
      this.stepSpectator()
      return
    }
    this.prev = { x: this.me.x, y: this.me.y, z: this.me.z }
    const input = this.input()
    // Bridging places before the step, like Minecraft: the block is already in
    // the floor cell you are about to walk into, so you never step into the air.
    this.bridgeAhead()
    stepMovement(this.world, this.me, input)
    this.send({
      t: 'input',
      seq: ++this.inputSeq,
      x: this.me.x,
      y: this.me.y,
      z: this.me.z,
      vx: this.me.vx,
      vy: this.me.vy,
      vz: this.me.vz,
      yaw: this.me.yaw,
      pitch: this.me.pitch,
      sneak: this.me.sneaking,
      sprint: this.me.sprinting,
      shield: !!input.shield,
      tp: this.tp,
    })
    this.remoteBoxes = this.players.boxes(performance.now())
    this.updateTarget()
    for (const click of this.clickQueue.splice(0)) {
      if (click === 'attack') this.primary()
      else this.secondary()
    }
    this.continueActions()
  }

  private stepSpectator() {
    const k = (a: Action) => this.down(a)
    const t = this.touchUi && this.touchPlaying ? this.touchInput : null
    const speed = k('sprint') || t?.sprint ? 1.6 : 0.8
    const fwd = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0) + (t?.forward ?? 0)
    const side = (k('right') ? 1 : 0) - (k('left') ? 1 : 0) + (t?.strafe ?? 0)
    const up = (k('jump') ? 1 : 0) - (k('sneak') ? 1 : 0) + (t ? (t.jump ? 1 : 0) - (t.sneak ? 1 : 0) : 0)
    const [dx, dy, dz] = lookDirection(this.me.yaw, this.me.pitch)
    const rx = Math.cos(this.me.yaw)
    const rz = -Math.sin(this.me.yaw)
    this.spectator.x += (dx * fwd + rx * side) * speed
    this.spectator.y += (dy * fwd + up) * speed
    this.spectator.z += (dz * fwd + rz * side) * speed
    this.clickQueue.length = 0
  }

  private eyePos(): [number, number, number] {
    return [this.me.x, this.me.y + (this.me.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT), this.me.z]
  }

  private updateTarget() {
    if (!this.world || !this.map) return
    const eye = this.eyePos()
    const dir = lookDirection(this.me.yaw, this.me.pitch)
    const block = raycastBlock(this.world, eye, dir, BLOCK_REACH)
    // Players and shopkeepers are seen past flowers, poles and chains: only a solid block hides them.
    const wall = raycastBlock(this.world, eye, dir, BLOCK_REACH, true)
    let best: Target = block ? { kind: 'block', hit: block } : null
    let bestD = wall ? wall.distance : Infinity
    this.npcTarget = null
    for (const n of this.map.npcs) {
      if (n.kind === 'dummy') continue
      const hit = rayBox(eye, dir, playerBox(n.x, n.y, n.z, false), BLOCK_REACH)
      if (hit && hit.distance < bestD && (!this.npcTarget || hit.distance < this.npcTarget.distance)) this.npcTarget = { kind: 'npc', npc: n, distance: hit.distance }
    }
    if (this.npcTarget) {
      best = this.npcTarget
      bestD = this.npcTarget.distance
    }
    for (const p of this.remoteBoxes) {
      const hit = rayBox(eye, dir, playerBox(p.x, p.y, p.z, p.sneak), ATTACK_REACH)
      if (hit && hit.distance < bestD) {
        bestD = hit.distance
        best = { kind: 'player', id: p.id, distance: hit.distance }
      }
    }
    this.target = best
  }

  /** Counts input ticks, so the server knows how many ticks a late input covers. */
  private inputSeq = 0

  /** A shopkeeper on the line of sight, even with someone standing in front: right click talks to it. */
  private npcTarget: Extract<Target, { kind: 'npc' }> | null = null

  private primary() {
    const t = this.target
    this.viewModel.swingNow()
    // Remote players are drawn a few ticks in the past (the jitter buffer); say which tick, for lag compensation.
    if (t?.kind === 'player') {
      this.send({ t: 'attack', target: t.id, seen: Math.round(this.players.renderTick(performance.now())) })
      // Remember the swing so the next hurt update for this player shows as our hit (and a crit while falling).
      this.pendingHit = { id: t.id, at: performance.now(), crit: !this.me.onGround && this.me.vy < 0 }
    }
    else if (t?.kind === 'block') this.startDig(t.hit)
  }

  private secondary() {
    const t = this.target
    const held = this.heldDef()
    if (this.npcTarget) {
      this.hud.openShop(this.npcTarget.npc.kind === 'upgrades' ? 'upgrades' : 'shop')
      this.rightDown = false
      return
    }
    if (held?.kind === 'food' || held?.kind === 'potion') {
      // Both take time, and the server times them with us: the apple is only eaten,
      // and the potion only drunk, when the bite finishes (1.4 s, 1.6 s).
      if (this.using) return
      if (held.kind === 'food') this.eatUntil = performance.now() + EAT_MS
      else this.drinkUntil = performance.now() + DRINK_MS
      this.send({ t: 'use' })
      return
    }
    if (held?.kind === 'bow') {
      if (this.self && countItem(this.self.inventory, 'arrow') > 0) {
        this.drawStart = performance.now()
        this.send({ t: 'draw' })
      } else this.hud.toast('No arrows.')
      return
    }
    if (held?.kind === 'throwable') {
      this.send({ t: 'throw' })
      this.viewModel.swingNow()
      this.sound.play('throw')
      return
    }
    if (held?.kind === 'tnt' && t?.kind === 'block') {
      // Lit TNT is a server entity: no local prediction, it appears with the next update.
      this.send({ t: 'place', x: t.hit.x, y: t.hit.y, z: t.hit.z, face: t.hit.face, slot: this.self!.selected })
      this.viewModel.swingNow()
      return
    }
    if (held?.kind === 'block' && t?.kind === 'block') this.place(t.hit)
  }

  private continueActions() {
    if (this.placeCooldown > 0) this.placeCooldown--
    if (this.digCooldown > 0) this.digCooldown--
    // Eating and drinking are holds: letting go cancels whatever is in progress.
    if (!this.rightDown) this.cancelEat()
    // Holding right click keeps placing, at the rate of a quick clicker.
    // Holding the use button keeps eating apples and drinking potions, one after another.
    const holdUse = this.heldDef()?.kind === 'food' || this.heldDef()?.kind === 'potion'
    if (this.rightDown && !this.using && holdUse && this.placeCooldown === 0) this.secondary()
    // Aimed placement, for everything that is not a bridge: standing still, or
    // looking at a wall. While bridging, the block has already gone in ahead of
    // the step, so aiming does not also spend one on the face you look at.
    if (this.rightDown && this.placeCooldown === 0 && this.heldDef()?.kind === 'block' && !this.bridging() && this.target?.kind === 'block') this.place(this.target.hit)
    if (!this.leftDown || !this.world) return
    const t = this.target
    if (t?.kind !== 'block') {
      this.stopDig()
      return
    }
    const { x, y, z } = t.hit
    if (!this.dig || this.dig.x !== x || this.dig.y !== y || this.dig.z !== z) {
      if (this.digCooldown === 0) this.startDig(t.hit)
      return
    }
    const id = this.world.get(x, y, z)
    const ticks = breakTicks(id, this.heldDef())
    this.dig.progress = Math.min(1, this.dig.progress + (ticks === 0 ? 1 : 1 / ticks))
    if (this.tick % 4 === 0) this.viewModel.swingNow()
    if (id === AIR) {
      this.dig = null
      this.digCooldown = 5
    } else if (this.dig.progress >= 1) {
      // Break it now on our side, beds included; the server agrees or puts it back.
      this.world.set(x, y, z, AIR)
      this.particles.burst(x + 0.5, y + 0.5, z + 0.5, blockDef(id).texture.top, 14)
      this.sound.play('break')
      this.send({ t: 'dig', target: [x, y, z], done: true })
      this.dig = null
      this.digCooldown = 5
    }
  }

  private startDig(hit: BlockHit) {
    if (!this.world || !this.self) return
    if (checkBreak(this.world, this.map!.build, hit.x, hit.y, hit.z, this.mode.world === 'sandbox' ? 'red' : this.self.team)) return
    this.dig = { x: hit.x, y: hit.y, z: hit.z, progress: 0 }
    this.send({ t: 'dig', target: [hit.x, hit.y, hit.z] })
  }

  private stopDig() {
    if (this.dig) this.send({ t: 'dig', target: null })
    this.dig = null
  }

  /** A block stack in hand with at least one left: bridging still has something to lay. */
  private blocksInHand(): boolean {
    const s = this.self?.inventory[this.self.selected]
    return !!s && item(s.id)?.kind === 'block' && s.count > 0
  }

  /**
   * Bridging, as in Minecraft: a block in hand, the use button held and the
   * crosshair pointed down at the air in front of the edge. Stand a couple of
   * blocks back, hold the button, then walk or sprint forward and the floor goes
   * in under you. It never builds over the crosshair's face, so it cannot wall
   * you in, and it lays one block per floor cell instead of filling the gap ahead.
   */
  private bridging(): boolean {
    if (!this.rightDown || !this.blocksInHand()) return false
    const pitch = this.me.pitch
    return pitch <= -Math.PI / 5 && pitch >= (-85 * Math.PI) / 180
  }

  /** Lays the next bridging block before the step, into the cell you are entering. */
  private bridgeAhead() {
    if (!this.rightDown || this.placeCooldown > 0 || this.placedTick === this.tick) return
    if (!this.world || !this.bridging()) return
    // The level of the floor under your feet, kept while you are airborne so a
    // jump bridge stays level instead of climbing a step with every jump.
    if (this.me.onGround) this.bridgeY = Math.floor(this.me.y - 0.05)
    const level = this.bridgeY
    const speed = Math.hypot(this.me.vx, this.me.vz)
    let dx: number
    let dz: number
    if (speed > 0.01) {
      dx = this.me.vx / speed
      dz = this.me.vz / speed
    } else {
      // Held still, bridging goes the way you face.
      const [lx, , lz] = lookDirection(this.me.yaw, 0)
      const len = Math.hypot(lx, lz) || 1
      dx = lx / len
      dz = lz / len
    }
    // One axis at a time, the dominant one, so the block sits against the cell
    // you are standing on rather than diagonally off it.
    const alongX = Math.abs(dx) >= Math.abs(dz)
    const sx = alongX ? Math.sign(dx) : 0
    const sz = alongX ? 0 : Math.sign(dz)
    const to = bridgeCell(this.world, Math.floor(this.me.x), Math.floor(this.me.z), level, sx, sz)
    if (!to) return
    this.place({ x: to.against[0], y: to.against[1], z: to.against[2], face: to.face, distance: 0 })
  }

  private place(hit: BlockHit) {
    if (!this.world || !this.self || !this.map) return
    // A tick spends at most one block: the bridge goes first, and a click or a
    // held button in the same tick does not add a second one.
    if (this.placedTick === this.tick) return
    const slot = this.self.selected
    const s = this.self.inventory[slot]
    const def = item(s?.id)
    const team = this.self.team ?? 'red'
    const block = def ? placedBlock(def, team) : undefined
    if (block === undefined || !s || s.count <= 0) return
    const [x, y, z] = [hit.x + hit.face[0], hit.y + hit.face[1], hit.z + hit.face[2]]
    const bodies = [playerBox(this.me.x, this.me.y, this.me.z, this.me.sneaking), ...this.remoteBoxes.map((p) => playerBox(p.x, p.y, p.z, p.sneak))]
    if (checkPlace(this.world, this.map.build, x, y, z, bodies)) return
    // Predict the block so bridging feels immediate; the server confirms or corrects it.
    this.world.set(x, y, z, block, true)
    this.sound.play('place', 0.7)
    s.count--
    // Bridging lays a block every couple of ticks: at walk or sprint pace a
    // quarter-second wait left gaps wide enough to fall through.
    this.placeCooldown = this.bridging() ? 1 : 4
    this.placedTick = this.tick
    this.viewModel.swingNow()
    this.send({ t: 'place', x: hit.x, y: hit.y, z: hit.z, face: hit.face, slot })
  }

  // Rendering -------------------------------------------------------------------

  private resize = () => {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private frame = (now: number) => {
    if (!this.running) return
    requestAnimationFrame(this.frame)
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05
    this.accumulator += dt * 1000
    let steps = 0
    while (this.accumulator >= TICK_MS && steps++ < 4) {
      this.stepTick()
      this.accumulator -= TICK_MS
    }
    if (this.accumulator > TICK_MS * 4) this.accumulator = 0
    const alpha = this.accumulator / TICK_MS

    this.players.frame(now, dt, this.tick, this.self?.team ?? null)
    this.dropModels.frame(now / 1000)
    this.particles.frame(dt)
    this.gens.frame(now / 1000)
    this.projectiles.frame(now)
    this.damageText.frame(dt)
    const v = this.gameView
    const second = v?.phase === 'countdown' ? Math.ceil(this.clock() / TPS) : 0
    if (second !== this.lastCountdown && second > 0 && second <= 5) this.sound.play('tick')
    this.lastCountdown = second
    const seconds = now / 1000

    if (this.alive) {
      const x = this.prev.x + (this.me.x - this.prev.x) * alpha
      const y = this.prev.y + (this.me.y - this.prev.y) * alpha
      const z = this.prev.z + (this.me.z - this.prev.z) * alpha
      const wantEye = this.me.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT
      this.eye += (wantEye - this.eye) * Math.min(1, dt * 14)
      this.camera.position.set(x, y + this.eye, z)
      this.poseSelf(x, y, z, dt)
    } else this.camera.position.set(this.spectator.x, this.spectator.y, this.spectator.z)
    this.selfAvatar.root.visible = this.alive && this.thirdPerson
    this.camera.rotation.set(this.me.pitch, this.me.yaw, this.hurtRoll)
    this.hurtRoll *= Math.pow(0.002, dt)
    // A nearby explosion shakes the view for a moment.
    if (this.shake > 0.01) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.05
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.05
      this.shake *= Math.pow(0.02, dt)
    }
    const fov = this.settings.fov * (this.me.sprinting && this.alive ? 1.1 : 1) * (1 - this.drawCharge() * 0.12)
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10)
      this.camera.updateProjectionMatrix()
    }
    // Third person behind: pull the camera back behind you, stopping short of any
    // block in the way. Third person in front: stand the camera in front of you and
    // look back, so you see your own face, with the same block check ahead.
    if (this.alive && this.thirdPerson && this.world) {
      const [dx, dy, dz] = lookDirection(this.me.yaw, this.me.pitch)
      const eye = [this.camera.position.x, this.camera.position.y, this.camera.position.z]
      const ahead = this.viewMode === 2
      const hit = raycastBlock(this.world, eye, ahead ? [dx, dy, dz] : [-dx, -dy, -dz], 4)
      const distance = hit ? Math.max(0.3, hit.distance - 0.3) : 4
      const sign = ahead ? 1 : -1
      this.camera.position.set(eye[0] + dx * distance * sign, eye[1] + dy * distance * sign, eye[2] + dz * distance * sign)
      if (ahead) this.camera.rotation.set(-this.me.pitch, this.me.yaw + Math.PI, -this.hurtRoll)
    }

    if (this.chunks) this.chunks.update(this.camera.position.x, this.camera.position.y, this.camera.position.z)
    this.sky?.update(this.camera.position.x, this.camera.position.y, this.camera.position.z, seconds)

    const t = this.target
    if (this.alive && t?.kind === 'block' && this.world) {
      const h = blockDef(this.world.get(t.hit.x, t.hit.y, t.hit.z)).height
      const p = this.dig && this.dig.x === t.hit.x && this.dig.y === t.hit.y && this.dig.z === t.hit.z ? this.dig.progress : 0
      this.cursor.set([t.hit.x, t.hit.y, t.hit.z], h, p)
    } else this.cursor.set(null, 1, 0)

    const held = this.self?.inventory[this.self.selected]?.id ?? null
    this.viewModel.setHeld(held, this.self?.team ?? null)
    const walking = this.alive && this.me.onGround && this.settings.viewBobbing ? Math.min(1, Math.hypot(this.me.vx, this.me.vz) / 0.2) : 0
    this.viewModel.frame(dt, walking, this.rightDown && this.heldDef()?.kind === 'shield', this.eating, this.camera.aspect, this.drawCharge(), this.drinking)

    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.alive && !this.thirdPerson) {
      this.renderer.clearDepth()
      this.renderer.render(this.viewModel.scene, this.viewModel.camera)
    }
    this.touchUi?.update()
    this.hud.frame(now)
  }

  /** Your look, from the wardrobe; sent on joining and whenever it changes. */
  look: Look = loadLook()

  setLook(look: Look) {
    this.look = look
    this.send({ t: 'look', look: encodeLook(look) })
  }

  /** Poses your own figure for the third-person view, and lays your trail. */
  private poseSelf(x: number, y: number, z: number, dt: number) {
    const a = this.selfAvatar
    a.dress(this.look, this.self?.team ?? null, this.self?.armor ?? 'leather')
    a.setHeld(this.self?.inventory[this.self.selected]?.id ?? null, this.self?.team ?? null)
    a.root.position.set(x, y, z)
    a.root.rotation.y = this.me.yaw
    a.setGround(this.groundBelow(x, y, z))
    this.viewModel.setSkin(a.skin)
    const speed = Math.hypot(this.me.vx, this.me.vz) * 20
    a.animate(dt, { sneak: this.me.sneaking, shield: this.rightDown && this.heldDef()?.kind === 'shield', pitch: this.me.pitch, swing: this.viewModel.swingTicks(), hurt: 20, speed, vy: this.me.vy })
    if (this.look.trail > 0 && speed > 1) {
      this.selfTrailClock += dt
      if (this.selfTrailClock > 0.07) {
        this.selfTrailClock = 0
        this.trail(x, y + 0.1, z, this.look.trail)
      }
    }
  }

  /** How far below (x, y, z) the nearest solid surface is, within six blocks. */
  private groundBelow(x: number, y: number, z: number): number | null {
    if (!this.world) return null
    const bx = Math.floor(x)
    const bz = Math.floor(z)
    for (let by = Math.floor(y + 0.01); by >= Math.floor(y) - 6; by--) {
      const def = blockDef(this.world.get(bx, by, bz))
      if (def.solid && by + def.height <= y + 0.01) return y - (by + def.height)
    }
    return null
  }

  /** One puff of a cosmetic trail at someone's feet. */
  private trail(x: number, y: number, z: number, trail: number) {
    const p = this.particles
    switch (TRAILS[trail]) {
      case 'Sparkle':
        return p.burst(x, y + 0.3, z, Math.random() < 0.5 ? '#fff6a0' : '#ffffff', 2, 0.5, 1, -0.5, 0.6)
      case 'Flame':
        return p.burst(x, y, z, Math.random() < 0.5 ? '#ff8a1a' : '#ffd24a', 2, 0.4, 0.6, -3, 0.8)
      case 'Hearts':
        return p.burst(x, y + 0.4, z, '#ff4a6a', 1, 0.4, 0.8, -1.5, 1.2)
      case 'Notes':
        return p.burst(x, y + 0.5, z, `hsl(${Math.floor(Math.random() * 360)},80%,60%)`, 1, 0.4, 0.8, -1.5, 1)
      case 'Cloud':
        return p.burst(x, y + 0.1, z, '#f4f4f4', 2, 0.5, 0.4, -0.3, 1.8)
    }
  }

  /** A killer's kill effect where their victim fell. */
  private killEffect(effect: number, x: number, y: number, z: number) {
    const d = Math.hypot(x - this.me.x, y - this.me.y, z - this.me.z)
    switch (KILL_EFFECTS[effect]) {
      case 'Burst':
        for (const c of ['#ff4a4a', '#ffd24a', '#4ad8ff']) this.particles.burst(x, y + 1, z, c, 16, 0.6, 6, 6)
        this.sound.play('kill', falloff(d, 40) * 0.6)
        break
      case 'Lightning':
        this.lightning(x, y, z)
        this.sound.play('explode', falloff(d, 64) * 0.7, 1.8)
        break
      case 'Confetti':
        for (let i = 0; i < 6; i++) this.particles.burst(x, y + 2.2, z, `hsl(${i * 60},85%,60%)`, 12, 1.2, 5, 4, 0.8)
        this.sound.play('start', falloff(d, 40) * 0.6)
        break
    }
  }

  /** A bright bolt from the sky for a quarter of a second. */
  private lightning(x: number, y: number, z: number) {
    const bolt = new Mesh(new BoxGeometry(0.25, 40, 0.25), new MeshBasicMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.9 }))
    bolt.position.set(x, y + 20, z)
    this.scene.add(bolt)
    this.particles.burst(x, y + 0.2, z, '#eaf4ff', 24, 0.8, 5, 8)
    setTimeout(() => {
      this.scene.remove(bolt)
      bolt.geometry.dispose()
    }, 250)
  }

  /** The latest server tick heard. */
  tickNow(): number {
    return this.tick
  }

  /** The game clock now: the server's value moved on by the ticks since it was sent. */
  clock(): number {
    const v = this.gameView
    if (!v) return 0
    const since = Math.max(0, this.tick - v.clockTick)
    return v.phase === 'countdown' || v.phase === 'mapvote' ? Math.max(0, v.clock - since) : v.clock + since
  }

  /** For the debug overlay. */
  debugInfo() {
    const t = this.target
    return {
      pos: [this.me.x, this.me.y, this.me.z],
      vel: [this.me.vx, this.me.vy, this.me.vz],
      onGround: this.me.onGround,
      sneaking: this.me.sneaking,
      sprinting: this.me.sprinting,
      fall: this.me.fallDistance,
      yaw: this.me.yaw,
      pitch: this.me.pitch,
      tick: this.tick,
      target: t?.kind === 'block' ? `${blockDef(this.world!.get(t.hit.x, t.hit.y, t.hit.z)).name} at ${t.hit.x} ${t.hit.y} ${t.hit.z} (${t.hit.distance.toFixed(2)})${this.world!.isPlaced(t.hit.x, t.hit.y, t.hit.z) ? ' placed' : ''}` : t?.kind === 'player' ? `player ${t.id}` : t?.kind === 'npc' ? t.npc.kind : 'none',
      light: this.chunks ? this.chunks.light.get(Math.floor(this.me.x), Math.floor(this.me.y), Math.floor(this.me.z)) : 0,
      dig: this.dig ? this.dig.progress : 0,
      fps: Math.round(this.fps),
    }
  }
}

/** A golden apple takes 1.4 seconds to eat, the same as the server's EAT_TICKS.
 * A hair longer than the server's bite, so the next one is never sent while the
 * server still thinks the previous bite is running. */
const EAT_MS = 1450
/** A potion takes 1.6 seconds to drink, the same as the server's DRINK_TICKS. */
const DRINK_MS = 1650
