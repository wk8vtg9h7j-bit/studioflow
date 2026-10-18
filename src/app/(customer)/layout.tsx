import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { LanguageProvider, LanguageSwitcher } from "@/components/LanguageProvider";
import { SignOutButton } from "@/components/SignOutButton";
import "./customer.css";
import {createClient,createServiceClient} from "@/lib/supabase/server";

export default async function CustomerLayout({children}:{children:React.ReactNode}) {
  const [profile,locale]=await Promise.all([requireRole("customer","/book"),getLocale()]);
  const vi=locale==="vi";
  // Signup metadata is a user preference, not an authorization claim.
  const auth = await createClient();
  const {data:{user}} = await auth.auth.getUser();
  const slug = user?.user_metadata?.preferred_studio_slug;
  if (typeof slug === "string" && ["downtown-pilates","hideaway-pilates","an-thuong-pilates"].includes(slug)) {
    const svc = createServiceClient();
    const {data:studio} = await svc.from("studios").select("id").eq("slug",slug).maybeSingle();
    if (studio) await svc.from("customers").update({preferred_studio_id:studio.id}).eq("profile_id",profile.id).is("preferred_studio_id",null);
  }
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
          <Link href="/studios">{vi?"Studio":"Studios"}</Link><Link href="/private">{vi?"Lịch riêng":"Private"}</Link>
          <Link href="/coaching">{vi?"Tiến độ":"My progress"}</Link>
          <Link href="/my-packages">{vi?"Gói tập":"Packages"}</Link>
        </nav>
        <div className="customer-account-actions"><div className="customer-account-info"><span className="customer-account-name">{profile.full_name || (vi?"Tài khoản":"My account")}</span><span className="customer-account-email" title={profile.email ?? ""}>{profile.email || ""}</span></div><LanguageSwitcher/><span className="customer-logout"><SignOutButton label={vi?"Đăng xuất":"Sign out"}/></span></div>
      </div></header>
      <main className="customer-frame">{children}</main>
      <div className="customer-mobile-quicklinks"><Link href="/coaching">{vi?"Tiến độ tập luyện":"My progress"}</Link><Link href="/my-packages">{vi?"Gói tập":"Packages"}</Link><Link href="/studios">{vi?"Studio":"Studios"}</Link><Link href="/private">{vi?"Lịch riêng":"Private"}</Link></div>
      <nav aria-label="Mobile customer navigation" className="customer-mobile-nav">
        {links.map(link=><Link key={link.href} href={link.href}><span aria-hidden="true" style={{fontSize:22,lineHeight:1.1}}>{link.symbol}</span><span>{link.label}</span></Link>)}
      </nav>
    </div>
  </LanguageProvider>;
}