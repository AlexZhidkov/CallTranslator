import { TranslationBridge } from './translation-bridge.js'

function bridgeKey(roomId, targetLanguage) {
  return `${roomId}:${targetLanguage}`
}

export class BridgeManager {
  constructor({ livekitConfig, geminiConfig }) {
    this.livekitConfig = livekitConfig
    this.geminiConfig = geminiConfig
    this.bridges = new Map()
  }

  getStatuses(roomId) {
    const statuses = {}

    for (const [key, bridge] of this.bridges) {
      if (!key.startsWith(`${roomId}:`)) continue
      statuses[bridge.targetLanguage] = {
        identity: bridge.identity,
        sourceIdentity: bridge.sourceIdentity,
        status: bridge.status,
        framesSent: bridge.framesSent,
        framesReceived: bridge.framesReceived,
      }
    }

    return statuses
  }

  async startTurn({ roomId, sourceIdentity, targetLanguage }) {
    const key = bridgeKey(roomId, targetLanguage)
    const existing = this.bridges.get(key)

    if (
      existing &&
      existing.sourceIdentity === sourceIdentity &&
      existing.status === 'active'
    ) {
      return existing
    }

    if (existing) {
      await existing.stop()
      this.bridges.delete(key)
    }

    const bridge = new TranslationBridge({
      roomId,
      sourceIdentity,
      targetLanguage,
      livekitConfig: this.livekitConfig,
      geminiConfig: this.geminiConfig,
    })

    this.bridges.set(key, bridge)

    try {
      await bridge.start()
      return bridge
    } catch (error) {
      this.bridges.delete(key)
      throw error
    }
  }

  endTurn({ roomId, targetLanguage }) {
    const bridge = this.bridges.get(bridgeKey(roomId, targetLanguage))
    bridge?.sendAudioStreamEnd()
  }

  async stopRoom(roomId) {
    const stops = []

    for (const [key, bridge] of this.bridges) {
      if (key.startsWith(`${roomId}:`)) {
        stops.push(bridge.stop())
        this.bridges.delete(key)
      }
    }

    await Promise.allSettled(stops)
  }
}
