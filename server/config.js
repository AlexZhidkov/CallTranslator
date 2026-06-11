export function getLiveKitConfig(env = process.env) {
  const livekitUrl = env.LIVEKIT_URL || env.NEXT_PUBLIC_LIVEKIT_URL
  const apiKey = env.LIVEKIT_API_KEY
  const apiSecret = env.LIVEKIT_API_SECRET

  if (!livekitUrl || !apiKey || !apiSecret) {
    const error = new Error(
      'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
    )
    error.statusCode = 500
    throw error
  }

  return {
    livekitUrl,
    apiKey,
    apiSecret,
  }
}

export function getGeminiConfig(env = process.env) {
  if (!env.GEMINI_API_KEY) {
    const error = new Error('Gemini is not configured. Set GEMINI_API_KEY.')
    error.statusCode = 500
    throw error
  }

  return {
    apiKey: env.GEMINI_API_KEY,
  }
}
