import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Headphones,
  KeyRound,
  Lock,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Volume2,
} from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  DEFAULT_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  getLanguageDisplayCode,
  getSupportedLanguageByCode,
  resolveSupportedLanguageCode,
} from "../shared/supported-languages.js";
import "./App.css";

const AUDIO_CAPTURE_OPTIONS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const PIN_STORAGE_KEY = "call-translator-pin";

function getStoredPin() {
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storePin(pin) {
  try {
    window.localStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    // Ignore storage errors; the PIN will be asked for again next visit.
  }
}

function clearStoredPin() {
  try {
    window.localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function getRoomIdFromUrl() {
  return new URLSearchParams(window.location.search).get("room") || "";
}

function getBrowserLanguagePreferences() {
  const languages = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language];

  return languages.filter(Boolean);
}

function getInitialLanguageCode() {
  return resolveSupportedLanguageCode(getBrowserLanguagePreferences());
}

function getTranslatorIdentity(languageCode) {
  return `translator-${languageCode}`;
}

function LanguageSelect({ id, value, onChange, disabled = false }) {
  return (
    <label className="language-select" htmlFor={id}>
      <span>Your language</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.name} ({getLanguageDisplayCode(language)})
          </option>
        ))}
      </select>
    </label>
  );
}

async function apiFetch(path, options = {}) {
  const pin = getStoredPin();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(pin ? { "X-App-Pin": pin } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("app-pin-rejected"));
    }
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function App() {
  const [roomId, setRoomId] = useState(getRoomIdFromUrl);
  const [roomInfo, setRoomInfo] = useState(null);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState(
    getInitialLanguageCode,
  );
  const [participant, setParticipant] = useState(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [activeTurn, setActiveTurn] = useState(null);
  const [transcripts, setTranscripts] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [accessState, setAccessState] = useState("checking");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const roomRef = useRef(null);
  const participantRef = useRef(null);
  const roomIdRef = useRef(roomId);
  const languageRef = useRef(selectedLanguageCode);
  const audioSinkRef = useRef(null);

  const selectedLanguage =
    getSupportedLanguageByCode(selectedLanguageCode) ||
    getSupportedLanguageByCode(DEFAULT_LANGUAGE_CODE);
  const floor = roomInfo?.floor || activeTurn;
  const isJoined = Boolean(participant);
  const isMyTurn = Boolean(floor && participant?.identity === floor.identity);
  const isSomeoneSpeaking = Boolean(floor);
  const canStartTurn = isJoined && !isSomeoneSpeaking;
  const currentJoinUrl = useMemo(() => {
    if (!roomId) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }, [roomId]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    languageRef.current = selectedLanguage.code;
  }, [selectedLanguage.code]);

  useEffect(() => {
    participantRef.current = participant;
  }, [participant]);

  useEffect(() => {
    let cancelled = false;

    const checkAccess = async () => {
      try {
        await apiFetch("/api/pin/verify", { method: "POST" });
        if (!cancelled) setAccessState("unlocked");
      } catch (requestError) {
        if (cancelled) return;
        setAccessState("locked");
        if (requestError.status !== 401) {
          setPinError(requestError.message);
        }
      }
    };

    checkAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePinRejected = () => {
      clearStoredPin();
      setAccessState("locked");
    };

    window.addEventListener("app-pin-rejected", handlePinRejected);
    return () =>
      window.removeEventListener("app-pin-rejected", handlePinRejected);
  }, []);

  useEffect(() => {
    if (!roomId || accessState !== "unlocked") return undefined;

    let cancelled = false;
    const loadRoom = async () => {
      try {
        const data = await apiFetch(`/api/rooms/${roomId}`);
        if (!cancelled) {
          setRoomInfo(data.room);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
        }
      }
    };

    loadRoom();
    const intervalId = window.setInterval(loadRoom, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [roomId, accessState]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentParticipant = participantRef.current;
      const currentRoomId = roomIdRef.current;
      if (!currentParticipant || !currentRoomId) return;

      navigator.sendBeacon(
        `/api/rooms/${currentRoomId}/leave`,
        new Blob(
          [
            JSON.stringify({
              identity: currentParticipant.identity,
              // sendBeacon cannot set headers, so the PIN goes in the body.
              pin: getStoredPin(),
            }),
          ],
          { type: "application/json" },
        ),
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!participant || floor) return;

    roomRef.current?.localParticipant?.setMicrophoneEnabled(false);
  }, [floor, participant]);

  async function submitPin(event) {
    event.preventDefault();

    const pin = pinInput.trim();
    if (!pin) return;

    setPinError("");
    storePin(pin);

    try {
      await apiFetch("/api/pin/verify", { method: "POST" });
      setAccessState("unlocked");
      setPinInput("");
    } catch (requestError) {
      clearStoredPin();
      setPinError(
        requestError.status === 401
          ? "Incorrect PIN / Неверный ПИН-код"
          : requestError.message,
      );
    }
  }

  async function copyJoinLink() {
    if (!currentJoinUrl) return;

    await navigator.clipboard.writeText(currentJoinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function attachTranslatedTrack(track, publication, remoteParticipant) {
    if (
      track.kind !== Track.Kind.Audio ||
      remoteParticipant.identity !== getTranslatorIdentity(languageRef.current)
    ) {
      return;
    }

    const element = track.attach();
    element.autoplay = true;
    element.dataset.participant = remoteParticipant.identity;
    audioSinkRef.current?.appendChild(element);
  }

  function handleDataReceived(payload, remoteParticipant, kind, topic) {
    if (topic !== "transcription") return;

    try {
      const message = JSON.parse(new TextDecoder().decode(payload));
      if (message.language !== languageRef.current) return;

      setTranscripts((current) =>
        [
          {
            id: `${message.segmentId}-${message.timestamp}`,
            speaker: remoteParticipant?.identity || "translator",
            text: message.text,
            final: message.final,
            timestamp: message.timestamp,
          },
          ...current,
        ].slice(0, 8),
      );
    } catch (decodeError) {
      console.warn("Ignoring invalid transcription payload", decodeError);
    }
  }

  async function joinLiveKitRoom(targetRoomId) {
    const tokenData = await apiFetch(`/api/rooms/${targetRoomId}/token`, {
      method: "POST",
      body: JSON.stringify({
        languageCode: selectedLanguage.code,
      }),
    });

    const livekitRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: AUDIO_CAPTURE_OPTIONS,
    });

    livekitRoom.on(RoomEvent.TrackSubscribed, attachTranslatedTrack);
    livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
    });
    livekitRoom.on(RoomEvent.DataReceived, handleDataReceived);
    livekitRoom.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      setCanPlayAudio(livekitRoom.canPlaybackAudio);
    });
    livekitRoom.on(RoomEvent.Disconnected, () => {
      setConnectionState("disconnected");
    });

    await livekitRoom.connect(tokenData.livekitUrl, tokenData.token, {
      autoSubscribe: true,
    });

    await livekitRoom.startAudio().catch(() => {});

    roomRef.current = livekitRoom;
    setParticipant(tokenData.participant);
    setRoomInfo(tokenData.room);
    setConnectionState("connected");
  }

  async function startCall() {
    if (connectionState === "connecting") return;

    setError("");
    setCopied(false);
    setConnectionState("connecting");

    try {
      const data = await apiFetch("/api/rooms", { method: "POST" });
      await joinLiveKitRoom(data.roomId);

      setRoomId(data.roomId);

      const url = new URL(window.location.href);
      url.searchParams.set("room", data.roomId);
      window.history.pushState({}, "", url);
    } catch (requestError) {
      setConnectionState("idle");
      setError(requestError.message);
    }
  }

  async function joinRoom() {
    if (!roomId || connectionState === "connecting") return;

    setError("");
    setConnectionState("connecting");

    try {
      await joinLiveKitRoom(roomId);
    } catch (requestError) {
      setConnectionState("idle");
      setError(requestError.message);
    }
  }

  async function enableAudioPlayback() {
    try {
      await roomRef.current?.startAudio();
    } catch (playError) {
      console.warn("Audio playback is still blocked", playError);
    }
  }

  async function startTurn() {
    if (!participant || !roomRef.current) return;

    setError("");

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/turn/start`, {
        method: "POST",
        body: JSON.stringify({
          side: participant.side,
          identity: participant.identity,
        }),
      });

      setRoomInfo(data.room);
      setActiveTurn(data.floor);

      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(
          true,
          AUDIO_CAPTURE_OPTIONS,
        );
      } catch (micError) {
        await apiFetch(`/api/rooms/${roomId}/turn/end`, {
          method: "POST",
          body: JSON.stringify({
            turnId: data.floor.turnId,
            identity: participant.identity,
          }),
        }).catch(() => {});
        setActiveTurn(null);
        throw micError;
      }
    } catch (requestError) {
      if (requestError.status === 409 && requestError.data?.room) {
        setRoomInfo(requestError.data.room);
      }
      setError(requestError.message);
    }
  }

  async function endTurn() {
    if (!participant || !floor) return;

    setError("");
    await roomRef.current?.localParticipant?.setMicrophoneEnabled(false);

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/turn/end`, {
        method: "POST",
        body: JSON.stringify({
          turnId: floor.turnId,
          identity: participant.identity,
        }),
      });

      setRoomInfo(data.room);
      setActiveTurn(null);
    } catch (requestError) {
      if (requestError.data?.room) {
        setRoomInfo(requestError.data.room);
      }
      setActiveTurn(null);
      setError(requestError.message);
    }
  }

  async function leaveRoom() {
    const currentParticipant = participant;
    const currentRoom = roomRef.current;

    if (isMyTurn) {
      await endTurn();
    }

    await currentRoom?.disconnect();
    roomRef.current = null;
    audioSinkRef.current?.replaceChildren();

    if (currentParticipant) {
      await apiFetch(`/api/rooms/${roomId}/leave`, {
        method: "POST",
        body: JSON.stringify({ identity: currentParticipant.identity }),
      }).catch(() => {});
    }

    setParticipant(null);
    setConnectionState("idle");
    setTranscripts([]);
    setActiveTurn(null);
    setCanPlayAudio(true);
  }

  async function handleSpeakButton() {
    if (isMyTurn) {
      await endTurn();
      return;
    }

    await startTurn();
  }

  return (
    <main className="app-shell">
      <section className="top-bar" aria-label="Call setup">
        <div>
          <h1>Call Translator</h1>
        </div>
        <div className={`connection-pill ${connectionState}`}>
          <Radio size={18} />
          <span>{connectionState}</span>
        </div>
      </section>

      {error && accessState === "unlocked" ? (
        <div className="error-banner">{error}</div>
      ) : null}

      {accessState !== "unlocked" ? (
        accessState === "checking" ? null : (
          <section className="pin-panel" aria-label="PIN entry">
            <div>
              <h2>Enter PIN</h2>
            </div>
            <form onSubmit={submitPin}>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                aria-label="PIN code / ПИН-код"
                placeholder="••••"
                value={pinInput}
                onChange={(event) =>
                  setPinInput(event.target.value.replace(/\D/g, ""))
                }
              />
              <button
                type="submit"
                className="primary-action"
                disabled={!pinInput.trim()}
              >
                <KeyRound size={22} />
                Unlock
              </button>
            </form>
            {pinError ? <p className="pin-error">{pinError}</p> : null}
          </section>
        )
      ) : !roomId ? (
        <section className="start-panel">
          <div className="start-copy">
            <LanguageSelect
              id="landing-language"
              value={selectedLanguage.code}
              onChange={setSelectedLanguageCode}
            />
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={startCall}
            disabled={connectionState === "connecting"}
          >
            <Phone size={22} />
            Start Call
          </button>
        </section>
      ) : (
        <>
          <section className="share-row" aria-label="Share call">
            <div>
              <span className="label">Call</span>
              <strong>{roomId}</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={copyJoinLink}
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
              <span>{copied ? "Copied" : "Copy link"}</span>
            </button>
          </section>

          {!isJoined ? (
            <section className="start-panel" aria-label="Join call">
              <div className="start-copy">
                <LanguageSelect
                  id="join-language"
                  value={selectedLanguage.code}
                  onChange={setSelectedLanguageCode}
                />
              </div>
              <button
                type="button"
                className="primary-action"
                onClick={joinRoom}
                disabled={connectionState === "connecting"}
              >
                <Headphones size={22} />
                Join Call
              </button>
            </section>
          ) : (
            <section className="call-surface" aria-label="Call controls">
              {!canPlayAudio ? (
                <button
                  type="button"
                  className="primary-action enable-audio"
                  onClick={enableAudioPlayback}
                >
                  <Volume2 size={22} />
                  Enable sound
                </button>
              ) : null}
              <button
                type="button"
                className={`talk-button ${isMyTurn ? "speaking" : ""}`}
                onClick={handleSpeakButton}
                disabled={!isMyTurn && !canStartTurn}
              >
                {isMyTurn ? <MicOff size={34} /> : <Mic size={34} />}
                <span>
                  {isMyTurn ? "Done" : `Speak ${selectedLanguage.name}`}
                </span>
              </button>

              {floor && !isMyTurn ? (
                <p className="floor-note">
                  <Lock size={18} />
                  Someone else is speaking
                </p>
              ) : (
                <p className="floor-note">
                  <Headphones size={18} />
                  Microphone is off until you speak
                </p>
              )}

              <button
                type="button"
                className="leave-button"
                onClick={leaveRoom}
              >
                <PhoneOff size={20} />
                Leave
              </button>
            </section>
          )}

          <section className="transcript-panel" aria-label="Transcripts">
            <div className="section-heading">
              <h2>Transcript</h2>
              <span>{transcripts.length}</span>
            </div>
            {transcripts.length ? (
              <ol>
                {transcripts.map((item) => (
                  <li
                    key={item.id}
                    className={item.final ? "final" : "interim"}
                  >
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
  );
}

export default App;
