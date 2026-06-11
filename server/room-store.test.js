import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomStore, SIDES } from './room-store.js'

test('creates high-entropy rooms', () => {
  const store = new RoomStore()
  const room = store.createRoom()

  assert.match(room.roomId, /^[A-Za-z0-9_-]+$/)
  assert.ok(room.roomId.length >= 16)
  assert.deepEqual(room.floor, null)
})

test('maps each side to the expected target language', () => {
  assert.equal(SIDES.parents.targetLanguage, 'en')
  assert.equal(SIDES.grandchildren.targetLanguage, 'ru')
  assert.equal(SIDES.parents.listenTranslator, 'translator-ru')
  assert.equal(SIDES.grandchildren.listenTranslator, 'translator-en')
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
