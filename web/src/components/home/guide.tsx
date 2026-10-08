"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LoaderCircle, MessageCircle, Send, ShieldCheck, TriangleAlert } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";

type MatchCard = {
  groupCode: string;
  name?: string;
  reasons?: string[];
  tradeoffs?: string[];
  contributionUsdc?: number;
  cadence?: string;
  seatsAvailable?: number;
  accountAddress?: string;
};

type MatchResponse = { answer: string; mode: string; matches: MatchCard[] };
type Entry = { role: "user" | "assistant"; content: string };

const PROMPTS = ["Weekly, at most 50 USDC", "Monthly circle with 6–8 people", "Haftalık, 100 USDC altı"];

export function Guide() {
  const { cluster, network } = useNetwork();
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<MatchResponse | null>(null);

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setState("loading");
    try {
      const response = await fetch(`/api/ai/match?cluster=${encodeURIComponent(cluster)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, history: history.slice(-6) }),
      });
      const payload = (await response.json()) as Partial<MatchResponse>;
      if (!response.ok && !payload.answer) throw new Error(String(response.status));
      const normalized: MatchResponse = {
        answer: typeof payload.answer === "string" ? payload.answer : "No explanation was returned.",
        mode: typeof payload.mode === "string" ? payload.mode : "deterministic",
        matches: Array.isArray(payload.matches) ? payload.matches : [],
      };
      setResult(normalized);
      setHistory((current) => [...current, { role: "user", content: clean }, { role: "assistant", content: normalized.answer }]);
      setMessage("");
      setState("done");
    } catch {
      setState("error");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(message);
  }

  return (
    <section className="page section" id="guide" aria-labelledby="guide-title">
      <div className="guide">
        <div className="card guide-intro">
          <span className="eyebrow">
            <MessageCircle size={14} aria-hidden="true" /> Ringio guide
          </span>
          <h2 id="guide-title">Describe the circle you want</h2>
          <p>
            Tell the guide how often you want to save and how much. It ranks only circles that are really forming on{" "}
            {network.label} right now, explains the fit, and names the tradeoffs. It never invents availability.
          </p>
          <div className="callout callout-info" style={{ marginTop: 20 }}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Do not share wallet addresses, phone numbers, or seed phrases here. Suggestions are not financial advice.</span>
          </div>
        </div>

        <div className="card guide-console">
          <div className="card-header">
            <div>
              <h3>Ask in English or Turkish</h3>
              <p>Rules-based ranking, optionally explained by an AI model.</p>
            </div>
            {result && <span className="badge badge-info">{result.mode === "openrouter" ? "AI + rules" : "Rules"}</span>}
          </div>
          <div className="chip-row">
            {PROMPTS.map((prompt) => (
              <button key={prompt} className="chip" type="button" onClick={() => void ask(prompt)} disabled={state === "loading"}>
                {prompt}
              </button>
            ))}
          </div>
          <div className="guide-output" aria-live="polite" aria-busy={state === "loading"}>
            {state === "idle" && <p className="subtle">Pick a sample or write your own constraints below.</p>}
            {state === "loading" && (
              <p className="muted">
                <LoaderCircle className="spin" size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Comparing live
                circles…
              </p>
            )}
            {state === "error" && (
              <div className="callout callout-danger" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>The guide is unavailable right now. Try again in a moment.</span>
              </div>
            )}
            {state === "done" && result && (
              <>
                <div className="answer">{result.answer}</div>
                {result.matches.map((match) => (
                  <article className="match-card" key={match.groupCode}>
                    <div className="circle-card-head">
                      <div>
                        <strong>{match.name ?? match.groupCode}</strong>
                        <p className="mono subtle" style={{ fontSize: 12, marginTop: 2 }}>
                          {match.groupCode}
                        </p>
                      </div>
                      {match.seatsAvailable != null && <span className="badge badge-info">{match.seatsAvailable} open</span>}
                    </div>
                    {match.reasons && match.reasons.length > 0 && (
                      <ul>
                        {match.reasons.slice(0, 3).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {match.accountAddress && (
                      <Link className="text-link" href={`/circles/${match.accountAddress}`} style={{ marginTop: 10 }}>
                        View circle
                      </Link>
                    )}
                  </article>
                ))}
              </>
            )}
          </div>
          <form className="guide-form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="guide-input">
              Describe your ideal circle
            </label>
            <input
              id="guide-input"
              className="input"
              value={message}
              maxLength={280}
              placeholder="e.g. weekly, around 50 USDC, 5–6 people"
              onChange={(event) => setMessage(event.target.value)}
              disabled={state === "loading"}
            />
            <button className="btn btn-primary" type="submit" disabled={state === "loading" || !message.trim()} aria-label="Ask the guide">
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
