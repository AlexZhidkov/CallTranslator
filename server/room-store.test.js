import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomStore, SIDES } from './room-store.js'
import { resolveSupportedLanguageCode } from '../shared/supported-languages.js'

test('creates high-entropy rooms', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  assert.match(room.roomId, /^[A-Za-z0-9_-]+$/)
  assert.ok(room.roomId.length >= 16)
  assert.deepEqual(room.floor, null)
})

test('keeps the two family sides as room roles', () => {
  assert.equal(SIDES.parents.label, 'Parents')
  assert.equal(SIDES.grandchildren.label, 'Grandchildren')
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

  const parent = store.addParticipant(room.roomId, {
    side: 'parents',
    identity: 'parents-1',
    languageCode: 'ru',
  })
  const grandchild = store.addParticipant(room.roomId, {
    side: 'grandchildren',
    identity: 'grandchildren-1',
    languageCode: 'es',
  })

  assert.equal(parent.languageName, 'Russian')
  assert.equal(grandchild.languageName, 'Spanish')

  const turn = store.startTurn(room.roomId, {
    side: 'parents',
    identity: parent.identity,
  })

  assert.equal(turn.granted, true)
  assert.deepEqual(turn.floor.targetLanguages, ['es'])
  assert.equal(turn.floor.translatorIdentity, 'translator-es')
  assert.deepEqual(turn.floor.translatorIdentities, ['translator-es'])
})

test('denies a second floor claim while a turn is active', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  const first = store.startTurn(room.roomId, {
    side: 'parents',
    identity: 'parents-1',
  })
  const second = store.startTurn(room.roomId, {
    side: 'grandchildren',
    identity: 'grandchildren-1',
  })

  assert.equal(first.granted, true)
  assert.equal(second.granted, false)
  assert.equal(second.floor.turnId, first.floor.turnId)
})

test('releases a matching active turn', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  const turn = store.startTurn(room.roomId, {
    side: 'grandchildren',
    identity: 'child-1',
  })
  const ended = store.endTurn(room.roomId, {
    turnId: turn.floor.turnId,
    identity: 'child-1',
  })

  assert.equal(ended.ended, true)
  assert.equal(store.getRoom(room.roomId).floor, null)
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
