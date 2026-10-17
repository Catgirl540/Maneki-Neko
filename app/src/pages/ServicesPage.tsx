import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { serviceGroups } from '@/components/layout/navigation'



export function ServicesPage() {
  return <div className="page-stack"><PageHeader title="全部服务" />
    <div className="service-directory">{serviceGroups.map(group => <section key={group.title}>
      <h2>{group.title}</h2>{group.items.map(({ to, label, Icon }) => <Link key={to} to={to}><Icon size={19} /><span>{label}</span><span aria-hidden="true">↗</span></Link>)}
    </section>)}</div>
  </div>
}
