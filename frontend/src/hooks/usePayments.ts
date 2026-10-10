import { useState, useEffect, useCallback, useMemo } from 'react';
import { Token, PaymentQuote, PaymentIntent } from '../types';
import { api, SUPPORTED_TOKENS, normalizeRecipientInput } from '../lib/api';
import { usePasskeyTxAuth } from './usePasskeyTxAuth';
import { useOnchainData } from './useOnchainData';

export function usePayments() {
  const { authorizeWithPasskey } = usePasskeyTxAuth();
  const { tokens: onchainTokens, balances } = useOnchainData();

  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [history, setHistory] = useState<PaymentIntent[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Combine onchain tokens with live user balances & filter out raw un-defused native token
  const tokens = useMemo<Token[]>(() => {
    if (!onchainTokens || onchainTokens.length === 0) {
      return SUPPORTED_TOKENS;
    }

    const priorityOrder: Record<string, number> = {
      NEAR: 1,
      USDC: 2,
      USDT: 3,
      ETH: 4,
      BTC: 5,
      WBTC: 6,
      SOL: 7,
      DAI: 8,
      FRAX: 9,
      AURORA: 10,
    };

    const mapped = onchainTokens
      .filter((ot) => ot.id !== 'near' && ot.id !== 'native') // remove raw un-defused native token
      .map((ot) => {
        const balRecord = balances.find(
          (b) =>
            b.defuse_asset_id?.toLowerCase() === ot.id.toLowerCase() ||
            (ot.nearContractId && b.nearContractId?.toLowerCase() === ot.nearContractId.toLowerCase()) ||
            b.symbol.toLowerCase() === ot.symbol.toLowerCase()
        );
        return {
          id: ot.id,
          symbol: ot.symbol,
          name: ot.name,
          iconUrl: ot.iconUrl,
          decimals: ot.decimals,
          priceUsd: (ot as any).priceUsd || (ot.symbol === 'NEAR' ? 5.42 : ot.symbol === 'ETH' ? 2500 : ot.symbol === 'BTC' ? 82000 : 1.0),
          nearContractId: ot.nearContractId,
          chain: ot.chain || 'near',
          badge: (ot.chain || 'near').toUpperCase(),
          category: (['NEAR', 'USDC', 'USDT', 'ETH', 'BTC', 'SOL'].includes(ot.symbol) ? 'popular' : 'all') as any,
          balance: balRecord?.amountFormatted || balRecord?.amount || '0.00',
        };
      });

    mapped.sort((a, b) => {
      const pA = priorityOrder[a.symbol.toUpperCase()] ?? 999;
      const pB = priorityOrder[b.symbol.toUpperCase()] ?? 999;
      if (pA !== pB) return pA - pB;
      return a.symbol.localeCompare(b.symbol);
    });

    return mapped.length > 0 ? mapped : SUPPORTED_TOKENS;
  }, [onchainTokens, balances]);

  const [selectedTokenId, setSelectedTokenId] = useState<string>(SUPPORTED_TOKENS[0].id);

  const selectedToken = useMemo<Token>(() => {
    return tokens.find((t) => t.id === selectedTokenId) || tokens[0] || SUPPORTED_TOKENS[0];
  }, [tokens, selectedTokenId]);

  const setSelectedToken = useCallback((t: Token) => {
    setSelectedTokenId(t.id);
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

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
