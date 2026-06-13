export const DEFAULT_UI_LOCALE = "en";

export const UI_LOCALES = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
];

export const UI_TRANSLATIONS = {
  en: {
    app: {
      title: "Call Translator",
    },
    connection: {
      idle: "Idle",
      connecting: "Connecting",
      connected: "Connected",
      disconnected: "Disconnected",
    },
    languageSelect: {
      label: "Your language",
    },
    pin: {
      sectionLabel: "PIN entry",
      title: "Enter PIN",
      inputLabel: "PIN code",
      incorrect: "Incorrect PIN",
      unlock: "Unlock",
    },
    call: {
      setupLabel: "Call setup",
      start: "Start Call",
      shareSectionLabel: "Share call",
      roomLabel: "Call",
      copied: "Copied",
      share: "Share",
      copyLink: "Copy link",
      joinSectionLabel: "Join call",
      join: "Join Call",
      controlsLabel: "Call controls",
      enableSound: "Enable sound",
      modeLabel: "Conversation mode",
      modeFloor: "Tap to speak",
      modeFreeFlow: "Free flow",
      waitingForParticipant: "Waiting for another participant to join",
      readyForConversation: "Ready for conversation",
      done: "Done",
      mute: "Turn mic off",
      unmute: "Turn mic on",
      speakLanguage: "Speak",
      shareAndWait: "Share the call link and wait",
      someoneSpeaking: "Someone else is speaking",
      microphoneOff: "Microphone is off until you speak",
      freeFlowMicOn: "Microphone is on for free-flow conversation",
      freeFlowMicOff: "Microphone is off; turn it on when you want to speak",
      speechNotDetected: "Message not detected - please say again.",
      leave: "Leave",
    },
    share: {
      text: "Join this call.",
    },
    transcript: {
      sectionLabel: "Transcripts",
      title: "Transcript",
      empty: "Translated speech will appear here.",
      you: "You",
    },
  },
  ru: {
    app: {
      title: "Переводчик разговоров",
    },
    connection: {
      idle: "Ожидание",
      connecting: "Подключение",
      connected: "Подключено",
      disconnected: "Отключено",
    },
    languageSelect: {
      label: "Ваш язык",
    },
    pin: {
      sectionLabel: "Ввод PIN-кода",
      title: "Введите PIN-код",
      inputLabel: "PIN-код",
      incorrect: "Неверный PIN-код",
      unlock: "Разблокировать",
    },
    call: {
      setupLabel: "Настройка разговора",
      start: "Начать разговор",
      shareSectionLabel: "Поделиться ссылкой",
      roomLabel: "Разговор",
      copied: "Скопировано",
      share: "Поделиться",
      copyLink: "Скопировать ссылку",
      joinSectionLabel: "Присоединиться к разговору",
      join: "Присоединиться",
      controlsLabel: "Управление разговором",
      enableSound: "Включить звук",
      modeLabel: "Режим разговора",
      modeFloor: "Говорить по очереди",
      modeFreeFlow: "Свободный разговор",
      waitingForParticipant: "Ожидание собеседника",
      readyForConversation: "Можно начинать разговор",
      done: "Готово",
      mute: "Выключить микрофон",
      unmute: "Включить микрофон",
      speakLanguage: "Говорите",
      shareAndWait: "Поделитесь ссылкой и подождите",
      someoneSpeaking: "Говорит другой участник",
      microphoneOff: "Микрофон выключен, пока вы не начнете говорить",
      freeFlowMicOn: "Микрофон включен для свободного разговора",
      freeFlowMicOff: "Микрофон выключен; включите его, чтобы говорить",
      speechNotDetected: "Речь не распознана - повторите, пожалуйста.",
      leave: "Выйти",
    },
    share: {
      text: "Присоединитесь к этому разговору.",
    },
    transcript: {
      sectionLabel: "Текст",
      title: "Текст",
      empty: "Здесь появится переведенная речь.",
      speaker: "Собеседник",
      you: "Вы",
    },
  },
};

const DEFAULT_MESSAGES = UI_TRANSLATIONS[DEFAULT_UI_LOCALE];
const UI_LOCALE_BY_CODE = new Map(
  UI_LOCALES.map((locale) => [normalizeLocaleCode(locale.code), locale]),
);

function normalizeLocaleCode(locale) {
  return String(locale || "")
    .trim()
    .toLowerCase();
}

function canonicalizeLocale(locale) {
  const value = String(locale || "").trim();
  if (!value) return "";

  try {
    return Intl.getCanonicalLocales(value)[0] || value;
  } catch {
    return value;
  }
}

function getLocaleCandidates(locale) {
  const canonical = canonicalizeLocale(locale);
  if (!canonical) return [];

  const candidates = [canonical];
  const baseLanguage = canonical.split("-")[0];
  if (baseLanguage && baseLanguage !== canonical) {
    candidates.push(baseLanguage);
  }

  return candidates;
}

function getUiLocale(locale) {
  return UI_LOCALE_BY_CODE.get(normalizeLocaleCode(locale)) || null;
}

function hasTranslationMessages(locale) {
  const uiLocale = getUiLocale(locale);
  return Boolean(uiLocale && UI_TRANSLATIONS[uiLocale.code]);
}

function getMessage(messages, key) {
  return key
    .split(".")
    .reduce((current, keyPart) => current?.[keyPart], messages);
}

function interpolate(template, values = {}) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    values[key] == null ? "" : String(values[key]),
  );
}

export function getUiLocaleDirection(locale) {
  return (
    getUiLocale(locale)?.dir || getUiLocale(DEFAULT_UI_LOCALE)?.dir || "ltr"
  );
}

export function resolveUiLocale(preferredLocales = []) {
  const locales = Array.isArray(preferredLocales)
    ? preferredLocales
    : [preferredLocales];

  for (const locale of locales) {
    for (const candidate of getLocaleCandidates(locale)) {
      const uiLocale = getUiLocale(candidate);
      if (uiLocale && hasTranslationMessages(uiLocale.code)) {
        return uiLocale.code;
      }
    }
  }

  return DEFAULT_UI_LOCALE;
}

export function createTranslator(locale) {
  const messages = UI_TRANSLATIONS[resolveUiLocale(locale)] || DEFAULT_MESSAGES;

  return (key, values) => {
    const message =
      getMessage(messages, key) ?? getMessage(DEFAULT_MESSAGES, key) ?? key;

    return typeof message === "string" ? interpolate(message, values) : key;
  };
}
