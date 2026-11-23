import { createRoot } from 'react-dom/client'
import { Landing, publicSetupUrl } from './landing'

createRoot(document.getElementById('root')!).render(
  <Landing onEnter={() => window.location.assign(publicSetupUrl())} />,
)
