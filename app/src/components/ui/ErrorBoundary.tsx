import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { AlertIcon } from './icons'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 错误边界。
 *
 * 渲染期抛出的异常（哪怕只是一个 undefined.replace）会让 React 卸载整棵组件树，
 * 用户看到的是一片纯白 —— 既不知道发生了什么，也没有出口。
 * 这里至少把错误原话摆出来，并给出三条恢复路径。
 *
 * 放这一层的理由：纯前端 + localStorage 的项目里，「本地数据过期」是会反复发生的
 * 正常故障，而不是异常。任何一个字段没做兼容都不该等于白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留在 console，方便直接定位到组件栈
    console.error('[luckycat] 页面渲染失败：', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      // 出错页刻意不给金色主按钮：金按钮在这套系统里代表「推荐的正向动作」，
      // 而这里的按钮全是补救措施，不该抢视觉重心。
      <div className="flex min-h-svh items-center justify-center bg-paper p-10">
        <Card padded={false} className="w-full max-w-[560px] p-8">
          <span className="grid size-11 place-items-center rounded-tile bg-coral-wash text-coral">
            <AlertIcon size={22} />
          </span>

          <h1 className="mt-4 text-[20px] leading-7 font-semibold text-ink">页面出错了</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            渲染这个页面时抛了异常。原话在下面 —— 复制下来就能定位。
          </p>

          <pre className="mt-4 overflow-x-auto rounded-field border border-line bg-sunk p-4 text-[12px] leading-relaxed whitespace-pre-wrap text-coral">
            {error.message}
          </pre>

          <div className="mt-6 flex flex-wrap gap-3">
            {/* 「总览」在 `/dashboard`：`/` 是公开的官网首页，跳过去等于没回到应用里 */}
            <Button onClick={() => window.location.assign('/dashboard')}>回到总览</Button>
            <Button onClick={() => window.location.reload()}>重新加载</Button>
            <Button
              variant="ghost"
              onClick={() => {
                // 清掉的是**业务数据**（localStorage）。登录态在 sessionStorage 里，
                // 故意不动它——用户只是想从坏数据里恢复，没必要顺带把他登出。
                window.localStorage.clear()
                window.location.assign('/dashboard')
              }}
            >
              重置演示数据
            </Button>
          </div>

          <p className="mt-5 text-[12px] leading-relaxed text-ink-mute">
            如果刚刚更新过版本，多半是本地存的模拟库还是旧结构 ——
            「重置演示数据」会清掉它并按新结构重新播种。
          </p>
        </Card>
      </div>
    )
  }
}
