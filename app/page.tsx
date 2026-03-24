"use client";

import { useState } from "react";
import ShoppingList from "@/components/ShoppingList";
import { DietaryPreference, GeneratedList } from "@/lib/types";

type Step = "landing" | "loading" | "results";

const FAMILY_OPTIONS = [
  { value: 1, label: "Just me", icon: "🧍" },
  { value: 2, label: "Couple", icon: "👫" },
  { value: 3, label: "Family of 3", icon: "👨‍👩‍👦" },
  { value: 4, label: "Family of 4", icon: "👨‍👩‍👧‍👦" },
  { value: 5, label: "5 or more", icon: "👨‍👩‍👧‍👦👦" },
];

const DIETARY_OPTIONS: { value: DietaryPreference; label: string }[] = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "gluten_free", label: "Gluten free" },
  { value: "dairy_free", label: "Dairy free" },
  { value: "halal", label: "Halal" },
];

const LOADING_MESSAGES = [
  "Checking this week's deals across all stores…",
  "Comparing prices at Tesco, SuperValu, Dunnes & Lidl…",
  "Finding the best value for your family…",
  "Building your personalised list…",
  "Almost there…",
];

export default function HomePage() {
  const [step, setStep] = useState<Step>("landing");
  const [familySize, setFamilySize] = useState<number>(4);
  const [dietary, setDietary] = useState<DietaryPreference[]>([]);
  const [budget, setBudget] = useState<string>("");
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [list, setList] = useState<GeneratedList | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleDietary(pref: DietaryPreference) {
    setDietary((prev) =>
      prev.includes(pref) ? prev.filter((d) => d !== pref) : [...prev, pref]
    );
  }

  async function handleSubmit() {
    setError(null);
    setStep("loading");

    // Cycle loading messages while waiting
    const interval = setInterval(() => {
      setLoadingMsg((m) => (m + 1) % LOADING_MESSAGES.length);
    }, 2500);

    try {
      const res = await fetch("/api/generate-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familySize,
          dietary,
          budget: budget ? parseInt(budget, 10) : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Something went wrong");
      }

      setList(data.list);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("landing");
    } finally {
      clearInterval(interval);
    }
  }

  if (step === "results" && list) {
    return <ShoppingList list={list} onReset={() => setStep("landing")} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Nav */}
      <nav className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <span className="font-bold text-brand-green text-lg tracking-tight">
          supermarket.ie
        </span>
      </nav>

      {/* Hero */}
      <main className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-green text-sm font-medium px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-green" />
            Free · Updated weekly with live prices
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-ink leading-tight tracking-tight">
            Smarter grocery shopping
            <br />
            <span className="text-brand-green">for Irish families</span>
          </h1>
          <p className="mt-4 text-lg text-ink-muted max-w-md mx-auto leading-relaxed">
            Tell us about your household. Our AI checks prices at Tesco,
            SuperValu, Dunnes and Lidl — then builds your personalised weekly
            list.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-ink-faint shadow-sm p-6 sm:p-8">
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Family size */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-ink mb-3">
              Household size
            </label>
            <div className="grid grid-cols-5 gap-2">
              {FAMILY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFamilySize(opt.value)}
                  className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl border-2 text-center transition-all ${
                    familySize === opt.value
                      ? "border-brand-green bg-brand-green/5"
                      : "border-ink-faint hover:border-ink-muted"
                  }`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <span className="text-xs font-medium text-ink leading-tight hidden sm:block">
                    {opt.label}
                  </span>
                  <span className="text-xs font-medium text-ink sm:hidden">
                    {opt.value === 5 ? "5+" : opt.value}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Dietary preferences */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-ink mb-3">
              Dietary preferences{" "}
              <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => toggleDietary(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-sm border-2 transition-all ${
                    dietary.includes(opt.value)
                      ? "border-brand-green bg-brand-green text-white"
                      : "border-ink-faint text-ink hover:border-ink-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Budget (optional) */}
          <div className="mb-8">
            <label className="block text-sm font-semibold text-ink mb-3">
              Weekly budget{" "}
              <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm">
                €
              </span>
              <input
                type="number"
                min={20}
                max={500}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g. 120"
                className="w-full pl-7 pr-4 py-2.5 border-2 border-ink-faint rounded-xl text-sm text-ink focus:outline-none focus:border-brand-green transition-colors"
              />
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleSubmit}
            disabled={step === "loading"}
            className="w-full bg-brand-coral hover:bg-brand-coral-dark text-white font-semibold py-3.5 px-6 rounded-xl transition-colors text-base disabled:opacity-60"
          >
            Build my list
          </button>
        </div>

        {/* How it works */}
        <div className="mt-16 grid grid-cols-3 gap-6 text-center">
          {[
            {
              step: "1",
              title: "Tell us about your household",
              body: "Family size and any dietary needs.",
            },
            {
              step: "2",
              title: "AI checks live prices",
              body: "We scan Tesco, SuperValu, Dunnes and Lidl.",
            },
            {
              step: "3",
              title: "Get your personalised list",
              body: "With store recommendations and this week's best deals.",
            },
          ].map((item) => (
            <div key={item.step}>
              <div className="w-8 h-8 rounded-full bg-brand-green text-white text-sm font-bold flex items-center justify-center mx-auto mb-3">
                {item.step}
              </div>
              <h3 className="text-sm font-semibold text-ink mb-1">
                {item.title}
              </h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* Loading overlay */}
      {step === "loading" && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
          <div className="text-center max-w-xs">
            <div className="w-12 h-12 border-3 border-brand-green border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <p className="text-sm font-medium text-ink mb-1">
              Building your list
            </p>
            <p className="text-sm text-ink-muted transition-all duration-500">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
