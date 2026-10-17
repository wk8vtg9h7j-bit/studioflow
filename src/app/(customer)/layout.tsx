import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { LanguageProvider, LanguageSwitcher } from "@/components/LanguageProvider";
import { SignOutButton } from "@/components/SignOutButton";
import "./customer.css";

export default async function CustomerLayout({children}:{children:React.ReactNode}) {
  const [profile,locale]=await Promise.all([requireRole("customer","/book"),getLocale()]);
  const vi=locale==="vi";
  const links=[
    {href:"/home",label:vi?"Trang chủ":"Home",symbol:"⌂"},
    {href:"/book",label:vi?"Đặt lớp":"Book",symbol:"▦"},
    {href:"/my-bookings",label:vi?"Lịch sử":"Activity",symbol:"◷"},
    {href:"/profile",label:vi?"Hồ sơ":"Profile",symbol:"◯"}
  ];
  return <LanguageProvider locale={locale}>
    <div className="customer-experience">
      <header className="customer-header"><div className="customer-header-inner">
        <Link className="customer-brand" href="/home">Studio<span style={{color:"#8b9d8a"}}>Flow</span></Link>
        <nav aria-label="Customer navigation" className="customer-desktop-nav">
          {links.map(link=><Link key={link.href} href={link.href}>{link.label}</Link>)}
          <Link href="/private">{vi?"Lịch riêng":"Private"}</Link>
          <Link href="/coaching">{vi?"Tiến độ":"My progress"}</Link>
          <Link href="/my-packages">{vi?"Gói tập":"Packages"}</Link>
        </nav>
        <div className="flex items-center gap-3"><span className="hidden text-sm text-stone-600 lg:block">{profile.full_name || profile.email}</span><LanguageSwitcher/><span className="hidden sm:inline"><SignOutButton label={vi?"Đăng xuất":"Sign out"}/></span></div>
      </div></header>
      <main className="customer-frame">{children}</main>
      <nav aria-label="Mobile customer navigation" className="customer-mobile-nav">
        {links.map(link=><Link key={link.href} href={link.href}><span aria-hidden="true" style={{fontSize:22,lineHeight:1.1}}>{link.symbol}</span><span>{link.label}</span></Link>)}
      </nav>
    </div>
  </LanguageProvider>;
}