import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Headphones,
  Link as LinkIcon,
  Lock,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Users,
} from 'lucide-react'
import { Room, RoomEvent, Track } from 'livekit-client'
import './App.css'

const SIDE_OPTIONS = {
  parents: {
    id: 'parents',
    title: 'Parents',
    titleRu: 'Родители',
    language: 'Russian',
    languageRu: 'Русский',
    ownLanguageCode: 'ru',
    listenTranslator: 'translator-ru',
    speakButton: 'Speak Russian',
    speakButtonRu: 'Говорить по-русски',
  },
  grandchildren: {
    id: 'grandchildren',
    title: 'Grandchildren',
    titleRu: 'Внуки',
    language: 'English',
    languageRu: 'Английский',
    ownLanguageCode: 'en',
    listenTranslator: 'translator-en',
    speakButton: 'Speak English',
    speakButtonRu: 'Говорить по-английски',
  },
}

const AUDIO_CAPTURE_OPTIONS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

function getRoomIdFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || ''
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

function formatSide(side) {
  if (!side) return 'No one / Никто'
  const config = SIDE_OPTIONS[side]
  return config ? `${config.title} / ${config.titleRu}` : side
}

function App() {
  const [roomId, setRoomId] = useState(getRoomIdFromUrl)
  const [roomInfo, setRoomInfo] = useState(null)
  const [selectedSide, setSelectedSide] = useState('parents')
  const [displayName, setDisplayName] = useState('')
  const [participant, setParticipant] = useState(null)
  const [connectionState, setConnectionState] = useState('idle')
  const [activeTurn, setActiveTurn] = useState(null)
  const [transcripts, setTranscripts] = useState([])
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const roomRef = useRef(null)
  const participantRef = useRef(null)
  const roomIdRef = useRef(roomId)
  const sideRef = useRef(selectedSide)
  const audioSinkRef = useRef(null)

  const selectedConfig = SIDE_OPTIONS[selectedSide]
  const floor = roomInfo?.floor || activeTurn
  const isJoined = Boolean(participant)
  const isMyTurn = Boolean(floor && participant?.identity === floor.identity)
  const isSomeoneSpeaking = Boolean(floor)
  const canStartTurn = isJoined && !isSomeoneSpeaking
  const currentJoinUrl = useMemo(() => {
    if (!roomId) return ''
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomId)
    return url.toString()
  }, [roomId])

  useEffect(() => {
    roomIdRef.current = roomId
  }, [roomId])

  useEffect(() => {
    sideRef.current = selectedSide
  }, [selectedSide])

  useEffect(() => {
    participantRef.current = participant
  }, [participant])

  useEffect(() => {
    if (!roomId) return undefined

    let cancelled = false
    const loadRoom = async () => {
      try {
        const data = await apiFetch(`/api/rooms/${roomId}`)
        if (!cancelled) {
          setRoomInfo(data.room)
          setError('')
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message)
        }
      }
    }

    loadRoom()
    const intervalId = window.setInterval(loadRoom, 1800)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [roomId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentParticipant = participantRef.current
      const currentRoomId = roomIdRef.current
      if (!currentParticipant || !currentRoomId) return

      navigator.sendBeacon(
        `/api/rooms/${currentRoomId}/leave`,
        new Blob([JSON.stringify({ identity: currentParticipant.identity })], {
          type: 'application/json',
        }),
      )
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (!participant || floor) return

    setActiveTurn(null)
    roomRef.current?.localParticipant?.setMicrophoneEnabled(false)
  }, [floor, participant])

  async function createRoom() {
    setError('')
    setCopied(false)

    try {
      const data = await apiFetch('/api/rooms', { method: 'POST' })
      setRoomId(data.roomId)
      setRoomInfo(data.room)

      const url = new URL(window.location.href)
      url.searchParams.set('room', data.roomId)
      window.history.pushState({}, '', url)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function copyJoinLink() {
    if (!currentJoinUrl) return

    await navigator.clipboard.writeText(currentJoinUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function attachTranslatedTrack(track, remoteParticipant) {
    const sideConfig = SIDE_OPTIONS[sideRef.current]
    if (
      track.kind !== Track.Kind.Audio ||
      remoteParticipant.identity !== sideConfig.listenTranslator
    ) {
      return
    }

    const element = track.attach()
    element.autoplay = true
    element.dataset.participant = remoteParticipant.identity
    audioSinkRef.current?.appendChild(element)
  }

  function handleDataReceived(payload, remoteParticipant, kind, topic) {
    if (topic !== 'transcription') return

    try {
      const message = JSON.parse(new TextDecoder().decode(payload))
      const sideConfig = SIDE_OPTIONS[sideRef.current]
      if (message.language !== sideConfig.ownLanguageCode) return

      setTranscripts((current) =>
        [
          {
            id: `${message.segmentId}-${message.timestamp}`,
            speaker: remoteParticipant?.identity || 'translator',
            text: message.text,
            final: message.final,
            timestamp: message.timestamp,
          },
          ...current,
        ].slice(0, 8),
      )
    } catch (decodeError) {
      console.warn('Ignoring invalid transcription payload', decodeError)
    }
  }

  async function joinRoom() {
    if (!roomId) return

    setError('')
    setConnectionState('connecting')

    try {
      const tokenData = await apiFetch(`/api/rooms/${roomId}/token`, {
        method: 'POST',
        body: JSON.stringify({
          side: selectedSide,
          displayName:
            displayName.trim() ||
            `${selectedConfig.title} / ${selectedConfig.titleRu}`,
        }),
      })

      const livekitRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: AUDIO_CAPTURE_OPTIONS,
      })

      livekitRoom.on(RoomEvent.TrackSubscribed, attachTranslatedTrack)
      livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove())
      })
      livekitRoom.on(RoomEvent.DataReceived, handleDataReceived)
      livekitRoom.on(RoomEvent.Disconnected, () => {
        setConnectionState('disconnected')
      })

      await livekitRoom.connect(tokenData.livekitUrl, tokenData.token, {
        autoSubscribe: true,
      })

      roomRef.current = livekitRoom
      setParticipant(tokenData.participant)
      setRoomInfo(tokenData.room)
      setConnectionState('connected')
    } catch (requestError) {
      setConnectionState('idle')
      setError(requestError.message)
    }
  }

  async function startTurn() {
    if (!participant || !roomRef.current) return

    setError('')

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/turn/start`, {
        method: 'POST',
        body: JSON.stringify({
          side: selectedSide,
          identity: participant.identity,
        }),
      })

      setRoomInfo(data.room)
      setActiveTurn(data.floor)

      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(
          true,
          AUDIO_CAPTURE_OPTIONS,
        )
      } catch (micError) {
        await apiFetch(`/api/rooms/${roomId}/turn/end`, {
          method: 'POST',
          body: JSON.stringify({
            turnId: data.floor.turnId,
            identity: participant.identity,
          }),
        }).catch(() => {})
        setActiveTurn(null)
        throw micError
      }
    } catch (requestError) {
      if (requestError.status === 409 && requestError.data?.room) {
        setRoomInfo(requestError.data.room)
      }
      setError(requestError.message)
    }
  }

  async function endTurn() {
    if (!participant || !floor) return

    setError('')
    await roomRef.current?.localParticipant?.setMicrophoneEnabled(false)

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/turn/end`, {
        method: 'POST',
        body: JSON.stringify({
          turnId: floor.turnId,
          identity: participant.identity,
        }),
      })

      setRoomInfo(data.room)
      setActiveTurn(null)
    } catch (requestError) {
      if (requestError.data?.room) {
        setRoomInfo(requestError.data.room)
      }
      setActiveTurn(null)
      setError(requestError.message)
    }
  }

  async function leaveRoom() {
    const currentParticipant = participant
    const currentRoom = roomRef.current

    if (isMyTurn) {
      await endTurn()
    }

    await currentRoom?.disconnect()
    roomRef.current = null
    audioSinkRef.current?.replaceChildren()

    if (currentParticipant) {
      await apiFetch(`/api/rooms/${roomId}/leave`, {
        method: 'POST',
        body: JSON.stringify({ identity: currentParticipant.identity }),
      }).catch(() => {})
    }

    setParticipant(null)
    setConnectionState('idle')
    setTranscripts([])
    setActiveTurn(null)
  }

  async function handleSpeakButton() {
    if (isMyTurn) {
      await endTurn()
      return
    }

    await startTurn()
  }

  return (
    <main className="app-shell">
      <section className="top-bar" aria-label="Call setup">
        <div>
          <p className="eyebrow">Russian-English family call</p>
          <h1>Call Translator / Переводчик звонка</h1>
        </div>
        <div className={`connection-pill ${connectionState}`}>
          <Radio size={18} />
          <span>{connectionState}</span>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!roomId ? (
        <section className="start-panel">
          <div>
            <h2>Create a call / Создать звонок</h2>
            <p>
              One shared room for grandparents and grandchildren, with one side
              speaking at a time.
            </p>
          </div>
          <button className="primary-action" type="button" onClick={createRoom}>
            <Phone size={22} />
            Create room / Создать комнату
          </button>
        </section>
      ) : (
        <>
          <section className="share-row" aria-label="Share room">
            <div>
              <span className="label">Room / Комната</span>
              <strong>{roomId}</strong>
            </div>
            <button type="button" className="icon-button" onClick={copyJoinLink}>
              {copied ? <Check size={20} /> : <Copy size={20} />}
              <span>{copied ? 'Copied' : 'Copy link'}</span>
            </button>
            <a className="room-link" href={currentJoinUrl}>
              <LinkIcon size={18} />
              Open link
            </a>
          </section>

          <section className="join-grid" aria-label="Join options">
            {Object.values(SIDE_OPTIONS).map((side) => (
              <button
                key={side.id}
                type="button"
                className={`side-option ${
                  selectedSide === side.id ? 'selected' : ''
                }`}
                onClick={() => setSelectedSide(side.id)}
                disabled={isJoined}
              >
                <Users size={22} />
                <span>
                  <strong>
                    {side.title} / {side.titleRu}
                  </strong>
                  <small>
                    {side.language} / {side.languageRu}
                  </small>
                </span>
              </button>
            ))}
          </section>

          {!isJoined ? (
            <section className="join-panel">
              <label>
                <span>Name / Имя</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={`${selectedConfig.title} / ${selectedConfig.titleRu}`}
                />
              </label>
              <button
                type="button"
                className="primary-action"
                onClick={joinRoom}
                disabled={connectionState === 'connecting'}
              >
                <Headphones size={22} />
                Join as {selectedConfig.title} / Войти
              </button>
            </section>
          ) : (
            <section className="call-surface" aria-label="Call controls">
              <div className="status-board">
                <div>
                  <span className="label">You are / Вы</span>
                  <strong>
                    {selectedConfig.title} / {selectedConfig.titleRu}
                  </strong>
                </div>
                <div>
                  <span className="label">Floor / Кто говорит</span>
                  <strong>{formatSide(floor?.side)}</strong>
                </div>
                <div>
                  <span className="label">Listening to / Слушаете</span>
                  <strong>{selectedConfig.listenTranslator}</strong>
                </div>
              </div>

              <button
                type="button"
                className={`talk-button ${isMyTurn ? 'speaking' : ''}`}
                onClick={handleSpeakButton}
                disabled={!isMyTurn && !canStartTurn}
              >
                {isMyTurn ? <MicOff size={34} /> : <Mic size={34} />}
                <span>
                  {isMyTurn ? 'Done / Готово' : selectedConfig.speakButton}
                  {!isMyTurn ? (
                    <small>{selectedConfig.speakButtonRu}</small>
                  ) : null}
                </span>
              </button>

              {floor && !isMyTurn ? (
                <p className="floor-note">
                  <Lock size={18} />
                  {formatSide(floor.side)} has the floor / сейчас говорит
                  другая сторона
                </p>
              ) : (
                <p className="floor-note">
                  <Headphones size={18} />
                  Microphone is off until you speak / микрофон выключен
                </p>
              )}

              <button type="button" className="leave-button" onClick={leaveRoom}>
                <PhoneOff size={20} />
                Leave / Выйти
              </button>
            </section>
          )}

          <section className="transcript-panel" aria-label="Transcripts">
            <div className="section-heading">
              <h2>Transcript / Текст</h2>
              <span>{transcripts.length}</span>
            </div>
            {transcripts.length ? (
              <ol>
                {transcripts.map((item) => (
                  <li key={item.id} className={item.final ? 'final' : 'interim'}>
                    {item.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Translated speech will appear here.</p>
            )}
          </section>
        </>
      )}

      <div ref={audioSinkRef} className="audio-sink" aria-hidden="true" />
    </main>
  )
}

export default App
