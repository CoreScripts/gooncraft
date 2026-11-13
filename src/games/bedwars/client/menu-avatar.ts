import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import type { Look } from '../look'
import { Avatar } from './avatar'
import { loadLook } from './wardrobe'

export interface MenuAvatar {
  setLook(look: Look): void
  dispose(): void
}

/**
 * The figure beside the start menu: it turns slowly, it can be spun with a drag, and a tap
 * on it opens the wardrobe. Returns null when the browser has no WebGL to draw it with.
 */
export function mountMenuAvatar(host: HTMLElement, onEdit: () => void): MenuAvatar | null {
  let look = loadLook()
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  // The stylesheet sizes the canvas, so the buffer size alone changes here.
  renderer.setSize(240, 320, false)
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.5))
  const sun = new DirectionalLight(0xffffff, 1.7)
  sun.position.set(1, 2, -2)
  scene.add(sun)
  const camera = new PerspectiveCamera(34, 240 / 320, 0.1, 50)
  camera.position.set(0, 1.05, -4.4)
  camera.lookAt(0, 0.92, 0)
  const avatar = new Avatar()
  scene.add(avatar.root)
  avatar.dress(look, null, 'leather')
  host.append(renderer.domElement)

  const canvas = renderer.domElement
  canvas.classList.add('menu-avatar-canvas')
  let angle = Math.PI + 0.45
  let dragging = false
  let moved = 0
  let lastX = 0
  let running = true
  let t = 0

  canvas.onpointerdown = (e) => {
    dragging = true
    moved = 0
    lastX = e.clientX
    canvas.setPointerCapture(e.pointerId)
  }
  canvas.onpointermove = (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    moved += Math.abs(dx)
    angle += dx * 0.012
    lastX = e.clientX
  }
  // A press that never really moved is a tap: that opens the wardrobe.
  canvas.onpointerup = () => {
    if (!dragging) return
    dragging = false
    if (moved < 6) onEdit()
  }
  canvas.onpointercancel = () => {
    dragging = false
  }

  const dispose = () => {
    if (!running) return
    running = false
    avatar.dispose()
    renderer.dispose()
  }

  const frame = () => {
    if (!running) return
    // Leaving the menu replaces the whole screen; stop drawing when the canvas goes with it.
    if (!canvas.isConnected) return dispose()
    requestAnimationFrame(frame)
    if (!dragging) angle += 0.005
    t += 1 / 60
    avatar.root.rotation.y = angle
    // A gentle walk, so capes and trails read while standing still.
    avatar.animate(1 / 60, { sneak: false, swing: 20, hurt: 20, shield: false, pitch: 0, speed: 2.2 + Math.sin(t) * 1.2, vy: 0 })
    renderer.render(scene, camera)
  }
  requestAnimationFrame(frame)

  return {
    setLook(next) {
      look = next
      avatar.dress(look, null, 'leather')
    },
    dispose,
  }
}
