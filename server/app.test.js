import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createApp } from './app.js'

const PIN = '4321'

describe('PIN protection', () => {
  let server
  let baseUrl

  before(async () => {
    const { app } = createApp({ appPin: PIN })
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  after(() => {
    server.close()
  })

  it('allows health checks without a PIN', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    assert.equal(response.status, 200)
  })

  it('rejects API requests without a PIN', async () => {
    const response = await fetch(`${baseUrl}/api/rooms`, { method: 'POST' })
    assert.equal(response.status, 401)
  })

  it('rejects API requests with a wrong PIN', async () => {
    const response = await fetch(`${baseUrl}/api/pin/verify`, {
      method: 'POST',
      headers: { 'X-App-Pin': '0000' },
    })
    assert.equal(response.status, 401)
  })

  it('accepts the PIN via header', async () => {
    const response = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'X-App-Pin': PIN },
    })
    assert.equal(response.status, 201)
  })

  it('accepts the PIN via JSON body for sendBeacon requests', async () => {
    const created = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'X-App-Pin': PIN },
    }).then((res) => res.json())

    const response = await fetch(
      `${baseUrl}/api/rooms/${created.roomId}/leave`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'someone', pin: PIN }),
      },
    )
    assert.equal(response.status, 200)
  })

  it('verifies the PIN on /api/pin/verify', async () => {
    const response = await fetch(`${baseUrl}/api/pin/verify`, {
      method: 'POST',
      headers: { 'X-App-Pin': PIN },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  })

  it('rate-limits repeated wrong PINs', async () => {
    const { app } = createApp({ appPin: PIN })
    const limitedServer = app.listen(0)
    await new Promise((resolve) => limitedServer.once('listening', resolve))
    const limitedUrl = `http://127.0.0.1:${limitedServer.address().port}`

    try {
      let lastStatus = 0
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await fetch(`${limitedUrl}/api/pin/verify`, {
          method: 'POST',
          headers: { 'X-App-Pin': '9999' },
        })
        lastStatus = response.status
      }
      assert.equal(lastStatus, 429)

      // Even the correct PIN is blocked while rate-limited.
      const blocked = await fetch(`${limitedUrl}/api/pin/verify`, {
        method: 'POST',
        headers: { 'X-App-Pin': PIN },
      })
      assert.equal(blocked.status, 429)
    } finally {
      limitedServer.close()
    }
  })

  it('skips enforcement when no PIN is configured', async () => {
    const { app } = createApp({ appPin: undefined })
    const openServer = app.listen(0)
    await new Promise((resolve) => openServer.once('listening', resolve))
    const openUrl = `http://127.0.0.1:${openServer.address().port}`

    try {
      const response = await fetch(`${openUrl}/api/rooms`, { method: 'POST' })
      assert.equal(response.status, 201)
    } finally {
      openServer.close()
    }
  })
})
