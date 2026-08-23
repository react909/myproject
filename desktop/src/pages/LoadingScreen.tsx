import './LoadingScreen.css'

type LoadingScreenProps = {
  title: string
  subtitle?: string
}

export function LoadingScreen({ title, subtitle }: LoadingScreenProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__spinner" aria-hidden />
      <p className="loading-screen__title">{title}</p>
      {subtitle ? <p className="loading-screen__sub">{subtitle}</p> : null}
    </div>
  )
}
