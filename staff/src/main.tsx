import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/global.css'
// 公式样式：Markdown 渲染走 rehype-katex，不引这份 css 数学式会裸排
import 'katex/dist/katex.min.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
