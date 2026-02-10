"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/authed-api";
import type { EscrowMessage } from "@/lib/types";

interface Props {
  escrowId: string;
  buyerId: string;
  sellerId: string;
}

export function EscrowChat({ escrowId, buyerId, sellerId }: Props) {
  const auth = getAuth();
  const [messages, setMessages] = useState<EscrowMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const userId = auth?.userId;
  const isBuyer = userId === buyerId;

  const fetchMessages = useCallback(async () => {
    if (!auth?.wallet) return;
    try {
      const res = await authedFetch(
        `/escrow/${escrowId}/messages`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // Silently fail on poll errors
    } finally {
      setLoading(false);
    }
  }, [escrowId, auth?.wallet]);

  // Initial fetch + polling every 5s
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    if (!input.trim() || !auth?.wallet || sending) return;

    const msg = input.trim();
    setInput("");
    setSending(true);

    try {
      const res = await authedFetch(`/escrow/${escrowId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      });

      if (res.ok) {
        await fetchMessages();
      }
    } catch {
      // Restore input on error
      setInput(msg);
    } finally {
      setSending(false);
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-white/3 border-b border-white/10">
        <h3 className="text-sm font-semibold">Messages</h3>
      </div>

      {/* Message list */}
      <div ref={containerRef} className="h-[240px] overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="text-center text-gray-500 text-sm py-8">Loading messages...</div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No messages yet. Say hi to coordinate a meetup!
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          const isBuyerMsg = msg.sender_id === buyerId;

          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${
                  isMe
                    ? "bg-brand/20 text-gray-100"
                    : "bg-white/5 text-gray-300"
                }`}
              >
                {!isMe && (
                  <div className="text-xs text-gray-500 mb-0.5">
                    {isBuyerMsg ? "Buyer" : "Seller"}
                  </div>
                )}
                <div>{msg.body}</div>
                <div className="text-xs text-gray-600 mt-0.5 text-right">
                  {formatTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
