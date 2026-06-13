import { TranslationBridge } from './translation-bridge.js'

function bridgeKey(roomId, targetLanguage) {
  return `${roomId}:${targetLanguage}`
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

    for (const [key, bridge] of this.bridges) {
      if (!key.startsWith(`${roomId}:`)) continue
      statuses[bridge.targetLanguage] = {
        identity: bridge.identity,
        sourceIdentity: bridge.sourceIdentity,
        sourceLanguage: bridge.sourceLanguage,
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
    roomId,
    sourceIdentity,
    sourceLanguage,
    targetLanguage,
    publishSourceTranscription = true,
  }) {
    const key = bridgeKey(roomId, targetLanguage)
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

  endTurn({ roomId, targetLanguage, targetLanguages }) {
    const languages = normalizeTargetLanguages({
      targetLanguage,
      targetLanguages,
    })

    for (const languageCode of languages) {
      const bridge = this.bridges.get(bridgeKey(roomId, languageCode))
      bridge?.sendAudioStreamEnd()
    }
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
