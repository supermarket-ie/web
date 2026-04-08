"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

type Status = "idle" | "submitting" | "sent" | "not_found" | "error";

export default function RequestLinkPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json();
        // If the API returned a flag indicating no subscriber was found
        if (data.found === false) {
          setStatus("not_found");
        } else {
          setStatus("sent");
        }
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8E2DC] max-w-md w-full p-8">

          {status === "sent" && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#5D9B8F]/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-[#5D9B8F]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-[#1D2324] mb-2">Check your inbox</h1>
              <p className="text-[#636E72] text-sm">
                We&rsquo;ve sent a link to <strong className="text-[#1D2324]">{email}</strong>. It&rsquo;s valid for 7 days.
              </p>
            </div>
          )}

          {status === "not_found" && (
            <div className="text-center">
              <div className="text-5xl mb-4">🤔</div>
              <h1 className="text-2xl font-bold text-[#1D2324] mb-2">No list found</h1>
              <p className="text-[#636E72] text-sm mb-6">
                We couldn&rsquo;t find a list for <strong className="text-[#1D2324]">{email}</strong>. Use the planner on our homepage to create one — it only takes a minute.
              </p>
              <Link
                href="/"
                className="inline-flex items-center justify-center w-full px-6 py-3 rounded-full font-semibold text-[#004a23]"
                style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
              >
                Go to the planner →
              </Link>
              <button
                onClick={() => { setStatus("idle"); setEmail(""); }}
                className="mt-3 text-sm text-[#636E72] hover:underline block w-full text-center"
              >
                Try a different email
              </button>
            </div>
          )}

          {(status === "idle" || status === "submitting" || status === "error") && (
            <>
              <h1 className="text-2xl font-bold text-[#1D2324] mb-2">Sign in to your list</h1>
              <p className="text-[#636E72] text-sm mb-6">
                Enter your email and we&rsquo;ll send a link to your personalised shopping list.
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
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3]"
                  />
                </div>
                {status === "error" && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
                    Something went wrong. Please try again.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!email || status === "submitting"}
                  className="w-full px-6 py-3 rounded-full font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed text-[#004a23]"
                  style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
                >
                  {status === "submitting" ? "Sending..." : "Send my list →"}
                </button>
              </form>
            </>
          )}
        </div>

        {(status === "idle" || status === "submitting" || status === "error") && (
          <p className="mt-6 text-sm text-[#636E72]">
            Not signed up yet?{" "}
            <Link href="/" className="text-[#006A35] font-medium hover:underline">
              Get started free →
            </Link>
          </p>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}
