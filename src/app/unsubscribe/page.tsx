"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }

    fetch("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus("success");
          setEmail(data.email);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8faf9] to-[#eef5f2] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <Link href="/" className="text-2xl font-bold text-[#1B4D3E] hover:opacity-80 transition mb-8 inline-block">
          supermarket<span className="text-[#FF6B5B]">.ie</span>
        </Link>

        {status === "loading" && (
          <div className="bg-white p-8 rounded-2xl shadow-sm">
            <div className="animate-spin w-8 h-8 border-4 border-[#1B4D3E] border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Processing your request...</p>
          </div>
        )}

        {status === "success" && (
          <div className="bg-white p-8 rounded-2xl shadow-sm">
            <div className="text-5xl mb-4">👋</div>
            <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">You&apos;ve been unsubscribed</h1>
            <p className="text-gray-600 mb-6">
              We&apos;ve removed <strong>{email}</strong> from our mailing list. You won&apos;t receive any more emails from us.
            </p>
            <p className="text-gray-500 text-sm mb-6">
              Changed your mind? You can always sign up again at{" "}
              <Link href="/" className="text-[#1B4D3E] hover:underline">
                supermarket.ie
              </Link>
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="bg-white p-8 rounded-2xl shadow-sm">
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">Something went wrong</h1>
            <p className="text-gray-600 mb-6">
              This unsubscribe link may be invalid or expired. If you&apos;re still receiving emails,
              please contact us at{" "}
              <a href="mailto:hello@supermarket.ie" className="text-[#1B4D3E] hover:underline">
                hello@supermarket.ie
              </a>
            </p>
            <Link
              href="/"
              className="inline-block bg-[#1B4D3E] text-white px-6 py-3 rounded-full font-semibold hover:bg-[#153d31] transition"
            >
              Go to homepage
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-[#f8faf9] to-[#eef5f2] flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="bg-white p-8 rounded-2xl shadow-sm">
            <div className="animate-spin w-8 h-8 border-4 border-[#1B4D3E] border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <UnsubscribeContent />
    </Suspense>
  );
}
