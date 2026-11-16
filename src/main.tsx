import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { isDemo } from './lib/supabase'
import { registerServiceWorker } from './lib/push'

// The real app can be installed on a phone and receive notifications.
if (!isDemo) registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
