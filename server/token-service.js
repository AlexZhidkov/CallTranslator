import { AccessToken } from 'livekit-server-sdk'
import { createId, SIDES } from './room-store.js'

export async function createParticipantToken({
  roomId,
  side,
  displayName,
  livekitConfig,
}) {
  if (!SIDES[side]) {
    const error = new Error('Invalid side')
    error.statusCode = 400
    throw error
  }

  const identity = `${side}-${createId(9)}`
  const name = displayName || SIDES[side].label
  const token = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
    identity,
    name,
    ttl: '4h',
  })

  token.addGrant({
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })

  return {
    identity,
    token: await token.toJwt(),
    livekitUrl: livekitConfig.livekitUrl,
  }
}
