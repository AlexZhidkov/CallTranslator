import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import {
  DEFAULT_LANGUAGE_CODE,
  getSupportedLanguageByCode,
} from '../shared/supported-languages.js'
import { BridgeManager } from './bridge-manager.js'
import { getGeminiConfig, getLiveKitConfig } from './config.js'
import {
  CONVERSATION_MODE_FLOOR,
  CONVERSATION_MODE_FREE_FLOW,
  RoomStore,
} from './room-store.js'
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

function requireSupportedLanguage(languageCode) {
  const language = getSupportedLanguageByCode(
    languageCode || DEFAULT_LANGUAGE_CODE,
  )

  if (!language) {
    const error = new Error('Invalid language')
    error.statusCode = 400
    throw error
  }

  return language
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
  let activeBridgeManager = bridgeManager

  app.set('trust proxy', true)
  app.use(express.json({ limit: '1mb' }))

  function ensureBridgeManager() {
    if (!activeBridgeManager) {
      activeBridgeManager = new BridgeManager({
        livekitConfig: getLiveKitConfig(),
        geminiConfig: getGeminiConfig(),
      })
    }

    return activeBridgeManager
  }

  function getBridgeStatuses(roomId) {
    return activeBridgeManager?.getStatuses(roomId)
  }

  function toPublicRoom(room) {
    return roomStore.toPublicRoom(room, getBridgeStatuses(room.roomId))
  }

  async function syncFreeFlowBridges(room) {
    if (
      (room.conversationMode || CONVERSATION_MODE_FLOOR) !==
      CONVERSATION_MODE_FREE_FLOW
    ) {
      return
    }

    const routes = roomStore.getFreeFlowRoutes(room.roomId)
    if (!routes.length && !activeBridgeManager) return

    await ensureBridgeManager().syncFreeFlow({
      roomId: room.roomId,
      routes,
    })
  }

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
      room: toPublicRoom(room),
    })
  })

  app.post(
    '/api/rooms/:roomId/token',
    asyncRoute(async (req, res) => {
      const { languageCode } = req.body || {}
      const room = roomStore.requireRoom(req.params.roomId)
      const language = requireSupportedLanguage(languageCode)
      const config = livekitConfig || getLiveKitConfig()
      const token = await createParticipantToken({
        roomId: room.roomId,
        livekitConfig: config,
      })

      const participant = roomStore.addParticipant(room.roomId, {
        identity: token.identity,
        languageCode: language.code,
      })

      await syncFreeFlowBridges(room)

      res.json({
        ...token,
        participant,
        room: toPublicRoom(room),
      })
    }),
  )

  app.post(
    '/api/rooms/:roomId/mode',
    asyncRoute(async (req, res) => {
      const { conversationMode } = req.body || {}
      const result = roomStore.setConversationMode(
        req.params.roomId,
        conversationMode,
      )
      const room = result.room

      if (result.endedFloor) {
        activeBridgeManager?.endTurn({
          roomId: room.roomId,
          targetLanguages: result.endedFloor.targetLanguages,
        })
      }

      if (result.conversationMode === CONVERSATION_MODE_FREE_FLOW) {
        await activeBridgeManager?.stopFloor(room.roomId)
        await syncFreeFlowBridges(room)
      } else {
        await activeBridgeManager?.stopFreeFlow(room.roomId)
      }

      res.json({
        conversationMode: room.conversationMode,
        room: toPublicRoom(room),
      })
    }),
  )

  app.post(
    '/api/rooms/:roomId/turn/start',
    asyncRoute(async (req, res) => {
      const { identity } = req.body || {}
      if (!identity) {
        res.status(400).json({ error: 'Missing identity' })
        return
      }

      const result = roomStore.startTurn(req.params.roomId, { identity })
      const room = roomStore.requireRoom(req.params.roomId)

      if (!result.granted) {
        res.status(409).json({
          granted: false,
          floor: result.floor,
          room: toPublicRoom(room),
        })
        return
      }

      if (result.floor.targetLanguages.length) {
        await ensureBridgeManager().startTurn({
          roomId: room.roomId,
          sourceIdentity: identity,
          sourceLanguage: result.floor.sourceLanguage,
          targetLanguages: result.floor.targetLanguages,
        })
      }

      res.json({
        granted: true,
        floor: result.floor,
        room: toPublicRoom(room),
      })
    }),
  )

  app.post('/api/rooms/:roomId/turn/end', (req, res) => {
    const { turnId, identity } = req.body || {}
    const result = roomStore.endTurn(req.params.roomId, { turnId, identity })
    const room = roomStore.requireRoom(req.params.roomId)

    if (result.ended) {
      activeBridgeManager?.endTurn({
        roomId: room.roomId,
        targetLanguages: result.floor.targetLanguages,
      })
    }

    res.status(result.ended ? 200 : 409).json({
      ...result,
      room: toPublicRoom(room),
    })
  })

  app.post('/api/rooms/:roomId/leave', asyncRoute(async (req, res) => {
    const { identity } = req.body || {}
    const existingRoom = roomStore.getRoom(req.params.roomId)
    const endedFloor =
      existingRoom?.floor?.identity === identity ? existingRoom.floor : null

    if (identity) {
      roomStore.removeParticipant(req.params.roomId, identity)
    }

    if (endedFloor) {
      activeBridgeManager?.endTurn({
        roomId: req.params.roomId,
        targetLanguages: endedFloor.targetLanguages,
      })
    }

    const room = roomStore.getRoom(req.params.roomId)
    if (room?.conversationMode === CONVERSATION_MODE_FREE_FLOW) {
      await syncFreeFlowBridges(room)
    }

    res.json({
      ok: true,
      room: room ? toPublicRoom(room) : null,
    })
  }))

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
