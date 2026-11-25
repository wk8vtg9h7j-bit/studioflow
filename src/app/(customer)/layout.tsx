import Link from "next/link";
import { redirect } from "next/navigation";
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
  // A Google sign-in skips signUpAction, so these members arrive with no phone
  // number and reception cannot reach them. Collect it once before the app is
  // usable. /complete-profile sits outside this route group on purpose, so this
  // redirect cannot loop. Email/password members are untouched: signUpAction has
  // always required a phone, and pre-0012 accounts without one are left alone.
  const authProviders = user?.app_metadata?.providers ?? user?.app_metadata?.provider;
  const usedGoogle = Array.isArray(authProviders)
    ? authProviders.includes("google")
    : authProviders === "google";
  if (usedGoogle && !profile.phone) redirect("/complete-profile");
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
          <Link href="/home">{vi?"Trang chủ":"Home"}</Link>
          <Link href="/book">{vi?"Lớp nhóm":"Group classes"}</Link>
          <Link href="/private">{vi?"Buổi riêng":"Private"}</Link>
          <Link href="/my-bookings">{vi?"Lịch sử":"Activity"}</Link>
          <details className="customer-nav-more">
            <summary>{vi?"Thêm":"More"} <span aria-hidden="true">⌄</span></summary>
            <div className="customer-nav-more-panel">
              <Link href="/profile">{vi?"Hồ sơ":"Profile"}</Link>
              <Link href="/studios">{vi?"Studio":"Studios"}</Link>
              <Link href="/coaching">{vi?"Tiến độ":"My progress"}</Link>
              <Link href="/my-packages">{vi?"Gói tập":"Packages"}</Link>
            </div>
          </details>
        </nav>
        <div className="customer-account-actions"><div className="customer-account-info"><span className="customer-account-name">{profile.full_name || (vi?"Tài khoản":"My account")}</span><span className="customer-account-email" title={profile.email ?? ""}>{profile.email || ""}</span></div><LanguageSwitcher/><span className="customer-logout"><SignOutButton label={vi?"Đăng xuất":"Log out"}/></span></div>
      </div></header>
      <div className="customer-mobile-quicklinks"><Link href="/coaching">{vi?"Tiến độ tập luyện":"My progress"}</Link><Link href="/my-packages">{vi?"Gói tập":"Packages"}</Link><Link href="/studios">{vi?"Studio":"Studios"}</Link><Link href="/private">{vi?"Lịch riêng":"Private"}</Link></div>
      <main className="customer-frame">{children}</main>
      <nav aria-label="Mobile customer navigation" className="customer-mobile-nav">
        {links.map(link=><Link key={link.href} href={link.href}><span aria-hidden="true" style={{fontSize:22,lineHeight:1.1}}>{link.symbol}</span><span>{link.label}</span></Link>)}
      </nav>
    </div>
  </LanguageProvider>;
}