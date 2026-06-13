import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomStore } from './room-store.js'
import { resolveSupportedLanguageCode } from '../shared/supported-languages.js'

test('creates high-entropy rooms', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  assert.match(room.roomId, /^[A-Za-z0-9_-]+$/)
  assert.ok(room.roomId.length >= 16)
  assert.deepEqual(room.floor, null)
})

test('returns public room state without internal conversation sides', () => {
  const store = new RoomStore()
  const room = store.createRoom()
  const participant = store.addParticipant(room.roomId, {
    identity: 'participant-1',
    languageCode: 'ru',
  })
  const publicRoom = store.toPublicRoom(room)

  assert.equal('side' in participant, false)
  assert.equal('sideIndex' in participant, false)
  assert.equal(Array.isArray(publicRoom.participants), true)
  assert.equal(publicRoom.participants[0].identity, 'participant-1')
  assert.equal('side' in publicRoom.participants[0], false)
  assert.equal('sideIndex' in publicRoom.participants[0], false)
  assert.equal('participantCounts' in publicRoom, false)
})

test('resolves browser locales to supported language codes', () => {
  assert.equal(resolveSupportedLanguageCode(['fr-CA']), 'fr')
  assert.equal(resolveSupportedLanguageCode(['nb-NO']), 'no')
  assert.equal(resolveSupportedLanguageCode(['zh-TW']), 'zh-Hant')
  assert.equal(resolveSupportedLanguageCode(['pt-PT']), 'pt-PT')
  assert.equal(resolveSupportedLanguageCode(['not-a-language']), 'en')
})

test('stores participant languages and targets the opposite side', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  const first = store.addParticipant(room.roomId, {
    identity: 'participant-1',
    languageCode: 'ru',
  })
  const second = store.addParticipant(room.roomId, {
    identity: 'participant-2',
    languageCode: 'es',
  })
  store.addParticipant(room.roomId, {
    identity: 'participant-3',
    languageCode: 'fr',
  })

  assert.equal(first.languageName, 'Русский')
  assert.equal(second.languageName, 'Español')

  const turn = store.startTurn(room.roomId, {
    identity: first.identity,
  })

  assert.equal(turn.granted, true)
  assert.equal(turn.floor.sourceLanguage, 'ru')
  assert.deepEqual(turn.floor.targetLanguages, ['es'])
  assert.deepEqual(turn.floor.translatorIdentities, ['translator-es'])
  assert.equal('side' in turn.floor, false)
  assert.equal('targetLanguage' in turn.floor, false)
  assert.equal('translatorIdentity' in turn.floor, false)
})

test('deduplicates target languages on the opposite side', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  store.addParticipant(room.roomId, {
    identity: 'participant-1',
    languageCode: 'en',
  })
  store.addParticipant(room.roomId, {
    identity: 'participant-2',
    languageCode: 'es',
  })
  store.addParticipant(room.roomId, {
    identity: 'participant-3',
    languageCode: 'ru',
  })
  store.addParticipant(room.roomId, {
    identity: 'participant-4',
    languageCode: 'es',
  })

  const turn = store.startTurn(room.roomId, {
    identity: 'participant-1',
  })

  assert.deepEqual(turn.floor.targetLanguages, ['es'])
})

test('denies a second floor claim while a turn is active', () => {
  const store = new RoomStore()
  const room = store.createRoom()
  const firstParticipant = store.addParticipant(room.roomId, {
    identity: 'participant-1',
    languageCode: 'en',
  })
  const secondParticipant = store.addParticipant(room.roomId, {
    identity: 'participant-2',
    languageCode: 'es',
  })

  const first = store.startTurn(room.roomId, {
    identity: firstParticipant.identity,
  })
  const second = store.startTurn(room.roomId, {
    identity: secondParticipant.identity,
  })

  assert.equal(first.granted, true)
  assert.equal(second.granted, false)
  assert.equal(second.floor.turnId, first.floor.turnId)
})

test('releases a matching active turn', () => {
  const store = new RoomStore()
  const room = store.createRoom()
  const participant = store.addParticipant(room.roomId, {
    identity: 'participant-1',
    languageCode: 'en',
  })

  const turn = store.startTurn(room.roomId, {
    identity: participant.identity,
  })
  const ended = store.endTurn(room.roomId, {
    turnId: turn.floor.turnId,
    identity: participant.identity,
  })

  assert.equal(ended.ended, true)
  assert.equal(store.getRoom(room.roomId).floor, null)
})

test('rejects unknown participant turn claims', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  assert.throws(
    () =>
      store.startTurn(room.roomId, {
        identity: 'missing-participant',
      }),
    {
      message: 'Participant not found',
      statusCode: 404,
    },
  )
})

test('cleans up expired rooms', () => {
  let now = 1_000
  const store = new RoomStore({ ttlMs: 100, now: () => now })
  const room = store.createRoom()

  now = 1_101
  const expired = store.cleanupExpired()

  assert.deepEqual(expired, [room.roomId])
  assert.equal(store.getRoom(room.roomId), null)
})
