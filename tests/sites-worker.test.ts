import { expect, test } from 'bun:test'
import worker, { ticket, type Env } from '../src/sites/worker'

const origin = 'https://game.example'
function request(body: unknown = { room: 'bedwars:arena:test:normal' }, from = origin, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: from }
  if (cookie) headers.Cookie = cookie
  return new Request(origin + '/api/realtime/ticket', { method: 'POST', headers, body: JSON.stringify(body) })
}
function setup() {
  const calls: { room: string; userId: string; origin: string; publish: boolean; presence: boolean }[] = []
  const env: Env = {
    APP_ORIGIN: origin,
    ASSETS: { fetch: async () => new Response('assets') },
    REALTIME: { idFromName: (name) => name, get: () => ({ fetch: async (req) => {
      calls.push(await req.json())
      return Response.json({ websocketUrl: 'wss://game.example/.well-known/freebuff/realtime?ticket=ephemeral' })
    } }) },
  }
  return { env, calls }
}
const guestOf = (cookie: string | null) => cookie?.match(/gooncraft_guest=([a-f0-9]{32})/)?.[1]
test('ticket derives identity, origin and permissions on the server', async () => {
  const { env, calls } = setup()
  const response = await ticket(request({ room: 'bedwars:arena:test:normal', userId: 'forged', origin: 'https://elsewhere.example', publish: false }), env, 'signed-in-user')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(calls).toEqual([{ room: 'bedwars:arena:test:normal', userId: 'signed-in-user', origin, publish: true, presence: true }])
  expect(response.headers.get('set-cookie')).toBeNull()
})
test('a signed-out browser plays as a guest with a stable cookie id', async () => {
  const { env, calls } = setup()
  const first = await ticket(request(), env, null)
  expect(first.status).toBe(200)
  const cookie = first.headers.get('set-cookie')
  const id = guestOf(cookie)
  expect(id).toMatch(/^[a-f0-9]{32}$/)
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(calls[0].userId).toBe(`guest:${id}`)
  // The reconnect that renews a ticket reuses the same identity.
  const again = await ticket(request(), env, null)
  const reusing = await ticket(request(undefined, origin, `gooncraft_guest=${id}`), env, null)
  expect(reusing.status).toBe(200)
  expect(reusing.headers.get('set-cookie')).toBeNull()
  expect(calls[2].userId).toBe(`guest:${id}`)
  expect(guestOf(again.headers.get('set-cookie'))).not.toBe(id)
})
test('cross-origin, oversized and invalid room requests do not mint tickets', async () => {
  const { env, calls } = setup()
  expect((await ticket(request({}, 'https://elsewhere.example'), env, 'user')).status).toBe(403)
  expect((await ticket(request({ room: '../another-room' }), env, 'user')).status).toBe(400)
  expect((await ticket(request({ room: 'x'.repeat(1000) }), env, 'user')).status).toBe(413)
  expect(calls).toEqual([])
})
test('deployed worker serves guests online and never enables the local socket proxy', async () => {
  const { env, calls } = setup()
  expect((await worker.fetch(request(), env)).status).toBe(200)
  expect(calls.length).toBe(1)
  expect((await worker.fetch(new Request(origin + '/.well-known/freebuff/realtime', { headers: { Upgrade: 'websocket' } }), env)).status).toBe(404)
  expect(await (await worker.fetch(new Request(origin), env)).text()).toBe('assets')
})
test('missing canonical origin or realtime binding produces an actionable setup error', async () => {
  const { env } = setup()
  expect((await ticket(request(), { ...env, APP_ORIGIN: undefined }, null)).status).toBe(503)
  expect((await ticket(request(), { ...env, REALTIME: undefined }, null)).status).toBe(503)
})
