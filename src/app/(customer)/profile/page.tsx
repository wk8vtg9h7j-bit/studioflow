import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { saveCustomerProfile } from "./actions";

export default async function CustomerProfile({searchParams}:{searchParams:Promise<{status?:string}>}) {
 const profile=await requireRole("customer","/profile");
 const vi=(await getLocale())==="vi";
 const {status}=await searchParams;
 return <div className="mx-auto max-w-2xl space-y-7">
  <div><p className="customer-eyebrow">{vi?"TÀI KHOẢN CỦA TÔI":"MY ACCOUNT"}</p><h1 className="mt-2">{vi?"Hồ sơ cá nhân":"My profile"}</h1><p className="mt-2 text-sm text-stone-600">{vi?"Cập nhật thông tin để chúng tôi có thể liên hệ với bạn.":"Keep your details up to date for your classes and studio visits."}</p></div>
  <div className="customer-tile">
   {status==="studio"&&<p role="status" className="mb-5 rounded-xl bg-green-50 p-3 text-sm text-green-800">{vi?"Đã lưu studio.":"Your preferred studio has been saved."}</p>}
   {status==="saved"&&<p role="status" className="mb-5 rounded-xl bg-green-50 p-3 text-sm text-green-800">{vi?"Đã lưu thông tin.":"Your profile has been saved."}</p>}
   {status==="error"&&<p role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{vi?"Không thể lưu. Vui lòng liên hệ studio.":"Could not save your profile. Please contact the studio."}</p>}
   {status==="invalid"&&<p role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{vi?"Vui lòng kiểm tra tên và số điện thoại.":"Please check the name and phone fields."}</p>}
   <form action={saveCustomerProfile} className="space-y-5">
    <div><label htmlFor="customer-name" className="label">{vi?"Họ và tên":"Full name"}</label><input id="customer-name" name="full_name" required minLength={2} maxLength={100} defaultValue={profile.full_name??""} className="input w-full"/></div>
    <div><label htmlFor="customer-phone" className="label">{vi?"Số điện thoại":"Phone number"}</label><input id="customer-phone" name="phone" type="tel" maxLength={30} defaultValue={profile.phone??""} className="input w-full"/></div>
    <div><label htmlFor="customer-email" className="label">{vi?"Email":"Email"}</label><div id="customer-email" className="customer-email-display" role="textbox" aria-readonly="true" aria-label="Account email">{profile.email || (vi?"Chưa có email":"No email set")}</div><p className="mt-1 text-xs text-stone-500">{vi?"Liên hệ studio để thay đổi email đăng nhập.":"Contact the studio if you need to change your login email."}</p></div>
    <button type="submit" className="btn-primary px-6 py-3">{vi?"Lưu thay đổi":"Save changes"}</button>
   </form>
  </div>
  <Link href="/preferences" className="customer-tile block font-semibold">My studio · Change preferred location →</Link>
  <div className="grid gap-3 sm:grid-cols-2"><Link href="/my-packages" className="customer-tile"><p className="font-semibold">{vi?"Gói tập & tín dụng":"Packages & credits"} →</p><p className="mt-1 text-sm text-stone-500">{vi?"Số dư và lịch sử tín dụng":"Balances and credit history"}</p></Link><Link href="/my-bookings" className="customer-tile"><p className="font-semibold">{vi?"Lịch sử đặt lớp":"Class activity"} →</p><p className="mt-1 text-sm text-stone-500">{vi?"Các lớp đã đặt và đã tham gia":"Bookings and attendance"}</p></Link></div>
 </div>;
}