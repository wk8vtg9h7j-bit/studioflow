import Link from "next/link";
const groups=[
 {title:"Bookings & scheduling",items:[["Classes & timetable","/admin/sessions"],["Studios","/admin/studios"],["Class types","/admin/class-types"],["Instructors","/admin/instructors"]]},
 {title:"Customers & growth",items:[["Customers","/admin/customers"],["Marketing","/admin/marketing"],["Follow-ups","/admin/follow-ups"],["Packages","/admin/packages"]]},
 {title:"Finance & settings",items:[["Payments","/admin/payments"],["Payroll","/admin/payroll"],["Pay rules","/admin/pay-rules"],["Products","/admin/products"]]}
] as const;
export default function AdminManagePage(){
 return <main className="mx-auto max-w-4xl space-y-6 pb-16">
 <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Admin tools</p>
 <h1 className="mt-1 text-2xl font-semibold">Manage Studioflow</h1>
 <p className="mt-2 text-sm text-ink-muted">Everything organized into three areas. Daily bookings and private requests stay in the main navigation.</p></div>
 {groups.map(group=><section key={group.title} className="space-y-2">
 <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{group.title}</h2>
 <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
 {group.items.map(([label,href])=><Link key={href} href={href} className="card flex min-h-14 items-center justify-between gap-2 px-4 py-3 text-sm font-medium transition hover:border-stone-400">{label}<span aria-hidden="true">→</span></Link>)}
 </div></section>)}
 </main>;
}