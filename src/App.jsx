import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
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
  Share2,
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
import {
  createTranslator,
  getUiLocaleDirection,
  resolveUiLocale,
} from "./i18n.js";
import "./App.css";

const AUDIO_CAPTURE_OPTIONS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const PIN_STORAGE_KEY = "call-translator-pin";
const ROOM_NOT_FOUND_MESSAGE = "Room not found";
const TRANSCRIPT_LIMIT = 8;

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

function isRoomNotFoundError(error) {
  return (
    error?.status === 404 &&
    (error.message === ROOM_NOT_FOUND_MESSAGE ||
      error.data?.error === ROOM_NOT_FOUND_MESSAGE)
  );
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

function upsertTranscript(current, nextItem) {
  const existingIndex = current.findIndex((item) => item.id === nextItem.id);

  if (existingIndex === -1) {
    return [nextItem, ...current].slice(0, TRANSCRIPT_LIMIT);
  }

  const existing = current[existingIndex];
  const keepFinalText = existing.final && !nextItem.final;
  const merged = {
    ...existing,
    ...nextItem,
    text: keepFinalText ? existing.text : nextItem.text,
    final: existing.final || nextItem.final,
    timestamp: Math.max(existing.timestamp, nextItem.timestamp),
  };
  const withoutExisting = current.filter((item) => item.id !== nextItem.id);

  return [merged, ...withoutExisting].slice(0, TRANSCRIPT_LIMIT);
}

function getTranscriptClassName(item, participant) {
  const classes = [item.final ? "final" : "interim"];

  classes.push(
    item.speakerIdentity === participant?.identity ? "mine" : "theirs",
  );

  return classes.join(" ");
}

function LanguageSelect({ id, label, value, onChange, disabled = false }) {
  return (
    <label className="language-select" htmlFor={id}>
      <span>{label}</span>
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
  const [speechWarning, setSpeechWarning] = useState(false);
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
  const uiLocale = resolveUiLocale(selectedLanguage.code);
  const t = useMemo(
    () => createTranslator(selectedLanguage.code),
    [selectedLanguage.code],
  );
  const floor = roomInfo?.floor || activeTurn;
  const isJoined = Boolean(participant);
  const roomParticipants = Array.isArray(roomInfo?.participants)
    ? roomInfo.participants
    : [];
  const otherParticipants = participant
    ? roomParticipants.filter(
        (roomParticipant) => roomParticipant.identity !== participant.identity,
      )
    : [];
  const hasConversationPartner = otherParticipants.length > 0;
  const isMyTurn = Boolean(floor && participant?.identity === floor.identity);
  const isSomeoneSpeaking = Boolean(floor);
  const canStartTurn = isJoined && hasConversationPartner && !isSomeoneSpeaking;
  const canShareJoinUrl =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareButtonLabel = copied
    ? t("call.copied")
    : canShareJoinUrl
      ? t("call.share")
      : t("call.copyLink");
  const speakButtonLabel = isMyTurn
    ? t("call.done")
    : t("call.speakLanguage", { language: selectedLanguage.name });
  const currentJoinUrl = useMemo(() => {
    if (!roomId) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }, [roomId]);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    document.documentElement.dir = getUiLocaleDirection(uiLocale);
    document.title = t("app.title");
  }, [t, uiLocale]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    languageRef.current = selectedLanguage.code;
  }, [selectedLanguage.code]);

  useEffect(() => {
    participantRef.current = participant;
  }, [participant]);

  const resetToStartPage = useCallback(async () => {
    const currentRoom = roomRef.current;
    roomRef.current = null;
    audioSinkRef.current?.replaceChildren();

    try {
      await currentRoom?.disconnect();
    } catch (disconnectError) {
      console.warn("Failed to disconnect from missing room", disconnectError);
    }

    window.history.replaceState({}, "", window.location.pathname);

    setRoomId("");
    setRoomInfo(null);
    setParticipant(null);
    setConnectionState("idle");
    setActiveTurn(null);
    setTranscripts([]);
    setSpeechWarning(false);
    setCopied(false);
    setError("");
    setCanPlayAudio(true);
  }, []);

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
          if (isRoomNotFoundError(requestError)) {
            await resetToStartPage();
            return;
          }

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
  }, [roomId, accessState, resetToStartPage]);

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
        requestError.status === 401 ? t("pin.incorrect") : requestError.message,
      );
    }
  }

  async function copyJoinLink() {
    if (!currentJoinUrl) return;

    await navigator.clipboard.writeText(currentJoinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareJoinLink() {
    if (!currentJoinUrl) return;

    if (!canShareJoinUrl) {
      await copyJoinLink();
      return;
    }

    try {
      await navigator.share({
        title: t("app.title"),
        text: t("share.text"),
        url: currentJoinUrl,
      });
    } catch (shareError) {
      if (shareError?.name === "AbortError") return;
      await copyJoinLink();
    }
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
      if (message.type === "no_speech_detected") {
        if (message.speakerIdentity === participantRef.current?.identity) {
          setSpeechWarning(true);
        }
        return;
      }

      if (message.type !== "transcription" || !message.text) return;
      const speakerIdentity =
        message.speakerIdentity || remoteParticipant?.identity || "";
      const isLocalSpeaker =
        speakerIdentity === participantRef.current?.identity;
      if (message.transcriptSource === "input" && !isLocalSpeaker) return;
      if (message.transcriptSource === "output" && isLocalSpeaker) return;
      if (message.language !== languageRef.current) return;

      const timestamp = Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now();
      const segmentId =
        message.segmentId ||
        `${message.language}-${message.speakerIdentity || "unknown"}-${timestamp}`;

      setTranscripts((current) =>
        upsertTranscript(current, {
          id: segmentId,
          speakerIdentity,
          text: message.text,
          final: Boolean(message.final),
          language: message.language,
          transcriptSource: message.transcriptSource || "output",
          timestamp,
        }),
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
      if (isRoomNotFoundError(requestError)) {
        await resetToStartPage();
        return;
      }

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
      if (isRoomNotFoundError(requestError)) {
        await resetToStartPage();
        return;
      }

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
    setSpeechWarning(false);

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/turn/start`, {
        method: "POST",
        body: JSON.stringify({
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
      if (isRoomNotFoundError(requestError)) {
        await resetToStartPage();
        return;
      }

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
      if (isRoomNotFoundError(requestError)) {
        await resetToStartPage();
        return;
      }

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
    setSpeechWarning(false);
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
      <section className="top-bar" aria-label={t("call.setupLabel")}>
        <div>
          <h1>{t("app.title")}</h1>
        </div>
        <div className={`connection-pill ${connectionState}`}>
          <Radio size={18} />
          <span>{t(`connection.${connectionState}`)}</span>
        </div>
      </section>

      {error && accessState === "unlocked" ? (
        <div className="error-banner">{error}</div>
      ) : null}

      {accessState !== "unlocked" ? (
        accessState === "checking" ? null : (
          <section className="pin-panel" aria-label={t("pin.sectionLabel")}>
            <div>
              <h2>{t("pin.title")}</h2>
            </div>
            <form onSubmit={submitPin}>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                aria-label={t("pin.inputLabel")}
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
                {t("pin.unlock")}
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
              label={t("languageSelect.label")}
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
            {t("call.start")}
          </button>
        </section>
      ) : (
        <>
          <section
            className="share-row"
            aria-label={t("call.shareSectionLabel")}
          >
            <div>
              <span className="label">{t("call.roomLabel")}</span>
              <strong>{roomId}</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={shareJoinLink}
            >
              {copied ? (
                <Check size={20} />
              ) : canShareJoinUrl ? (
                <Share2 size={20} />
              ) : (
                <Copy size={20} />
              )}
              <span>{shareButtonLabel}</span>
            </button>
          </section>

          {!isJoined ? (
            <section
              className="start-panel"
              aria-label={t("call.joinSectionLabel")}
            >
              <div className="start-copy">
                <LanguageSelect
                  id="join-language"
                  label={t("languageSelect.label")}
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
                {t("call.join")}
              </button>
            </section>
          ) : (
            <section
              className="call-surface"
              aria-label={t("call.controlsLabel")}
            >
              {!canPlayAudio ? (
                <button
                  type="button"
                  className="primary-action enable-audio"
                  onClick={enableAudioPlayback}
                >
                  <Volume2 size={22} />
                  {t("call.enableSound")}
                </button>
              ) : null}
              <div
                className={`participant-status ${
                  hasConversationPartner ? "ready" : "waiting"
                }`}
                role="status"
                aria-live="polite"
              >
                {hasConversationPartner ? (
                  <Check size={20} />
                ) : (
                  <Headphones size={20} />
                )}
                <span>
                  {hasConversationPartner
                    ? t("call.readyForConversation")
                    : t("call.waitingForParticipant")}
                </span>
              </div>
              <button
                type="button"
                className={`talk-button ${isMyTurn ? "speaking" : ""}`}
                onClick={handleSpeakButton}
                disabled={!isMyTurn && !canStartTurn}
              >
                {isMyTurn ? <MicOff size={34} /> : <Mic size={34} />}
                <span>{speakButtonLabel}</span>
              </button>

              {!hasConversationPartner ? (
                <p className="floor-note">
                  <Headphones size={18} />
                  {t("call.shareAndWait")}
                </p>
              ) : floor && !isMyTurn ? (
                <p className="floor-note">
                  <Lock size={18} />
                  {t("call.someoneSpeaking")}
                </p>
              ) : (
                <p className="floor-note">
                  <Headphones size={18} />
                  {t("call.microphoneOff")}
                </p>
              )}

              {speechWarning ? (
                <p className="speech-warning">
                  <AlertCircle size={18} />
                  {t("call.speechNotDetected")}
                </p>
              ) : null}

              <button
                type="button"
                className="leave-button"
                onClick={leaveRoom}
              >
                <PhoneOff size={20} />
                {t("call.leave")}
              </button>
            </section>
          )}

          {transcripts.length > 0 ? (
            <section
              className="transcript-panel"
              aria-label={t("transcript.sectionLabel")}
            >
              <div className="section-heading">
                <h2>{t("transcript.title")}</h2>
                <span>{transcripts.length}</span>
              </div>
              <ol>
                {transcripts.map((item) => {
                  return (
                    <li
                      key={item.id}
                      className={getTranscriptClassName(item, participant)}
                    >
                      <p>{item.text}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </>
      )}

      <div ref={audioSinkRef} className="audio-sink" aria-hidden="true" />
    </main>
  );
}

export default App;
