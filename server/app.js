import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import { BridgeManager } from './bridge-manager.js'
import { getGeminiConfig, getLiveKitConfig } from './config.js'
import { RoomStore, SIDES } from './room-store.js'
import { createParticipantToken } from './token-service.js'

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

function getOrigin(req) {
  return `${req.protocol}://${req.get('host')}`
}

function pinMatches(provided, expected) {
  if (typeof provided !== 'string' || !provided) return false
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

const PIN_FAILURE_WINDOW_MS = 5 * 60_000
const PIN_MAX_FAILURES = 10

export function createApp({
  roomStore = new RoomStore(),
  bridgeManager,
  livekitConfig,
  appPin = process.env.APP_PIN,
} = {}) {
  const app = express()

  app.set('trust proxy', true)
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  const pinFailures = new Map()

  app.use('/api', (req, res, next) => {
    if (!appPin) {
      next()
      return
    }

    const now = Date.now()
    const failures = pinFailures.get(req.ip)
    if (failures && now - failures.firstAt > PIN_FAILURE_WINDOW_MS) {
      pinFailures.delete(req.ip)
    } else if (failures && failures.count >= PIN_MAX_FAILURES) {
      res.status(429).json({
        error:
          'Too many incorrect PIN attempts. Try again later. / Слишком много неверных попыток. Попробуйте позже.',
      })
      return
    }

    // sendBeacon cannot set headers, so the PIN may arrive in the body.
    const provided = req.get('x-app-pin') || req.body?.pin
    if (pinMatches(provided, appPin)) {
      next()
      return
    }

    if (pinFailures.size > 10_000) {
      pinFailures.clear()
    }
    const record = pinFailures.get(req.ip) || { count: 0, firstAt: now }
    record.count += 1
    pinFailures.set(req.ip, record)
    res.status(401).json({ error: 'PIN required / Требуется ПИН-код' })
  })

  app.post('/api/pin/verify', (req, res) => {
    res.json({ ok: true })
  })

  app.post('/api/rooms', (req, res) => {
    const room = roomStore.createRoom()
    res.status(201).json({
      roomId: room.roomId,
      joinUrl: `${getOrigin(req)}/?room=${room.roomId}`,
      room: roomStore.toPublicRoom(room),
    })
  })

  app.get('/api/rooms/:roomId', (req, res) => {
    const room = roomStore.requireRoom(req.params.roomId)
    res.json({
      room: roomStore.toPublicRoom(
        room,
        bridgeManager?.getStatuses(req.params.roomId),
      ),
    })
  })

  app.post(
    '/api/rooms/:roomId/token',
    asyncRoute(async (req, res) => {
      const { side, displayName } = req.body || {}
      const room = roomStore.requireRoom(req.params.roomId)
      const config = livekitConfig || getLiveKitConfig()
      const token = await createParticipantToken({
        roomId: room.roomId,
        side,
        displayName,
        livekitConfig: config,
      })

      const participant = roomStore.addParticipant(room.roomId, {
        side,
        identity: token.identity,
        displayName,
      })

      res.json({
        ...token,
        participant,
        room: roomStore.toPublicRoom(room),
      })
    }),
  )

  app.post(
    '/api/rooms/:roomId/turn/start',
    asyncRoute(async (req, res) => {
      const { side, identity } = req.body || {}
      if (!identity) {
        res.status(400).json({ error: 'Missing identity' })
        return
      }

      const result = roomStore.startTurn(req.params.roomId, { side, identity })
      const room = roomStore.requireRoom(req.params.roomId)

      if (!result.granted) {
        res.status(409).json({
          granted: false,
          floor: result.floor,
          room: roomStore.toPublicRoom(
            room,
            bridgeManager?.getStatuses(req.params.roomId),
          ),
        })
        return
      }

      const manager =
        bridgeManager ||
        new BridgeManager({
          livekitConfig: getLiveKitConfig(),
          geminiConfig: getGeminiConfig(),
        })

      await manager.startTurn({
        roomId: room.roomId,
        sourceIdentity: identity,
        targetLanguage: SIDES[side].targetLanguage,
      })

      res.json({
        granted: true,
        floor: result.floor,
        room: roomStore.toPublicRoom(room, manager.getStatuses(room.roomId)),
      })
    }),
  )

  app.post('/api/rooms/:roomId/turn/end', (req, res) => {
    const { turnId, identity } = req.body || {}
    const result = roomStore.endTurn(req.params.roomId, { turnId, identity })
    const room = roomStore.requireRoom(req.params.roomId)

    if (result.ended) {
      bridgeManager?.endTurn({
        roomId: room.roomId,
        targetLanguage: result.floor.targetLanguage,
      })
    }

    res.status(result.ended ? 200 : 409).json({
      ...result,
      room: roomStore.toPublicRoom(
        room,
        bridgeManager?.getStatuses(req.params.roomId),
      ),
    })
  })

  app.post('/api/rooms/:roomId/leave', (req, res) => {
    const { identity } = req.body || {}
    if (identity) {
      roomStore.removeParticipant(req.params.roomId, identity)
    }

    const room = roomStore.getRoom(req.params.roomId)
    res.json({
      ok: true,
      room: room
        ? roomStore.toPublicRoom(
            room,
            bridgeManager?.getStatuses(req.params.roomId),
          )
        : null,
    })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }

    const statusCode = error.statusCode || 500
    if (statusCode >= 500) {
      console.error(error)
    }

    res.status(statusCode).json({
      error: error.message || 'Server error',
    })
  })

  return {
    app,
    roomStore,
  }
}
