import brandCat from '../../assets/design/brand-cat.png'
import supportCat from '../../assets/design/support-cat.png'

/** 用户导出稿中的原始品牌资源，不依赖 OpenDesign 本地服务。 */
export function WorkbenchBrand({ compact = false }: { compact?: boolean }) {
  return <span className="workbench-brand">
    <img src={brandCat} alt="" width="38" height="38" />
    {!compact && <span>招财猫银行<small>MONEY MEOW BANK</small></span>}
  </span>
}

export function SupportCat({ className = '' }: { className?: string }) {
  return <img src={supportCat} alt="" className={className} width="112" height="112" />
}
