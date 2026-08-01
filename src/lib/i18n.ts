// ============================================================================
// Lightweight i18n for the customer-facing app (EN / VI).
//
// No i18n framework: a plain dictionary keyed by a `locale` cookie that is
// readable from both server components (via next/headers `cookies()`) and
// client components (via `document.cookie`). Most customers are Vietnamese,
// so VI is a first-class option alongside the original English copy.
//
// Scope: customer + auth surfaces only. Admin/instructor screens are left in
// English to keep this change small and low-risk for the production CRM.
// ============================================================================

export type Locale = "en" | "vi";

export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "vi";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "vi";
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// Read the locale from a raw cookie string (works client-side with
// document.cookie, or with any header value).
export function localeFromCookieString(cookieString: string | undefined | null): Locale {
  if (!cookieString) return DEFAULT_LOCALE;
  const match = cookieString
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  if (!match) return DEFAULT_LOCALE;
  return normalizeLocale(decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)));
}

export type Dict = {
  // Shell / nav
  nav_book: string;
  nav_bookings: string;
  nav_packages: string;
  role_member: string;
  sign_out: string;
  language_name: string;

  // Book page
  book_title: string;
  book_intro: string;
  book_empty: string;
  book_credits_heading: string;
  credits_available: (n: number) => string;
  book_credits_help: string;

  // Book session row
  session_fallback: string;
  status_booked: string;
  status_waitlisted: string;
  seats_full: string;
  seats_left: (n: number) => string;
  cost_credits: (n: number) => string;
  youre_in: string;
  youre_on_list: string;
  action_join_waitlist: string;
  action_book: string;

  // My bookings
  bookings_title: string;
  bookings_intro: string;
  bookings_upcoming: string;
  bookings_none_upcoming: string;
  bookings_book_now: string;
  bookings_past: string;
  booking_status_booked: string;
  booking_status_waitlisted: string;
  booking_status_cancelled: string;
  booking_status_attended: string;
  booking_status_no_show: string;
  booking_class_removed: string;
  booking_cancel: string;

  // My packages
  packages_title: string;
  packages_intro: string;
  packages_none: string;
  packages_browse: string;
  packages_remaining: (n: number) => string;
  packages_expires: (date: string) => string;
  packages_no_expiry: string;
  packages_purchased: (date: string) => string;
  packages_pool_regular: string;
  packages_pool_private: string;
  packages_of_total: (n: number) => string;

  // Auth — shared
  auth_email: string;
  auth_password: string;
  email_placeholder: string;
  password_placeholder: string;
  please_wait: string;

  // Login
  login_title: string;
  login_intro: string;
  login_submit: string;
  login_new_here: string;
  login_create_account: string;

  // Signup
  signup_title: string;
  signup_intro: string;
  signup_full_name: string;
  signup_name_placeholder: string;
  signup_password_hint: string;
  signup_submit: string;
  signup_have_account: string;
  signup_login_link: string;

  // Forgot password
  forgot_title: string;
  forgot_intro: string;
  forgot_success: string;
  forgot_submit: string;
  forgot_remembered: string;
  forgot_back_to_login: string;

  // Reset password
  reset_title: string;
  reset_intro: string;
  reset_new_password: string;
  reset_password_hint: string;
  reset_submit: string;
  reset_request_new: string;

  // Auth action errors / notices
  err_invalid_email: string;
  err_password_short: string;
  err_enter_name: string;
  err_invalid_details: string;
  err_bad_credentials: string;
  err_email_taken: string;
  notice_account_created: string;
};

const en: Dict = {
  nav_book: "Book classes",
  nav_bookings: "My bookings",
  nav_packages: "My packages",
  role_member: "Member",
  sign_out: "Sign out",
  language_name: "English",

  book_title: "Book a class",
  book_intro:
    "Upcoming classes across our studios. Times are shown in each studio's local timezone. Booking spends credits from your balance.",
  book_empty: "No upcoming classes are open for booking right now. Check back soon.",
  book_credits_heading: "Your credits",
  credits_available: (n) => `${n} credit${n === 1 ? "" : "s"} available`,
  book_credits_help:
    "Each class costs the number of credits shown on it. Out of credits? Purchase a package to top up.",

  session_fallback: "Class",
  status_booked: "Booked",
  status_waitlisted: "Waitlisted",
  seats_full: "Full",
  seats_left: (n) => `${n} left`,
  cost_credits: (n) => `${n} credit${n === 1 ? "" : "s"}`,
  youre_in: "in",
  youre_on_list: "on the list",
  action_join_waitlist: "Join waitlist",
  action_book: "Book",

  bookings_title: "My bookings",
  bookings_intro:
    "Your upcoming classes and booking history. Cancel at least 3 hours before a class starts to get your credit back.",
  bookings_upcoming: "Upcoming",
  bookings_none_upcoming: "You have no upcoming classes.",
  bookings_book_now: "Book one now",
  bookings_past: "Past",
  booking_status_booked: "Booked",
  booking_status_waitlisted: "Waitlisted",
  booking_status_cancelled: "Cancelled",
  booking_status_attended: "Attended",
  booking_status_no_show: "No show",
  booking_class_removed: "Class removed",
  booking_cancel: "Cancel",

  packages_title: "My packages",
  packages_intro:
    "Credit packages you've purchased. Use credits to book classes across our studios.",
  packages_none: "You have no active packages.",
  packages_browse: "Browse packages",
  packages_remaining: (n) => `${n} credit${n === 1 ? "" : "s"} remaining`,
  packages_expires: (date) => `Expires ${date}`,
  packages_no_expiry: "No expiry",
  packages_purchased: (date) => `Purchased ${date}`,
  packages_pool_regular: "Group credits",
  packages_pool_private: "Private credits",
  packages_of_total: (n) => `of ${n}`,

  auth_email: "Email",
  auth_password: "Password",
  email_placeholder: "you@studio.com",
  password_placeholder: "••••••••",
  please_wait: "Please wait…",

  login_title: "Welcome back",
  login_intro: "Log in to manage your studio or book a class.",
  login_submit: "Log in",
  login_new_here: "New here?",
  login_create_account: "Create an account",

  signup_title: "Create your account",
  signup_intro: "Book classes and manage your credits in one place.",
  signup_full_name: "Full name",
  signup_name_placeholder: "Cleo Rivera",
  signup_password_hint: "At least 8 characters",
  signup_submit: "Create account",
  signup_have_account: "Already have an account?",
  signup_login_link: "Log in",

  forgot_title: "Reset your password",
  forgot_intro: "Enter your email and we'll send you a link to set a new password.",
  forgot_success:
    "If an account exists for that email, a reset link is on its way. Check your inbox (and spam).",
  forgot_submit: "Send reset link",
  forgot_remembered: "Remembered it?",
  forgot_back_to_login: "Back to login",

  reset_title: "Set a new password",
  reset_intro: "Choose a new password for your account.",
  reset_new_password: "New password",
  reset_password_hint: "At least 8 characters.",
  reset_submit: "Update password",
  reset_request_new: "Request a new link",

  err_invalid_email: "Enter a valid email address.",
  err_password_short: "Password must be at least 8 characters.",
  err_enter_name: "Enter your name.",
  err_invalid_details: "Invalid details.",
  err_bad_credentials: "Email or password is incorrect.",
  err_email_taken: "That email is already registered. Try logging in instead.",
  notice_account_created: "Account created. Please log in to start booking.",
};

const vi: Dict = {
  nav_book: "Đặt lớp",
  nav_bookings: "Lịch của tôi",
  nav_packages: "Gói của tôi",
  role_member: "Hội viên",
  sign_out: "Đăng xuất",
  language_name: "Tiếng Việt",

  book_title: "Đặt lớp học",
  book_intro:
    "Các lớp sắp diễn ra tại các studio của chúng tôi. Giờ hiển thị theo múi giờ của từng studio. Đặt lớp sẽ trừ tín dụng trong số dư của bạn.",
  book_empty: "Hiện chưa có lớp nào mở đặt chỗ. Vui lòng quay lại sau.",
  book_credits_heading: "Tín dụng của bạn",
  credits_available: (n) => `Còn ${n} tín dụng`,
  book_credits_help:
    "Mỗi lớp trừ số tín dụng hiển thị trên lớp đó. Hết tín dụng? Mua gói để nạp thêm.",

  session_fallback: "Lớp học",
  status_booked: "Đã đặt",
  status_waitlisted: "Danh sách chờ",
  seats_full: "Hết chỗ",
  seats_left: (n) => `Còn ${n} chỗ`,
  cost_credits: (n) => `${n} tín dụng`,
  youre_in: "đã có chỗ",
  youre_on_list: "trong danh sách chờ",
  action_join_waitlist: "Vào danh sách chờ",
  action_book: "Đặt lớp",

  bookings_title: "Lịch của tôi",
  bookings_intro:
    "Các lớp sắp tới và lịch sử đặt lớp của bạn. Hủy ít nhất 3 giờ trước khi lớp bắt đầu để được hoàn lại tín dụng.",
  bookings_upcoming: "Sắp tới",
  bookings_none_upcoming: "Bạn chưa có lớp nào sắp tới.",
  bookings_book_now: "Đặt lớp ngay",
  bookings_past: "Đã qua",
  booking_status_booked: "Đã đặt",
  booking_status_waitlisted: "Danh sách chờ",
  booking_status_cancelled: "Đã hủy",
  booking_status_attended: "Đã tham gia",
  booking_status_no_show: "Vắng mặt",
  booking_class_removed: "Lớp đã bị xóa",
  booking_cancel: "Hủy",

  packages_title: "Gói của tôi",
  packages_intro:
    "Các gói tín dụng bạn đã mua. Dùng tín dụng để đặt lớp tại các studio của chúng tôi.",
  packages_none: "Bạn chưa có gói nào đang hoạt động.",
  packages_browse: "Xem các gói",
  packages_remaining: (n) => `Còn ${n} tín dụng`,
  packages_expires: (date) => `Hết hạn ${date}`,
  packages_no_expiry: "Không hết hạn",
  packages_purchased: (date) => `Đã mua ${date}`,
  packages_pool_regular: "Tín dụng lớp nhóm",
  packages_pool_private: "Tín dụng lớp riêng",
  packages_of_total: (n) => `trên ${n}`,

  auth_email: "Email",
  auth_password: "Mật khẩu",
  email_placeholder: "ban@studio.com",
  password_placeholder: "••••••••",
  please_wait: "Vui lòng đợi…",

  login_title: "Chào mừng trở lại",
  login_intro: "Đăng nhập để quản lý studio hoặc đặt lớp học.",
  login_submit: "Đăng nhập",
  login_new_here: "Bạn mới đến?",
  login_create_account: "Tạo tài khoản",

  signup_title: "Tạo tài khoản của bạn",
  signup_intro: "Đặt lớp và quản lý tín dụng của bạn ở cùng một nơi.",
  signup_full_name: "Họ và tên",
  signup_name_placeholder: "Nguyễn Thị Mai",
  signup_password_hint: "Ít nhất 8 ký tự",
  signup_submit: "Tạo tài khoản",
  signup_have_account: "Đã có tài khoản?",
  signup_login_link: "Đăng nhập",

  forgot_title: "Đặt lại mật khẩu",
  forgot_intro: "Nhập email và chúng tôi sẽ gửi cho bạn liên kết để đặt mật khẩu mới.",
  forgot_success:
    "Nếu tài khoản tồn tại với email đó, liên kết đặt lại đang được gửi. Kiểm tra hộp thư (và cả thư rác).",
  forgot_submit: "Gửi liên kết đặt lại",
  forgot_remembered: "Đã nhớ ra?",
  forgot_back_to_login: "Quay lại đăng nhập",

  reset_title: "Đặt mật khẩu mới",
  reset_intro: "Chọn mật khẩu mới cho tài khoản của bạn.",
  reset_new_password: "Mật khẩu mới",
  reset_password_hint: "Ít nhất 8 ký tự.",
  reset_submit: "Cập nhật mật khẩu",
  reset_request_new: "Yêu cầu liên kết mới",

  err_invalid_email: "Nhập một địa chỉ email hợp lệ.",
  err_password_short: "Mật khẩu phải có ít nhất 8 ký tự.",
  err_enter_name: "Nhập tên của bạn.",
  err_invalid_details: "Thông tin không hợp lệ.",
  err_bad_credentials: "Email hoặc mật khẩu không đúng.",
  err_email_taken: "Email này đã được đăng ký. Hãy thử đăng nhập.",
  notice_account_created: "Đã tạo tài khoản. Vui lòng đăng nhập để bắt đầu đặt lớp.",
};

const DICTS: Record<Locale, Dict> = { en, vi };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}
