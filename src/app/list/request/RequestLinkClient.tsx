"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { saveSession } from '@/lib/session';

type Status = "idle" | "submitting" | "error";

export default function RequestLinkPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");

    try {
      const normalizedEmail = email.trim().toLowerCase();

      // Unified account continuation flow:
      // - new email -> create the subscriber
      // - existing email -> refresh their session
      // /api/subscribe returns a short-lived JWT which is immediately exchanged
      // for the HttpOnly session cookie below.
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, familySize: "2" }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      const data = await res.json() as { token?: string };
      if (!data.token) {
        setStatus("error");
        return;
      }

      const sessionRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: data.token }),
      });

      if (!sessionRes.ok) {
        setStatus("error");
        return;
      }

      saveSession({
        token: data.token,
        familySize: "2",
        email: normalizedEmail,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      router.replace("/");
      router.refresh();
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8E2DC] max-w-md w-full p-8">
          <h1 className="text-2xl font-bold text-[#1D2324] mb-2">Continue free</h1>
          <p className="text-[#636E72] text-sm mb-6">
            Enter your email to keep your household agent, shopping preferences and future updates. No password needed.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#1D2324] mb-2">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3]"
              />
            </div>

            {status === "error" && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
                We couldn&rsquo;t continue your account. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={!email || status === "submitting"}
              className="w-full px-6 py-3 rounded-full font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed text-[#004a23]"
              style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
            >
              {status === "submitting" ? "Continuing..." : "Continue →"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-sm text-[#636E72] text-center max-w-md">
          Already have an account? Use the same email and we&rsquo;ll take you straight back in.
        </p>
        <Link href="/" className="mt-3 text-sm text-[#006A35] font-medium hover:underline">
          Back to Supermarket.ie
        </Link>
      </div>

      <SiteFooter />
    </div>
  );
}
