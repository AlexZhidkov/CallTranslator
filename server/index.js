import 'dotenv/config'
import { createApp } from './app.js'
import { BridgeManager } from './bridge-manager.js'
import { getGeminiConfig, getLiveKitConfig } from './config.js'
import { RoomStore } from './room-store.js'

const port = Number(process.env.PORT || 8080)
const roomStore = new RoomStore()

let bridgeManager = null
try {
  bridgeManager = new BridgeManager({
    livekitConfig: getLiveKitConfig(),
    geminiConfig: getGeminiConfig(),
  })
} catch (error) {
  console.warn(`[server] ${error.message}`)
  console.warn('[server] API health and room creation will work, but calls need env vars.')
}

const { app } = createApp({
  roomStore,
  bridgeManager,
})

setInterval(() => {
  const expiredRoomIds = roomStore.cleanupExpired()
  for (const roomId of expiredRoomIds) {
    bridgeManager?.stopRoom(roomId)
  }
}, 60_000).unref()

app.listen(port, () => {
  console.log(`[server] Call translator API listening on :${port}`)
})
