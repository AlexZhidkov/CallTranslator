import assert from 'node:assert/strict'
import test from 'node:test'
import { TranslationBridge } from './translation-bridge.js'

function createBridge(overrides = {}) {
  return new TranslationBridge({
    roomId: 'room-1',
    sourceIdentity: 'speaker-1',
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    livekitConfig: {},
    geminiConfig: {},
    ...overrides,
  })
}

test('publishes transcription payloads with the source speaker identity', async () => {
  const bridge = createBridge()
  const published = []
  bridge.room = {
    localParticipant: {
      publishData: async (data, options) => {
        published.push({
          payload: JSON.parse(new TextDecoder().decode(data)),
          options,
        })
      },
    },
  }

  await bridge.publishTranscription({
    text: 'Hello',
    language: 'en',
    segmentId: 'en-output-0',
    final: true,
    transcriptSource: 'output',
  })

  assert.equal(published.length, 1)
  assert.deepEqual(published[0].options, {
    reliable: true,
    topic: 'transcription',
  })
  assert.equal(published[0].payload.type, 'transcription')
  assert.equal(published[0].payload.language, 'en')
  assert.equal(published[0].payload.segmentId, 'en-output-0')
  assert.equal(published[0].payload.speakerIdentity, 'speaker-1')
  assert.equal(published[0].payload.text, 'Hello')
  assert.equal(published[0].payload.final, true)
  assert.equal(published[0].payload.transcriptSource, 'output')
  assert.equal(typeof published[0].payload.timestamp, 'number')
})

test('handles input and output transcriptions from Gemini messages', () => {
  const bridge = createBridge()
  const calls = []
  bridge.publishTranscriptionSafely = (payload) => calls.push(payload)

  bridge.handleGeminiMessage({
    serverContent: {
      inputTranscription: {
        text: 'Привет',
        languageCode: 'ru',
      },
      outputTranscription: {
        text: 'Hello',
        languageCode: 'en',
      },
      turnComplete: false,
    },
  })

  assert.deepEqual(calls, [
    {
      text: 'Привет',
      language: 'ru',
      segmentId: 'speaker-1-input-0',
      final: false,
      transcriptSource: 'input',
    },
    {
      text: 'Hello',
      language: 'en',
      segmentId: 'en-output-0',
      final: false,
      transcriptSource: 'output',
    },
  ])
})

test('can suppress duplicate source transcriptions for secondary bridges', () => {
  const bridge = createBridge({
    targetLanguage: 'es',
    publishSourceTranscription: false,
  })
  const calls = []
  bridge.publishTranscriptionSafely = (payload) => calls.push(payload)

  bridge.handleGeminiMessage({
    serverContent: {
      inputTranscription: {
        text: 'Привет',
        languageCode: 'ru',
      },
      outputTranscription: {
        text: 'Hola',
        languageCode: 'es',
      },
    },
  })

  assert.deepEqual(calls, [
    {
      text: 'Hola',
      language: 'es',
      segmentId: 'es-output-0',
      final: false,
      transcriptSource: 'output',
    },
  ])
})
