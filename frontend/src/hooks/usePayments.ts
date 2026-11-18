import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Token, PaymentQuote, PaymentIntent } from '../types';
import { api, SUPPORTED_TOKENS, normalizeRecipientInput, tokenUsdPrice } from '../lib/api';
import { triggerNativeL1TwoStepPrompt } from '../lib/selfCustody';
import { usePasskeyTxAuth } from './usePasskeyTxAuth';
import { useXAuth } from './useXAuth';
import { useOnchainData, persistCache, globalCache } from './useOnchainData';

const HISTORY_CACHE_KEY = 'uprail_payment_history_cache';

let globalHistoryCache: PaymentIntent[] = (() => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

export type TxStage = 'idle' | 'authorizing' | 'sending';

export function usePayments() {
  const { user } = useXAuth();
  const { authorizeWithPasskey } = usePasskeyTxAuth();
  const { tokens: onchainTokens, balances, balancesError, refreshBalances } = useOnchainData();

  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStage, setTxStage] = useState<TxStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [history, setHistory] = useState<PaymentIntent[]>(globalHistoryCache);
  const [isLoadingHistory, setIsLoadingHistory] = useState(globalHistoryCache.length === 0);

  // Combine onchain tokens with live user balances & filter out raw un-defused native token
  const tokens = useMemo<Token[]>(() => {
    const rawTokens = (onchainTokens && onchainTokens.length > 0)
      ? onchainTokens.filter((ot) => ot.id !== 'near' && ot.id !== 'native')
      : SUPPORTED_TOKENS;

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

    const matchedBalanceKeys = new Set<string>();

    const mapped: Token[] = rawTokens.map((ot) => {
      const balRecord = balances.find(
        (b) =>
          b.defuse_asset_id?.toLowerCase() === ot.id.toLowerCase() ||
          (ot.nearContractId && b.nearContractId?.toLowerCase() === ot.nearContractId.toLowerCase()) ||
          b.symbol.toLowerCase() === ot.symbol.toLowerCase()
      );
      if (balRecord) {
        matchedBalanceKeys.add(
          (balRecord.defuse_asset_id || `${balRecord.nearContractId}:${balRecord.symbol}`).toLowerCase()
        );
      }
      return {
        id: ot.id,
        symbol: ot.symbol,
        name: ot.name,
        iconUrl: ot.iconUrl,
        decimals: ot.decimals,
        // Prefer the registry price, but fall back to the price the balances
        // API attached to this exact holding. Launchpad tokens (e.g. UPTOBER)
        // are listed with no registry price yet are DEX-priced on the balance
        // row — without this the Send estimate showed "—" while the dashboard,
        // which reads the balance price first, showed a value.
        priceUsd: tokenUsdPrice(ot as any) ?? tokenUsdPrice(balRecord) ?? undefined,
        nearContractId: ot.nearContractId,
        chain: ot.chain || 'near',
        badge: (ot.chain || 'near').toUpperCase(),
        category: ((ot as any).category || (['NEAR', 'USDC', 'USDT', 'ETH', 'BTC', 'SOL'].includes(ot.symbol) ? 'popular' : 'all')) as any,
        balance: balRecord?.amountFormatted || balRecord?.amount || '0.00',
      };
    });

    // Held-but-unlisted assets. The registry is a curated head, so a launchpad
    // meme the user actually owns may be absent from it — without this the
    // token is spendable onchain but impossible to pick here.
    for (const b of balances) {
      const key = (b.defuse_asset_id || `${b.nearContractId}:${b.symbol}`).toLowerCase();
      if (matchedBalanceKeys.has(key)) continue;
      const alreadyListed =
        mapped.some(
          (t) =>
            t.id.toLowerCase() === (b.defuse_asset_id || '').toLowerCase() ||
            (!!b.nearContractId &&
              (t.nearContractId || '').toLowerCase() === b.nearContractId.toLowerCase())
        ) || mapped.some((t) => t.symbol.toUpperCase() === b.symbol.toUpperCase());
      if (alreadyListed) continue;
      const amt = parseFloat(b.amountFormatted || b.amount || '0') || 0;
      if (amt <= 0) continue;
      mapped.push({
        id: b.defuse_asset_id || `nep141:${b.nearContractId}`,
        symbol: b.symbol,
        name: b.symbol,
        iconUrl: b.icon || '',
        decimals: b.decimals,
        // The balances API already resolved a price for this exact asset id;
        // dropping it here left held tokens unpriced in the Send list even
        // when the registry knew the value.
        priceUsd: b.priceUsd,
        nearContractId: b.nearContractId,
        chain: 'near',
        badge: 'NEAR',
        category: 'all',
        balance: b.amountFormatted || b.amount || '0',
      } as Token);
    }

    const getHoldingUsdValue = (t: Token): number => {
      const bal = parseFloat(t.balance || '0');
      if (isNaN(bal) || bal <= 0) return 0;
      if (typeof t.priceUsd === 'number' && isFinite(t.priceUsd) && t.priceUsd > 0) {
        return bal * t.priceUsd;
      }
      const sym = t.symbol.toUpperCase();
      if (['USDC', 'USDT', 'DAI', 'FRAX', 'USDD', 'USDE', 'USDG', 'FDUSD'].includes(sym)) {
        return bal * 1.0;
      }
      // Positive balance of unpriced asset ranks higher than 0 balance
      return 0.000001;
    };

    mapped.sort((a, b) => {
      const valA = getHoldingUsdValue(a);
      const valB = getHoldingUsdValue(b);

      // 1. Asset with highest USD value held by user must be at the very top
      if (Math.abs(valA - valB) > 0.000001) {
        return valB - valA;
      }

      // 2. If holding values are both unknown or equal, any positive balance comes before 0 balance
      const numBalA = parseFloat(a.balance || '0') || 0;
      const numBalB = parseFloat(b.balance || '0') || 0;
      if (numBalA > 0 && numBalB <= 0) return -1;
      if (numBalB > 0 && numBalA <= 0) return 1;
      if (numBalA > 0 && numBalB > 0 && Math.abs(numBalA - numBalB) > 0.000001) {
        return numBalB - numBalA;
      }

      // 3. Fall back to canonical priority order
      const pA = priorityOrder[a.symbol.toUpperCase()] ?? 999;
      const pB = priorityOrder[b.symbol.toUpperCase()] ?? 999;
      if (pA !== pB) return pA - pB;
      return a.symbol.localeCompare(b.symbol);
    });

    return mapped.length > 0 ? mapped : SUPPORTED_TOKENS;
  }, [onchainTokens, balances]);

  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const userManuallySelectedRef = useRef(false);

  // Keep selectedToken synced with the highest-value token unless user explicitly chose another
  useEffect(() => {
    if (!userManuallySelectedRef.current && tokens.length > 0) {
      setSelectedTokenId(tokens[0].id);
    }
  }, [tokens]);

  const selectedToken = useMemo<Token>(() => {
    if (selectedTokenId) {
      const found = tokens.find((t) => t.id === selectedTokenId);
      if (found) return found;
    }
    return tokens[0] || SUPPORTED_TOKENS[0];
  }, [tokens, selectedTokenId]);

  const setSelectedToken = useCallback((t: Token) => {
    userManuallySelectedRef.current = true;
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
        // Held launchpad assets are not in the curated token list, so pass the
        // already-resolved object through. Without it getQuote cannot match the
        // id and would have to refuse rather than guess a different asset.
        const known = tokens.find((t) => t.id === tokenId);
        const q = await api.getQuote(tokenId, amount, 'escrow', known);
        setQuote(q);
      } catch (err) {
        console.error('Quote calculation error:', err);
      } finally {
        setIsQuoting(false);
      }
    },
    [tokens]
  );

  const deductBalanceOptimistically = (tokenId: string, symbol: string, amountStr: string) => {
    const amt = parseFloat(amountStr) || 0;
    if (amt <= 0 || !Array.isArray(globalCache.balances)) return;
    const updatedBalances = globalCache.balances.map((b) => {
      if (
        b.symbol.toLowerCase() === symbol.toLowerCase() ||
        b.defuse_asset_id?.toLowerCase() === tokenId.toLowerCase()
      ) {
        const currentFormatted = parseFloat(b.amountFormatted) || 0;
        const newFormatted = Math.max(0, currentFormatted - amt);
        return {
          ...b,
          amountFormatted: newFormatted.toFixed(Math.min(6, b.decimals || 6)),
        };
      }
      return b;
    });
    persistCache({ balances: updatedBalances });
  };

  const shouldUseNativeL1TwoStep = (tokenId: string, token?: Token) => {
    const tIdLower = tokenId.toLowerCase();
    if (quote?.token?.id?.toLowerCase() === tIdLower && quote?.rail === 'native') return true;
    if (token?.category === 'memes') return true;
    return balances.some(
      (b) =>
        Boolean(b.isPlainOnly) &&
        (b.defuse_asset_id?.toLowerCase() === tIdLower ||
          (token?.nearContractId && b.nearContractId?.toLowerCase() === token.nearContractId.toLowerCase()))
    );
  };

  // Send payment (routes Self-Custody through prepare/submit + 2-step Native L1 when applicable)
  const sendPayment = async (
    recipientHandle: string,
    amount: string,
    memo?: string
  ): Promise<PaymentIntent> => {
    try {
      setIsSubmitting(true);
      setTxStage('authorizing');
      setError(null);

      const cleanHandle = normalizeRecipientInput(recipientHandle).recipient;
      if (!cleanHandle) {
        throw new Error('Please enter a valid recipient');
      }
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Please enter a valid amount to send');
      }

      let payment: PaymentIntent;

      if (user?.custodyMode === 'self') {
        payment = await api.sendPaymentSelfCustody(
          {
            recipientHandle: cleanHandle,
            tokenId: selectedToken.id,
            amount,
            memo,
            token: selectedToken,
          },
          (stage) => setTxStage(stage === 'submitting' ? 'sending' : 'authorizing')
        );
      } else if (shouldUseNativeL1TwoStep(selectedToken.id, selectedToken)) {
        const opts = await api.getTxAuthOptions();
        payment = await triggerNativeL1TwoStepPrompt<PaymentIntent>({
          prepared: {
            step: 'native_auth',
            operation: 'native_send',
            symbol: selectedToken.symbol,
            amount,
            target: `@${cleanHandle}`,
            nearAccount: user?.nearAccount || undefined,
            actionId: 'tx_auth_native_send',
            options: opts,
            summary: `${selectedToken.symbol} settles on NEAR L1. Step 1 signs with your passkey; Step 2 authorizes your NEAR L1 key to transfer ${amount} ${selectedToken.symbol}.`,
          },
          submitAuthorized: async (assertion) => {
            setTxStage('sending');
            return await api.createPayment({
              recipientHandle: cleanHandle,
              tokenId: selectedToken.id,
              amount,
              memo,
              passkeyAssertion: assertion,
              token: selectedToken,
            });
          },
        });
      } else {
        // Step 1: Prompt hardware passkey to authorize fund movement
        let assertion: unknown = undefined;
        try {
          assertion = await authorizeWithPasskey(`Send ${amount} ${selectedToken.symbol} to @${cleanHandle}`);
        } catch (authErr: any) {
          const msg = authErr?.message || 'Passkey authorization cancelled';
          setError(msg);
          throw new Error(msg);
        }

        // Step 2: Passkey authorized. Now send payment intent to network
        setTxStage('sending');
        payment = await api.createPayment({
          recipientHandle: cleanHandle,
          tokenId: selectedToken.id,
          amount,
          memo,
          passkeyAssertion: assertion,
          token: selectedToken,
        });
      }

      setCreatedPayment(payment);
      deductBalanceOptimistically(selectedToken.id, selectedToken.symbol, payment.grossAmount || amount);

      // Refresh history & balances
      loadHistory();
      void refreshBalances();
      return payment;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send payment';
      setError(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
      setTxStage('idle');
    }
  };

  /**
   * "Send to Wallet": settles from the caller's balance to an external chain address.
   */
  const sendToWallet = async (
    destinationAddress: string,
    amount: string,
    asset?: string,
    destinationChain?: string
  ): Promise<{ txHash: string; withdrawalId?: string; destinationAddress: string; shareLink?: string }> => {
    try {
      setIsSubmitting(true);
      setTxStage('authorizing');
      setError(null);

      const destination = (destinationAddress || '').trim();
      if (destination.length < 5) {
        throw new Error('Please enter a valid wallet address');
      }
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Please enter a valid amount to send');
      }

      const tokenId = asset || selectedToken.id;
      const targetToken = tokens.find((t) => t.id.toLowerCase() === tokenId.toLowerCase()) || selectedToken;

      let result: {
        txHash: string;
        withdrawalId?: string;
        destinationAddress: string;
        shareLink?: string;
      };

      if (user?.custodyMode === 'self') {
        result = await api.withdrawSelfCustody(
          {
            destinationAddress: destination,
            asset: tokenId,
            amount,
            destinationChain,
          },
          (stage) => setTxStage(stage === 'submitting' ? 'sending' : 'authorizing')
        );
      } else if (shouldUseNativeL1TwoStep(tokenId, targetToken)) {
        const opts = await api.getTxAuthOptions();
        result = await triggerNativeL1TwoStepPrompt({
          prepared: {
            step: 'native_auth',
            operation: 'native_withdraw',
            symbol: targetToken.symbol,
            amount,
            target: destination,
            nearAccount: user?.nearAccount || undefined,
            actionId: 'tx_auth_native_withdraw',
            options: opts,
            summary: `${targetToken.symbol} withdraws over NEAR L1. Step 1 signs with your passkey; Step 2 authorizes your NEAR L1 key to transfer ${amount} ${targetToken.symbol} to ${destination}.`,
          },
          submitAuthorized: async (assertion) => {
            setTxStage('sending');
            return await api.withdraw({
              destinationAddress: destination,
              asset: tokenId,
              amount,
              destinationChain,
              passkeyAssertion: assertion,
            });
          },
        });
      } else {
        let assertion: unknown = undefined;
        try {
          assertion = await authorizeWithPasskey(
            `Send ${amount} ${targetToken.symbol} to ${destination}`
          );
        } catch (authErr: any) {
          const msg = authErr?.message || 'Passkey authorization cancelled';
          setError(msg);
          throw new Error(msg);
        }

        setTxStage('sending');
        result = await api.withdraw({
          destinationAddress: destination,
          asset: tokenId,
          amount,
          destinationChain,
          passkeyAssertion: assertion,
        });
      }

      deductBalanceOptimistically(tokenId, targetToken.symbol, amount);
      loadHistory();
      void refreshBalances();

      return {
        txHash: result.txHash,
        withdrawalId: result.withdrawalId,
        destinationAddress: result.destinationAddress,
        shareLink: result.shareLink,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet send failed';
      setError(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
      setTxStage('idle');
    }
  };

  const cancelPayment = async (paymentId: string) => {
    try {
      setError(null);
      const res =
        user?.custodyMode === 'self'
          ? await api.cancelPaymentSelfCustody(paymentId)
          : await api.cancelPaymentServer(paymentId);
      await loadHistory();
      void refreshBalances();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel payment';
      setError(msg);
      throw err;
    }
  };

  // Load history
  const loadHistory = useCallback(async () => {
    try {
      if (globalHistoryCache.length === 0) {
        setIsLoadingHistory(true);
      }
      const items = await api.getPaymentHistory();
      if (Array.isArray(items)) {
        globalHistoryCache = items;
        setHistory(items);
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(items));
          }
        } catch {}
      }
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
    txStage,
    error,
    createdPayment,
    history,
    isLoadingHistory,
    updateQuote,
    sendPayment,
    sendToWallet,
    cancelPayment,
    loadHistory,
    resetCreatedPayment,
    balancesError,
    refreshBalances,
    clearError: () => setError(null),
  };
}
