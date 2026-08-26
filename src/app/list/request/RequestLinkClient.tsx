"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getAnalyticsSessionId, trackEvent } from '@/lib/analytics';

type Status = "idle" | "submitting" | "sent" | "error";

export default function RequestLinkPage({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    trackEvent('signup_started', {
      method: 'email',
      flow: 'verified_email_continuation',
    });

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          familySize: "2",
          sessionId: getAnalyticsSessionId(),
        }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      setStatus("sent");
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

          {expired && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              That link has expired or is invalid. Request a new one below.
            </p>
          )}

          {status === "sent" ? (
            <div className="rounded-xl border border-[#cfe3d5] bg-[#f3faf5] px-4 py-4 text-sm text-[#17452a]">
              <p className="font-bold">Check your email</p>
              <p className="mt-1 leading-6">Open the secure link we sent to confirm your email and continue. It is valid for 15 minutes.</p>
            </div>
          ) : <form onSubmit={handleSubmit} className="space-y-4">
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
          </form>}
        </div>

        <p className="mt-6 text-sm text-[#636E72] text-center max-w-md">
          Already have an account? Use the same email and we&rsquo;ll send you a secure sign-in link.
        </p>
        <Link href="/" className="mt-3 text-sm text-[#006A35] font-medium hover:underline">
          Back to Supermarket.ie
        </Link>
      </div>

      <SiteFooter />
    </div>
  );
}
