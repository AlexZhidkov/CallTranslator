export const DEFAULT_LANGUAGE_CODE = 'en'

export const SUPPORTED_LANGUAGES = [
  { name: 'Afrikaans', code: 'af' },
  { name: 'Akan', code: 'ak' },
  { name: 'Shqip', code: 'sq' },
  { name: 'አማርኛ', code: 'am' },
  { name: 'العربية', code: 'ar' },
  { name: 'Հայերեն', code: 'hy' },
  { name: 'Azərbaycanca', code: 'az' },
  { name: 'Euskara', code: 'eu' },
  { name: 'Беларуская', code: 'be' },
  { name: 'বাংলা', code: 'bn' },
  { name: 'Български', code: 'bg' },
  { name: 'မြန်မာ', code: 'my' },
  { name: 'Català', code: 'ca' },
  { name: '简体中文', code: 'zh-Hans' },
  { name: '繁體中文', code: 'zh-Hant' },
  { name: 'Hrvatski', code: 'hr' },
  { name: 'Čeština', code: 'cs' },
  { name: 'Dansk', code: 'da' },
  { name: 'Nederlands', code: 'nl' },
  { name: 'English', code: 'en' },
  { name: 'Eesti', code: 'et' },
  { name: 'Filipino', code: 'fil' },
  { name: 'Suomi', code: 'fi' },
  { name: 'Français', code: 'fr' },
  { name: 'Galego', code: 'gl' },
  { name: 'ქართული', code: 'ka' },
  { name: 'Deutsch', code: 'de' },
  { name: 'Ελληνικά', code: 'el' },
  { name: 'ગુજરાતી', code: 'gu' },
  { name: 'Hausa', code: 'ha' },
  { name: 'עברית', code: 'he' },
  { name: 'हिन्दी', code: 'hi' },
  { name: 'Magyar', code: 'hu' },
  { name: 'Íslenska', code: 'is' },
  { name: 'Bahasa Indonesia', code: 'id' },
  { name: 'Italiano', code: 'it' },
  { name: '日本語', code: 'ja' },
  { name: 'Basa Jawa', code: 'jv' },
  { name: 'ಕನ್ನಡ', code: 'kn' },
  { name: 'Қазақ тілі', code: 'kk' },
  { name: 'ខ្មែរ', code: 'km' },
  { name: 'Ikinyarwanda', code: 'rw' },
  { name: '한국어', code: 'ko' },
  { name: 'ລາວ', code: 'lo' },
  { name: 'Latviešu', code: 'lv' },
  { name: 'Lietuvių', code: 'lt' },
  { name: 'Македонски', code: 'mk' },
  { name: 'Bahasa Melayu', code: 'ms' },
  { name: 'മലയാളം', code: 'ml' },
  { name: 'मराठी', code: 'mr' },
  { name: 'Монгол', code: 'mn' },
  { name: 'नेपाली', code: 'ne' },
  { name: 'Norsk', code: 'no', aliases: ['nb'], displayCode: 'no, nb' },
  { name: 'فارسی', code: 'fa' },
  { name: 'Polski', code: 'pl' },
  { name: 'Português (Brasil)', code: 'pt-BR' },
  { name: 'Português (Portugal)', code: 'pt-PT' },
  { name: 'ਪੰਜਾਬੀ', code: 'pa' },
  { name: 'Română', code: 'ro' },
  { name: 'Русский', code: 'ru' },
  { name: 'Српски', code: 'sr' },
  { name: 'سنڌي', code: 'sd' },
  { name: 'සිංහල', code: 'si' },
  { name: 'Slovenčina', code: 'sk' },
  { name: 'Slovenščina', code: 'sl' },
  { name: 'Español', code: 'es' },
  { name: 'Basa Sunda', code: 'su' },
  { name: 'Kiswahili', code: 'sw' },
  { name: 'Svenska', code: 'sv' },
  { name: 'தமிழ்', code: 'ta' },
  { name: 'తెలుగు', code: 'te' },
  { name: 'ไทย', code: 'th' },
  { name: 'Türkçe', code: 'tr' },
  { name: 'Українська', code: 'uk' },
  { name: 'اردو', code: 'ur' },
  { name: 'O‘zbek', code: 'uz' },
  { name: 'Tiếng Việt', code: 'vi' },
  { name: 'isiZulu', code: 'zu' },
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
