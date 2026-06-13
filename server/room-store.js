import { randomBytes } from 'node:crypto'
import {
  DEFAULT_LANGUAGE_CODE,
  getSupportedLanguageByCode,
} from '../shared/supported-languages.js'

const CONVERSATION_SIDE_COUNT = 2
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000
export const CONVERSATION_MODE_FLOOR = 'floor'
export const CONVERSATION_MODE_FREE_FLOW = 'freeFlow'
export const CONVERSATION_MODES = [
  CONVERSATION_MODE_FLOOR,
  CONVERSATION_MODE_FREE_FLOW,
]

export function createId(byteLength = 12) {
  return randomBytes(byteLength).toString('base64url')
}

function requireSupportedParticipantLanguage(languageCode) {
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

function createError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function requireConversationMode(conversationMode) {
  if (CONVERSATION_MODES.includes(conversationMode)) {
    return conversationMode
  }

  throw createError('Invalid conversation mode', 400)
}

function getNextParticipantSideIndex(room) {
  const sideCounts = Array(CONVERSATION_SIDE_COUNT).fill(0)

  for (const participant of room.participants.values()) {
    sideCounts[participant.sideIndex] += 1
  }

  let selectedSideIndex = 0
  for (let sideIndex = 1; sideIndex < CONVERSATION_SIDE_COUNT; sideIndex += 1) {
    if (sideCounts[sideIndex] < sideCounts[selectedSideIndex]) {
      selectedSideIndex = sideIndex
    }
  }

  return selectedSideIndex
}

function getTargetLanguagesForSide(room, speakingSideIndex) {
  const targetLanguages = new Set()

  for (const participant of room.participants.values()) {
    if (participant.sideIndex === speakingSideIndex) continue

    targetLanguages.add(participant.languageCode)
  }

  return Array.from(targetLanguages)
}

function getTargetLanguagesForParticipant(room, participant) {
  return getTargetLanguagesForSide(room, participant.sideIndex)
}

function createParticipant(identity, sideIndex, languageCode) {
  const language = requireSupportedParticipantLanguage(languageCode)
  const timestamp = new Date().toISOString()

  return {
    identity,
    sideIndex,
    languageCode: language.code,
    languageName: language.name,
    joinedAt: timestamp,
    lastSeenAt: timestamp,
  }
}

function toPublicParticipant(participant) {
  const publicParticipant = { ...participant }
  delete publicParticipant.sideIndex
  return publicParticipant
}

function serializeParticipants(room) {
  return Array.from(room.participants.values(), toPublicParticipant)
}

export class RoomStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.now = now
    this.rooms = new Map()
  }

  createRoom() {
    let roomId = createId()
    while (this.rooms.has(roomId)) {
      roomId = createId()
    }

    const timestamp = this.now()
    const room = {
      roomId,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      expiresAt: new Date(timestamp + this.ttlMs).toISOString(),
      participants: new Map(),
      conversationMode: CONVERSATION_MODE_FLOOR,
      floor: null,
    }

    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return null

    if (Date.parse(room.expiresAt) <= this.now()) {
      this.rooms.delete(roomId)
      return null
    }

    return room
  }

  requireRoom(roomId) {
    const room = this.getRoom(roomId)
    if (!room) {
      const error = new Error('Room not found')
      error.statusCode = 404
      throw error
    }
    return room
  }

  touch(room) {
    const timestamp = this.now()
    room.updatedAt = new Date(timestamp).toISOString()
    room.expiresAt = new Date(timestamp + this.ttlMs).toISOString()
  }

  addParticipant(roomId, { identity, languageCode }) {
    if (!identity) {
      throw createError('Missing identity', 400)
    }

    const room = this.requireRoom(roomId)
    const language = requireSupportedParticipantLanguage(languageCode)
    const existing = room.participants.get(identity)
    if (existing) {
      existing.lastSeenAt = new Date(this.now()).toISOString()
      existing.languageCode = language.code
      existing.languageName = language.name
      this.touch(room)
      return toPublicParticipant(existing)
    }

    const participant = createParticipant(
      identity,
      getNextParticipantSideIndex(room),
      language.code,
    )
    room.participants.set(identity, participant)
    this.touch(room)
    return toPublicParticipant(participant)
  }

  setConversationMode(roomId, conversationMode) {
    const mode = requireConversationMode(conversationMode)
    const room = this.requireRoom(roomId)
    const previousMode = room.conversationMode || CONVERSATION_MODE_FLOOR
    const endedFloor = room.floor

    if (previousMode === mode) {
      return {
        room,
        previousMode,
        conversationMode: mode,
        endedFloor: null,
      }
    }

    room.conversationMode = mode
    room.floor = null
    this.touch(room)

    return {
      room,
      previousMode,
      conversationMode: mode,
      endedFloor,
    }
  }

  removeParticipant(roomId, identity) {
    const room = this.getRoom(roomId)
    if (!room) return null

    room.participants.delete(identity)

    if (room.floor?.identity === identity) {
      room.floor = null
    }

    this.touch(room)
    return room
  }

  startTurn(roomId, { identity }) {
    const room = this.requireRoom(roomId)
    if (
      (room.conversationMode || CONVERSATION_MODE_FLOOR) !==
      CONVERSATION_MODE_FLOOR
    ) {
      throw createError('Floor control is disabled in free-flow mode', 409)
    }

    const sourceParticipant = room.participants.get(identity)
    if (!sourceParticipant) {
      throw createError('Participant not found', 404)
    }

    if (room.floor) {
      return {
        granted: false,
        floor: room.floor,
      }
    }

    const targetLanguages = getTargetLanguagesForSide(
      room,
      sourceParticipant.sideIndex,
    )
    room.floor = {
      turnId: createId(10),
      identity,
      sourceLanguage: sourceParticipant.languageCode,
      targetLanguages,
      translatorIdentities: targetLanguages.map(
        (languageCode) => `translator-${languageCode}`,
      ),
      startedAt: new Date(this.now()).toISOString(),
    }
    this.touch(room)

    return {
      granted: true,
      floor: room.floor,
    }
  }

  endTurn(roomId, { turnId, identity }) {
    const room = this.requireRoom(roomId)
    if (!room.floor) {
      return {
        ended: false,
        reason: 'no-active-turn',
      }
    }

    if (room.floor.turnId !== turnId || room.floor.identity !== identity) {
      return {
        ended: false,
        reason: 'turn-mismatch',
        floor: room.floor,
      }
    }

    const endedFloor = room.floor
    room.floor = null
    this.touch(room)

    return {
      ended: true,
      floor: endedFloor,
    }
  }

  getFreeFlowRoutes(roomId) {
    const room = this.requireRoom(roomId)

    return Array.from(room.participants.values())
      .map((participant) => ({
        sourceIdentity: participant.identity,
        sourceLanguage: participant.languageCode,
        targetLanguages: getTargetLanguagesForParticipant(room, participant),
      }))
      .filter((route) => route.targetLanguages.length > 0)
  }

  cleanupExpired() {
    const expiredRoomIds = []
    const now = this.now()

    for (const [roomId, room] of this.rooms) {
      if (Date.parse(room.expiresAt) <= now) {
        this.rooms.delete(roomId)
        expiredRoomIds.push(roomId)
      }
    }

    return expiredRoomIds
  }

  toPublicRoom(room, bridgeStatuses = {}) {
    return {
      roomId: room.roomId,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      expiresAt: room.expiresAt,
      participants: serializeParticipants(room),
      conversationMode: room.conversationMode || CONVERSATION_MODE_FLOOR,
      floor: room.floor,
      bridges: bridgeStatuses,
    }
  }
}
