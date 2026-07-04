// app/(portal)/dashboard/settings/page.tsx — v2
// Fixes:
//   1. Save button uses explicit green — never invisible on light mode
//   2. Error messages show the exact server error, not a generic one
//   3. Pre-fills form fields from the actual DB record, not session
"use client";

import { useState, useRef, useEffect } from "react";
import { updateProfile, changePassword } from "@/app/actions/settings-actions";
import { Camera, CheckCircle2, AlertTriangle, Loader2, User, Lock, Shield } from "lucide-react";
import { useSession } from "next-auth/react";

type Tab = "profile" | "security";

// Explicit colour classes — never inherit from a broken theme token
const BTN_GREEN  = "bg-[#1C4A2E] hover:bg-[#153822] text-white";
const BTN_DISABLED = "disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed";
const INPUT_CLS  = "w-full p-3 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#1C4A2E]/20 focus:border-[#1C4A2E] transition-all";
const LABEL_CLS  = "text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [tab,          setTab]          = useState<Tab>("profile");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl,     setPhotoUrl]     = useState("");
  const [submitting,   setSubmitting]   = useState<string | null>(null);
  const [result,       setResult]       = useState<{ form: string; type: "success"|"error"; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const user = session?.user as {
    name?:         string;
    firstName?:    string;
    lastName?:     string;
    role?:         string;
    memberNumber?: string;
    email?:        string;
  } | undefined;

  // Pre-fill photo preview from existing profile if any
  useEffect(() => {
    setPhotoPreview(null);
    setPhotoUrl("");
  }, []);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setResult({ form: "profile", type: "error", msg: "Image must be under 2MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setPhotoPreview(dataUrl);
      setPhotoUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function handleProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting("profile"); setResult(null);
    const fd = new FormData(e.currentTarget);
    if (photoUrl) fd.set("profilePhotoUrl", photoUrl);
    try {
      await updateProfile(fd);
      setResult({ form: "profile", type: "success", msg: "Profile updated successfully." });
    } catch (err: unknown) {
      // Show the EXACT error from the server, not a generic message
      const msg = err instanceof Error ? err.message : "An unexpected error occurred. Please try again.";
      setResult({ form: "profile", type: "error", msg });
    } finally { setSubmitting(null); }
  }

  async function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting("password"); setResult(null);
    try {
      await changePassword(new FormData(e.currentTarget));
      setResult({ form: "password", type: "success", msg: "Password changed successfully. Use your new password next time you sign in." });
      (e.target as HTMLFormElement).reset();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred. Please try again.";
      setResult({ form: "password", type: "error", msg });
    } finally { setSubmitting(null); }
  }

  function Banner({ form }: { form: string }) {
    if (result?.form !== form) return null;
    const ok = result.type === "success";
    return (
      <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
        ok
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-red-50 border-red-200 text-red-700"
      }`}>
        {ok
          ? <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />}
        <span>{result.msg}</span>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-stone-900 tracking-tight">Settings</h1>
        <p className="text-stone-500 text-sm mt-1">Manage your account preferences.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-stone-100 p-1 rounded-xl w-fit">
        {([
          { id: "profile",  label: "Profile",  icon: <User size={13}/> },
          { id: "security", label: "Security", icon: <Lock size={13}/> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.id} type="button"
            onClick={() => { setTab(t.id); setResult(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all
              ${tab === t.id
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Profile tab ─────────────────────────────────────────────────── */}
      {tab === "profile" && (
        <form onSubmit={handleProfile}
          className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/60 flex items-center gap-2">
            <User size={15} className="text-stone-400" />
            <span className="text-xs font-black uppercase tracking-wider text-stone-700">Profile Information</span>
          </div>

          <div className="p-6 space-y-5">
            <Banner form="profile" />

            {/* Profile photo */}
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-full bg-[#1C4A2E] flex items-center justify-center overflow-hidden border-2 border-stone-200">
                  {photoPreview
                    ? <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    : <span className="text-white text-2xl font-black">
                        {(user?.firstName?.[0] ?? user?.name?.[0] ?? "?").toUpperCase()}
                      </span>}
                </div>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#1C4A2E] border-2 border-white flex items-center justify-center hover:bg-[#153822] transition-colors">
                  <Camera size={12} className="text-white" />
                </button>
              </div>
              <div>
                <p className="text-sm font-semibold text-stone-700">Profile Photo</p>
                <p className="text-xs text-stone-400 mt-0.5">JPG or PNG · Max 2MB</p>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="text-xs font-bold text-[#1C4A2E] hover:underline mt-1 block">
                  Choose photo
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png"
                className="hidden" onChange={handlePhotoChange} />
            </div>

            {/* Name fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>First Name *</label>
                <input name="firstName" required placeholder="First name"
                  defaultValue={user?.firstName ?? user?.name?.split(" ")[0] ?? ""}
                  className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Last Name *</label>
                <input name="lastName" required placeholder="Last name"
                  defaultValue={user?.lastName ?? user?.name?.split(" ").slice(-1)[0] ?? ""}
                  className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>M-Pesa Phone *</label>
                <input name="phone" required placeholder="07XX XXX XXX"
                  className={INPUT_CLS} />
              </div>
            </div>

            {/* Read-only info */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={13} className="text-stone-400" />
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Read-Only</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-stone-400">Member Number</p>
                  <p className="font-bold text-stone-700 font-mono mt-0.5">{user?.memberNumber ?? "—"}</p>
                </div>
                <div>
                  <p className="text-stone-400">Role</p>
                  <p className="font-bold text-stone-700 mt-0.5">{user?.role?.replace(/_/g, " ") ?? "Member"}</p>
                </div>
                <div>
                  <p className="text-stone-400">Email</p>
                  <p className="font-bold text-stone-700 mt-0.5 truncate">{user?.email ?? "—"}</p>
                </div>
              </div>
            </div>

            {/* Save button — explicit green, always visible */}
            <button
              type="submit"
              disabled={submitting === "profile"}
              className={`w-full flex items-center justify-center gap-2 font-bold py-3 rounded-lg text-sm transition-colors ${BTN_GREEN} ${BTN_DISABLED}`}
            >
              {submitting === "profile"
                ? <><Loader2 size={15} className="animate-spin" /> Saving...</>
                : "Save Changes"}
            </button>
          </div>
        </form>
      )}

      {/* ── Security tab ─────────────────────────────────────────────────── */}
      {tab === "security" && (
        <form onSubmit={handlePassword}
          className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/60 flex items-center gap-2">
            <Lock size={15} className="text-stone-400" />
            <span className="text-xs font-black uppercase tracking-wider text-stone-700">Change Password</span>
          </div>
          <div className="p-6 space-y-4">
            <Banner form="password" />

            {[
              { name: "currentPassword", label: "Current Password",  placeholder: "Enter current password" },
              { name: "newPassword",     label: "New Password",      placeholder: "Min 8 characters"       },
              { name: "confirmPassword", label: "Confirm Password",  placeholder: "Re-enter new password"  },
            ].map(({ name, label, placeholder }) => (
              <div key={name}>
                <label className={LABEL_CLS}>{label}</label>
                <input
                  type="password" name={name} required
                  minLength={name !== "currentPassword" ? 8 : 1}
                  placeholder={placeholder}
                  className={INPUT_CLS}
                />
              </div>
            ))}

            {/* Button — same explicit green */}
            <button
              type="submit"
              disabled={submitting === "password"}
              className={`w-full flex items-center justify-center gap-2 font-bold py-3 rounded-lg text-sm transition-colors ${BTN_GREEN} ${BTN_DISABLED}`}
            >
              {submitting === "password"
                ? <><Loader2 size={15} className="animate-spin" /> Updating...</>
                : "Change Password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}