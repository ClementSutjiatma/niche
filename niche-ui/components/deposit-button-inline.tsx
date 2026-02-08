"use client";

import { useState } from "react";
import { useDepositTransaction } from "@/hooks/useDepositTransaction";
import { getAuth } from "@/lib/auth";

interface DepositButtonInlineProps {
  listingId: string;
  itemName: string;
  price: number;
  minDeposit: number;
  category?: string;
}

export function DepositButtonInline({
  listingId,
  itemName,
  price,
  minDeposit,
  category,
}: DepositButtonInlineProps) {
  const [showModal, setShowModal] = useState(false);
  const auth = getAuth();
  const { handleDeposit, status, error, isProcessing, depositResult } = useDepositTransaction({
    listingId,
    itemName,
    price,
    minDeposit,
  });

  if (depositResult) {
    return (
      <div className="px-4 py-2 bg-success/10 border border-success/30 text-success text-sm">
        ✓ Deposit placed
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={isProcessing}
        className="w-full px-4 py-3 bg-text-primary text-bg hover:bg-text-secondary transition-colors disabled:opacity-50 text-sm font-medium"
      >
        {isProcessing ? status : `Deposit $${minDeposit}`}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface border border-border max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">{itemName}</h3>

            <div className="space-y-2 text-sm mb-6">
              <div className="flex justify-between">
                <span className="text-text-secondary">Total Price</span>
                <span className="font-bold">${price} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Deposit Now</span>
                <span className="text-accent font-bold">${minDeposit} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Pay at Meetup</span>
                <span>${price - minDeposit} USD</span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-error/10 border border-error/30 text-error text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-3 border border-border hover:bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeposit}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-text-primary text-bg hover:bg-text-secondary transition-colors disabled:opacity-50"
              >
                {isProcessing ? status : `Confirm $${minDeposit}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
