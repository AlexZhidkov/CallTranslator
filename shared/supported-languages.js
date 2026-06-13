export const DEFAULT_LANGUAGE_CODE = 'en'

export const SUPPORTED_LANGUAGES = [
  { name: 'Afrikaans', code: 'af' },
  { name: 'Akan', code: 'ak' },
  { name: 'Albanian', code: 'sq' },
  { name: 'Amharic', code: 'am' },
  { name: 'Arabic', code: 'ar' },
  { name: 'Armenian', code: 'hy' },
  { name: 'Azerbaijani', code: 'az' },
  { name: 'Basque', code: 'eu' },
  { name: 'Belarusian', code: 'be' },
  { name: 'Bengali', code: 'bn' },
  { name: 'Bulgarian', code: 'bg' },
  { name: 'Burmese (Myanmar)', code: 'my' },
  { name: 'Catalan', code: 'ca' },
  { name: 'Chinese (Simplified)', code: 'zh-Hans' },
  { name: 'Chinese (Traditional)', code: 'zh-Hant' },
  { name: 'Croatian', code: 'hr' },
  { name: 'Czech', code: 'cs' },
  { name: 'Danish', code: 'da' },
  { name: 'Dutch', code: 'nl' },
  { name: 'English', code: 'en' },
  { name: 'Estonian', code: 'et' },
  { name: 'Filipino', code: 'fil' },
  { name: 'Finnish', code: 'fi' },
  { name: 'French', code: 'fr' },
  { name: 'Galician', code: 'gl' },
  { name: 'Georgian', code: 'ka' },
  { name: 'German', code: 'de' },
  { name: 'Greek', code: 'el' },
  { name: 'Gujarati', code: 'gu' },
  { name: 'Hausa', code: 'ha' },
  { name: 'Hebrew', code: 'he' },
  { name: 'Hindi', code: 'hi' },
  { name: 'Hungarian', code: 'hu' },
  { name: 'Icelandic', code: 'is' },
  { name: 'Indonesian', code: 'id' },
  { name: 'Italian', code: 'it' },
  { name: 'Japanese', code: 'ja' },
  { name: 'Javanese', code: 'jv' },
  { name: 'Kannada', code: 'kn' },
  { name: 'Kazakh', code: 'kk' },
  { name: 'Khmer', code: 'km' },
  { name: 'Kinyarwanda', code: 'rw' },
  { name: 'Korean', code: 'ko' },
  { name: 'Lao', code: 'lo' },
  { name: 'Latvian', code: 'lv' },
  { name: 'Lithuanian', code: 'lt' },
  { name: 'Macedonian', code: 'mk' },
  { name: 'Malay', code: 'ms' },
  { name: 'Malayalam', code: 'ml' },
  { name: 'Marathi', code: 'mr' },
  { name: 'Mongolian', code: 'mn' },
  { name: 'Nepali', code: 'ne' },
  { name: 'Norwegian', code: 'no', aliases: ['nb'], displayCode: 'no, nb' },
  { name: 'Persian', code: 'fa' },
  { name: 'Polish', code: 'pl' },
  { name: 'Portuguese (Brazil)', code: 'pt-BR' },
  { name: 'Portuguese (Portugal)', code: 'pt-PT' },
  { name: 'Punjabi', code: 'pa' },
  { name: 'Romanian', code: 'ro' },
  { name: 'Russian', code: 'ru' },
  { name: 'Serbian', code: 'sr' },
  { name: 'Sindhi', code: 'sd' },
  { name: 'Sinhala', code: 'si' },
  { name: 'Slovak', code: 'sk' },
  { name: 'Slovenian', code: 'sl' },
  { name: 'Spanish', code: 'es' },
  { name: 'Sundanese', code: 'su' },
  { name: 'Swahili', code: 'sw' },
  { name: 'Swedish', code: 'sv' },
  { name: 'Tamil', code: 'ta' },
  { name: 'Telugu', code: 'te' },
  { name: 'Thai', code: 'th' },
  { name: 'Turkish', code: 'tr' },
  { name: 'Ukrainian', code: 'uk' },
  { name: 'Urdu', code: 'ur' },
  { name: 'Uzbek', code: 'uz' },
  { name: 'Vietnamese', code: 'vi' },
  { name: 'Zulu', code: 'zu' },
]

const CHINESE_TRADITIONAL_REGIONS = new Set(['HK', 'MO', 'TW'])
const CHINESE_SIMPLIFIED_REGIONS = new Set(['CN', 'MY', 'SG'])

function normalizeCode(code) {
  return String(code || '').trim().toLowerCase()
}

const SUPPORTED_LANGUAGE_BY_CODE = new Map()

for (const language of SUPPORTED_LANGUAGES) {
  for (const code of [language.code, ...(language.aliases || [])]) {
    SUPPORTED_LANGUAGE_BY_CODE.set(normalizeCode(code), language)
  }
}

function canonicalizeLocale(locale) {
  const value = String(locale || '').trim()
  if (!value) return ''

  try {
    return Intl.getCanonicalLocales(value)[0] || value
  } catch {
    return value
  }
}

function parseLocale(locale) {
  const canonical = canonicalizeLocale(locale)
  if (!canonical) {
    return { canonical: '', language: '', script: '', region: '' }
  }

  try {
    const parsed = new Intl.Locale(canonical)
    return {
      canonical,
      language: parsed.language || '',
      script: parsed.script || '',
      region: parsed.region || '',
    }
  } catch {
    const parts = canonical.split('-')
    return {
      canonical,
      language: parts[0] || '',
      script: parts[1]?.length === 4 ? parts[1] : '',
      region: parts.find((part) => part.length === 2 || part.length === 3) || '',
    }
  }
}

export function getSupportedLanguageByCode(code) {
  return SUPPORTED_LANGUAGE_BY_CODE.get(normalizeCode(code)) || null
}

export function getLanguageDisplayCode(language) {
  return language?.displayCode || language?.code || ''
}

export function resolveSupportedLanguageCode(preferredLanguages = []) {
  const candidates = Array.isArray(preferredLanguages)
    ? preferredLanguages
    : [preferredLanguages]

  for (const candidate of candidates) {
    const exactLanguage = getSupportedLanguageByCode(candidate)
    if (exactLanguage) return exactLanguage.code

    const { language, script, region } = parseLocale(candidate)
    if (!language) continue

    if (language === 'zh') {
      if (script === 'Hant' || CHINESE_TRADITIONAL_REGIONS.has(region)) {
        return 'zh-Hant'
      }
      if (script === 'Hans' || CHINESE_SIMPLIFIED_REGIONS.has(region)) {
        return 'zh-Hans'
      }
      continue
    }

    if (language === 'pt') {
      if (region === 'PT') return 'pt-PT'
      if (region === 'BR') return 'pt-BR'
      continue
    }

    const baseLanguage = getSupportedLanguageByCode(language)
    if (baseLanguage) return baseLanguage.code
  }

  return DEFAULT_LANGUAGE_CODE
}
