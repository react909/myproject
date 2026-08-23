let audioCtx: AudioContext | null = null

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

/** Короткий мягкий сигнал (не раздражающий). */
export function playNotificationSound(kind: 'default' | 'error' = 'default') {
  try {
    const ctx = getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = kind === 'error' ? 500 : 600
    gain.gain.value = 0.0001
    const t = ctx.currentTime
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.start(t)
    osc.stop(t + 0.5)
  } catch {
    /* autoplay policy */
  }
}
