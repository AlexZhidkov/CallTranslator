import { TranslationBridge } from './translation-bridge.js'

const BRIDGE_MODE_FLOOR = 'floor'
const BRIDGE_MODE_FREE_FLOW = 'freeFlow'

function bridgeKey({ roomId, mode, sourceIdentity, targetLanguage }) {
  if (mode === BRIDGE_MODE_FLOOR) {
    return `${roomId}:${mode}:${targetLanguage}`
  }

  return `${roomId}:${mode}:${sourceIdentity}:${targetLanguage}`
}

function isBridgeForRoomMode(bridge, roomId, mode) {
  return bridge.roomId === roomId && bridge.mode === mode
}

function getBridgeIdentity({ mode, sourceIdentity, targetLanguage }) {
  if (mode === BRIDGE_MODE_FREE_FLOW) {
    return `translator-${sourceIdentity}-${targetLanguage}`
  }

  return `translator-${targetLanguage}`
}

function normalizeTargetLanguages({ targetLanguage, targetLanguages }) {
  return Array.from(
    new Set(
      (targetLanguages || [targetLanguage]).filter(
        (languageCode) => typeof languageCode === 'string' && languageCode,
      ),
    ),
  )
}

export class BridgeManager {
  constructor({ livekitConfig, geminiConfig }) {
    this.livekitConfig = livekitConfig
    this.geminiConfig = geminiConfig
    this.bridges = new Map()
  }

  getStatuses(roomId) {
    const statuses = {}

    for (const bridge of this.bridges.values()) {
      if (bridge.roomId !== roomId) continue
      statuses[bridge.identity] = {
        identity: bridge.identity,
        mode: bridge.mode,
        sourceIdentity: bridge.sourceIdentity,
        sourceLanguage: bridge.sourceLanguage,
        targetLanguage: bridge.targetLanguage,
        status: bridge.status,
        framesSent: bridge.framesSent,
        framesReceived: bridge.framesReceived,
      }
    }

    return statuses
  }

  async startTurn({
    roomId,
    sourceIdentity,
    sourceLanguage,
    targetLanguage,
    targetLanguages,
  }) {
    const languages = normalizeTargetLanguages({
      targetLanguage,
      targetLanguages,
    })

    return Promise.all(
      languages.map((languageCode, index) =>
        this.startSingleBridge({
          mode: BRIDGE_MODE_FLOOR,
          roomId,
          sourceIdentity,
          sourceLanguage,
          targetLanguage: languageCode,
          publishSourceTranscription: index === 0,
        }),
      ),
    )
  }

  async startSingleBridge({
    mode = BRIDGE_MODE_FLOOR,
    roomId,
    sourceIdentity,
    sourceLanguage,
    targetLanguage,
    publishSourceTranscription = true,
  }) {
    const key = bridgeKey({
      roomId,
      mode,
      sourceIdentity,
      targetLanguage,
    })
    const existing = this.bridges.get(key)

    if (
      existing &&
      existing.sourceIdentity === sourceIdentity &&
      existing.status === 'active'
    ) {
      existing.sourceLanguage = sourceLanguage
      existing.publishSourceTranscription = publishSourceTranscription
      return existing
    }

    if (existing) {
      await existing.stop()
      this.bridges.delete(key)
    }

    const bridge = new TranslationBridge({
      mode,
      identity: getBridgeIdentity({ mode, sourceIdentity, targetLanguage }),
      roomId,
      sourceIdentity,
      sourceLanguage,
      targetLanguage,
      publishSourceTranscription,
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

  async syncFreeFlow({ roomId, routes }) {
    const desiredKeys = new Set()
    const starts = []

    for (const route of routes) {
      route.targetLanguages.forEach((targetLanguage, index) => {
        const key = bridgeKey({
          roomId,
          mode: BRIDGE_MODE_FREE_FLOW,
          sourceIdentity: route.sourceIdentity,
          targetLanguage,
        })
        desiredKeys.add(key)
        starts.push(
          this.startSingleBridge({
            mode: BRIDGE_MODE_FREE_FLOW,
            roomId,
            sourceIdentity: route.sourceIdentity,
            sourceLanguage: route.sourceLanguage,
            targetLanguage,
            publishSourceTranscription: index === 0,
          }),
        )
      })
    }

    const stops = []
    for (const [key, bridge] of this.bridges) {
      if (
        isBridgeForRoomMode(bridge, roomId, BRIDGE_MODE_FREE_FLOW) &&
        !desiredKeys.has(key)
      ) {
        stops.push(bridge.stop())
        this.bridges.delete(key)
      }
    }

    await Promise.allSettled(stops)
    return Promise.all(starts)
  }

  endTurn({ roomId, targetLanguage, targetLanguages }) {
    const languages = normalizeTargetLanguages({
      targetLanguage,
      targetLanguages,
    })

    for (const bridge of this.bridges.values()) {
      if (!isBridgeForRoomMode(bridge, roomId, BRIDGE_MODE_FLOOR)) continue
      if (!languages.includes(bridge.targetLanguage)) continue

      bridge.sendAudioStreamEnd()
    }
  }

  async stopMode(roomId, mode) {
    const stops = []

    for (const [key, bridge] of this.bridges) {
      if (isBridgeForRoomMode(bridge, roomId, mode)) {
        stops.push(bridge.stop())
        this.bridges.delete(key)
      }
    }

    await Promise.allSettled(stops)
  }

  async stopFloor(roomId) {
    await this.stopMode(roomId, BRIDGE_MODE_FLOOR)
  }

  async stopFreeFlow(roomId) {
    await this.stopMode(roomId, BRIDGE_MODE_FREE_FLOW)
  }

  async stopRoom(roomId) {
    const stops = []

    for (const [key, bridge] of this.bridges) {
      if (bridge.roomId === roomId) {
        stops.push(bridge.stop())
        this.bridges.delete(key)
      }
    }

    await Promise.allSettled(stops)
  }
}
