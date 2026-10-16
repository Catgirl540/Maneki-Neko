import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/global.css'
import './styles/workbench.css'
// 公式（KaTeX）的样式与字体。放在入口而不是 Markdown 组件里：
// 组件要被 Node 侧的检查脚本直接 import，而 Node 不认识 CSS 导入。
import 'katex/dist/katex.min.css'

import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)