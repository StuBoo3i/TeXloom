import { createRoot } from 'react-dom/client'
import { Landing } from './landing'

createRoot(document.getElementById('root')!).render(
  <Landing onEnter={() => window.location.assign('https://github.com/StuBoo3i/TeXloom#部署与启动windows-本机')} />,
)
