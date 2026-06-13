import { randomBytes } from 'node:crypto'
import {
  DEFAULT_LANGUAGE_CODE,
  getSupportedLanguageByCode,
} from '../shared/supported-languages.js'

export const SIDES = {
  parents: {
    id: 'parents',
    label: 'Parents',
    labelRu: 'Родители',
  },
  grandchildren: {
    id: 'grandchildren',
    label: 'Grandchildren',
    labelRu: 'Внуки',
  },
}

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000

export function createId(byteLength = 12) {
  return randomBytes(byteLength).toString('base64url')
}

function requireSide(side) {
  if (!SIDES[side]) {
    const error = new Error('Invalid side')
    error.statusCode = 400
    throw error
  }
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

function getTargetLanguagesForSide(room, speakingSide) {
  const targetLanguages = new Set()

  for (const [side, participants] of Object.entries(room.participants)) {
    if (side === speakingSide) continue

    for (const participant of participants.values()) {
      targetLanguages.add(participant.languageCode)
    }
  }

  return Array.from(targetLanguages)
}

function createParticipant(identity, side, displayName, languageCode) {
  const language = requireSupportedParticipantLanguage(languageCode)

  return {
    identity,
    side,
    displayName: displayName || SIDES[side].label,
    languageCode: language.code,
    languageName: language.name,
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }
}

function serializeParticipants(room) {
  return Object.fromEntries(
    Object.entries(room.participants).map(([side, participants]) => [
      side,
      Array.from(participants.values()),
    ]),
  )
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
      participants: {
        parents: new Map(),
        grandchildren: new Map(),
      },
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

  addParticipant(roomId, { side, identity, displayName, languageCode }) {
    requireSide(side)

    const room = this.requireRoom(roomId)
    const language = requireSupportedParticipantLanguage(languageCode)
    const existing = room.participants[side].get(identity)
    if (existing) {
      existing.lastSeenAt = new Date(this.now()).toISOString()
      if (displayName) existing.displayName = displayName
      existing.languageCode = language.code
      existing.languageName = language.name
      this.touch(room)
      return existing
    }

    const participant = createParticipant(
      identity,
      side,
      displayName,
      language.code,
    )
    room.participants[side].set(identity, participant)
    this.touch(room)
    return participant
  }

  removeParticipant(roomId, identity) {
    const room = this.getRoom(roomId)
    if (!room) return null

    for (const participants of Object.values(room.participants)) {
      participants.delete(identity)
    }

    if (room.floor?.identity === identity) {
      room.floor = null
    }

    this.touch(room)
    return room
  }

  startTurn(roomId, { side, identity }) {
    requireSide(side)

    const room = this.requireRoom(roomId)
    if (room.floor) {
      return {
        granted: false,
        floor: room.floor,
      }
    }

    const targetLanguages = getTargetLanguagesForSide(room, side)
    room.floor = {
      turnId: createId(10),
      side,
      identity,
      targetLanguage: targetLanguages[0] || null,
      targetLanguages,
      translatorIdentity: targetLanguages[0]
        ? `translator-${targetLanguages[0]}`
        : null,
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
      participantCounts: {
        parents: room.participants.parents.size,
        grandchildren: room.participants.grandchildren.size,
      },
      floor: room.floor,
      bridges: bridgeStatuses,
    }
  }
}
