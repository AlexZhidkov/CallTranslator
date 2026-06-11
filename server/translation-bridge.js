import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node'
import { AccessToken } from 'livekit-server-sdk'
import WebSocket from 'ws'

const GEMINI_MODEL = 'gemini-3.5-live-translate-preview'
const GEMINI_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export class TranslationBridge {
  constructor({
    roomId,
    sourceIdentity,
    targetLanguage,
    livekitConfig,
    geminiConfig,
  }) {
    this.roomId = roomId
    this.sourceIdentity = sourceIdentity
    this.targetLanguage = targetLanguage
    this.identity = `translator-${targetLanguage}`
    this.livekitConfig = livekitConfig
    this.geminiConfig = geminiConfig

    this.status = 'starting'
    this.room = null
    this.geminiWs = null
    this.audioSource = null
    this.localTrack = null
    this.geminiReady = false
    this.captureChain = Promise.resolve()
    this.framesSent = 0
    this.framesReceived = 0
    this.transcriptionSegmentId = 0
    this.closedByUser = false
  }

  async start() {
    await this.joinRoom()
    await this.connectGemini()
    this.subscribeToSourceAudio()
    this.status = 'active'
  }

  async stop() {
    this.closedByUser = true
    this.status = 'closed'

    if (this.geminiWs) {
      this.geminiWs.close()
      this.geminiWs = null
    }

    if (this.room) {
      await this.room.disconnect()
      this.room = null
    }

    this.audioSource = null
    this.localTrack = null
    this.geminiReady = false
  }

  sendAudioStreamEnd() {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return

    this.geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          audioStreamEnd: true,
        },
      }),
    )
  }

  async joinRoom() {
    const token = new AccessToken(
      this.livekitConfig.apiKey,
      this.livekitConfig.apiSecret,
      {
        identity: this.identity,
        name: `Translator ${this.targetLanguage.toUpperCase()}`,
        ttl: '4h',
      },
    )

    token.addGrant({
      roomJoin: true,
      room: this.roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    this.room = new Room()
    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.closedByUser) this.status = 'closed'
    })

    await this.room.connect(this.livekitConfig.livekitUrl, await token.toJwt(), {
      autoSubscribe: false,
      dynacast: false,
    })

    this.audioSource = new AudioSource(24000, 1)
    this.localTrack = LocalAudioTrack.createAudioTrack(
      `translated-audio-${this.targetLanguage}`,
      this.audioSource,
    )

    const publishOptions = new TrackPublishOptions()
    publishOptions.source = TrackSource.SOURCE_MICROPHONE

    await this.room.localParticipant.publishTrack(
      this.localTrack,
      publishOptions,
    )
  }

  connectGemini() {
    const url = `${GEMINI_WS_URL}?key=${this.geminiConfig.apiKey}`

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.geminiWs = ws

      const timeout = setTimeout(() => {
        reject(new Error('Gemini setup timed out'))
      }, 15000)

      ws.on('open', () => {
        ws.send(JSON.stringify(this.createGeminiSetupMessage()))
      })

      ws.on('message', (data) => {
        const message = this.parseGeminiMessage(data)
        if (!message) return

        if (message.setupComplete) {
          this.geminiReady = true
          clearTimeout(timeout)
          resolve()
          return
        }

        this.handleGeminiMessage(message)
      })

      ws.on('error', (error) => {
        if (!this.geminiReady) {
          clearTimeout(timeout)
          reject(error)
          return
        }

        this.status = 'error'
      })

      ws.on('close', () => {
        this.geminiReady = false
        if (!this.closedByUser && this.status === 'active') {
          this.reconnectGemini()
        }
      })
    })
  }

  reconnectGemini() {
    setTimeout(() => {
      if (this.closedByUser) return

      this.connectGemini()
        .then(() => {
          if (!this.closedByUser) this.status = 'active'
        })
        .catch((error) => {
          console.error(
            `[TranslationBridge:${this.targetLanguage}] Reconnect failed`,
            error,
          )
          this.status = 'error'
        })
    }, 1000)
  }

  createGeminiSetupMessage() {
    return {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: {
            targetLanguageCode: this.targetLanguage,
            echoTargetLanguage: false,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
      },
    }
  }

  parseGeminiMessage(data) {
    try {
      return JSON.parse(data.toString())
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Invalid Gemini message`,
        error,
      )
      return null
    }
  }

  handleGeminiMessage(message) {
    const serverContent = message.serverContent
    const parts = serverContent?.modelTurn?.parts || []

    for (const part of parts) {
      if (part.inlineData?.data) {
        this.framesReceived += 1
        this.queueAudioFrame(part.inlineData.data)
      }
    }

    if (serverContent?.outputTranscription?.text) {
      this.publishTranscription(
        serverContent.outputTranscription.text,
        !serverContent.turnComplete,
      )
    }

    if (serverContent?.turnComplete) {
      this.transcriptionSegmentId += 1
    }
  }

  queueAudioFrame(base64Audio) {
    this.captureChain = this.captureChain.then(() =>
      this.publishTranslatedAudio(base64Audio),
    )
  }

  async publishTranslatedAudio(base64Audio) {
    if (!this.audioSource || this.status === 'closed') return

    const pcmBuffer = Buffer.from(base64Audio, 'base64')
    const samples = new Int16Array(
      pcmBuffer.buffer,
      pcmBuffer.byteOffset,
      pcmBuffer.byteLength / 2,
    )

    const frame = new AudioFrame(samples, 24000, 1, samples.length)
    await this.audioSource.captureFrame(frame)
  }

  subscribeToSourceAudio() {
    if (!this.room) return

    for (const participant of this.room.remoteParticipants.values()) {
      if (participant.identity === this.sourceIdentity) {
        this.subscribeToParticipantAudio(participant)
      }
    }

    this.room.on(
      RoomEvent.TrackPublished,
      (publication, participant) => {
        if (
          participant.identity === this.sourceIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          publication.setSubscribed(true)
        }
      },
    )

    this.room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        if (
          participant.identity === this.sourceIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          this.pipeTrackToGemini(track)
        }
      },
    )
  }

  subscribeToParticipantAudio(participant) {
    if (!(participant instanceof RemoteParticipant)) return

    for (const publication of participant.trackPublications.values()) {
      if (publication.kind === TrackKind.KIND_AUDIO) {
        publication.setSubscribed(true)
      }
    }
  }

  pipeTrackToGemini(track) {
    if (!(track instanceof RemoteAudioTrack)) return

    const audioStream = new AudioStream(track, {
      sampleRate: 48000,
      numChannels: 1,
      frameSizeMs: 100,
    })
    const reader = audioStream.getReader()

    const readLoop = async () => {
      while (!this.closedByUser) {
        const { done, value } = await reader.read()
        if (done) break
        this.sendAudioToGemini(value)
      }
    }

    readLoop().catch((error) => {
      if (!this.closedByUser) {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Audio stream failed`,
          error,
        )
      }
    })
  }

  sendAudioToGemini(frame) {
    if (
      !this.geminiWs ||
      this.geminiWs.readyState !== WebSocket.OPEN ||
      !this.geminiReady
    ) {
      return
    }

    const int16Data = frame.data
    const buffer = Buffer.from(
      int16Data.buffer,
      int16Data.byteOffset,
      int16Data.byteLength,
    )

    this.framesSent += 1
    this.geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=48000',
            data: buffer.toString('base64'),
          },
        },
      }),
    )
  }

  async publishTranscription(text, interim) {
    if (!this.room?.localParticipant) return

    const payload = JSON.stringify({
      type: 'transcription',
      language: this.targetLanguage,
      segmentId: `${this.targetLanguage}-${this.transcriptionSegmentId}`,
      text,
      final: !interim,
      timestamp: Date.now(),
    })

    await this.room.localParticipant.publishData(
      new TextEncoder().encode(payload),
      {
        reliable: true,
        topic: 'transcription',
      },
    )
  }
}
