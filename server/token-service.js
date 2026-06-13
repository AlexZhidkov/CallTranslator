import { AccessToken } from 'livekit-server-sdk'
import { createId } from './room-store.js'

export async function createParticipantToken({
  roomId,
  livekitConfig,
}) {
  const identity = `participant-${createId(9)}`
  const token = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
    identity,
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
