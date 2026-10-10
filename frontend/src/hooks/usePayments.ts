import { useState, useEffect, useCallback } from 'react';
import { Token, PaymentQuote, PaymentIntent } from '../types';
import { api, SUPPORTED_TOKENS, normalizeRecipientInput } from '../lib/api';
import { usePasskeyTxAuth } from './usePasskeyTxAuth';

export function usePayments() {
  const { authorizeWithPasskey } = usePasskeyTxAuth();
  const [tokens, setTokens] = useState<Token[]>(SUPPORTED_TOKENS);
  const [selectedToken, setSelectedToken] = useState<Token>(SUPPORTED_TOKENS[0]);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [history, setHistory] = useState<PaymentIntent[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Load tokens
  useEffect(() => {
    let mounted = true;
    api.getTokens().then((toks) => {
      if (mounted && toks.length > 0) {
        setTokens(toks);
        setSelectedToken(toks[0]);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Update quote
  const updateQuote = useCallback(
    async (tokenId: string, amount: string) => {
      if (!amount || parseFloat(amount) <= 0) {
        setQuote(null);
        return;
      }
      try {
        setIsQuoting(true);
        const q = await api.getQuote(tokenId, amount);
        setQuote(q);
      } catch (err) {
        console.error('Quote calculation error:', err);
      } finally {
        setIsQuoting(false);
      }
    },
    []
  );

  // Send confidential payment (authorized by device Passkey)
  const sendPayment = async (
    recipientHandle: string,
    amount: string,
    memo?: string
  ): Promise<PaymentIntent> => {
    try {
      setIsSubmitting(true);
      setError(null);

      const cleanHandle = normalizeRecipientInput(recipientHandle).recipient;
      if (!cleanHandle) {
        throw new Error('Please enter a valid recipient');
      }
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Please enter a valid amount to send');
      }

      // Step 1: Prompt hardware passkey to authorize fund movement
      let assertion: unknown = undefined;
      try {
        assertion = await authorizeWithPasskey(`Send ${amount} ${selectedToken.symbol} to @${cleanHandle}`);
      } catch (authErr: any) {
        const msg = authErr?.message || 'Passkey authorization cancelled';
        setError(msg);
        throw new Error(msg);
      }

      // Step 2: Send payment intent with passkey cryptographic assertion
      // The quote shown in the UI is only a preview (it is not bound to this
      // recipient). createPayment requests a fresh, recipient-bound quote so the
      // signature always matches the payment being submitted.
      const payment = await api.createPayment({
        recipientHandle: cleanHandle,
        tokenId: selectedToken.id,
        amount,
        memo,
        passkeyAssertion: assertion,
      });

      setCreatedPayment(payment);
      // Refresh history
      loadHistory();
      return payment;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send payment';
      setError(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load history
  const loadHistory = useCallback(async () => {
    try {
      setIsLoadingHistory(true);
      const items = await api.getPaymentHistory();
      setHistory(items);
    } catch (err) {
      console.error('Failed to load payment history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const resetCreatedPayment = () => {
    setCreatedPayment(null);
  };

  return {
    tokens,
    selectedToken,
    setSelectedToken,
    quote,
    isQuoting,
    isSubmitting,
    error,
    createdPayment,
    history,
    isLoadingHistory,
    updateQuote,
    sendPayment,
    loadHistory,
    resetCreatedPayment,
    clearError: () => setError(null),
  };
}
