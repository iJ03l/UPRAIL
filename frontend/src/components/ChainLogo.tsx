import React from 'react';

interface ChainLogoProps {
  chainId: string;
  className?: string;
}

export const ChainLogo: React.FC<ChainLogoProps> = ({ chainId, className = 'w-6 h-6' }) => {
  const id = (chainId || '').toLowerCase();

  switch (id) {
    case 'near':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 100 100" fill="none" className="w-full h-full">
            <circle cx="50" cy="50" r="50" fill="#000000" />
            <g transform="translate(19,19) scale(0.69)" fill="white">
              <path d="M72.2,4.6L53.4,32.5c-1.3,1.9,1.2,4.2,3,2.6L74.9,19c0.5-0.4,1.2-0.1,1.2,0.6v50.3c0,0.7-0.9,1-1.3,0.5l-56-67C17,1.2,14.4,0,11.5,0h-2C4.3,0,0,4.3,0,9.6v70.8C0,85.7,4.3,90,9.6,90c3.3,0,6.4-1.7,8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6l-18.5,16c-0.5,0.4-1.2,0.1-1.2-0.6V20.1c0-0.7,0.9-1,1.3-0.5l56,67c1.8,2.2,4.5,3.4,7.3,3.4h2c5.3,0,9.6-4.3,9.6-9.6V9.6c0-5.3-4.3-9.6-9.6-9.6C77.1,0,74,1.7,72.2,4.6z" />
            </g>
          </svg>
        </div>
      );

    case 'eth':
    case 'ethereum':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#627EEA" />
            <g fill="#FFFFFF">
              <path d="M16 4v9.06l7.67 3.44L16 4z" fillOpacity="0.6" />
              <path d="M16 4L8.33 16.5 16 13.06V4z" />
              <path d="M16 21.61v6.39l7.67-10.59L16 21.61z" fillOpacity="0.6" />
              <path d="M16 28V21.6l-7.67-4.2L16 28z" />
              <path d="M16 20.35l7.67-4.44L16 13.06v7.29z" fillOpacity="0.2" />
              <path d="M8.33 15.91l7.67 4.44v-7.29l-7.67 2.85z" fillOpacity="0.6" />
            </g>
          </svg>
        </div>
      );

    case 'btc':
    case 'bitcoin':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#F7931A" />
            <path
              fill="#FFFFFF"
              d="M22.8 13.2c.3-1.9-.9-2.9-2.6-3.6l.5-2.1-1.3-.3-.5 2c-.3-.1-.7-.2-1.1-.3l.5-2.1-1.3-.3-.5 2.1c-.3-.1-.6-.1-.9-.2l-1.8-.4-.3 1.4s1 .2 1 .2c.5.1.7.5.6.8l-1.5 5.9c0 .1.1.3.1.4-.1 0-.3 0-.5-.1 0 0-1-.2-1-.2l-.7 1.6 1.7.4c.3.1.6.2.9.2l-.5 2.2 1.3.3.5-2.1c.4.1.7.2 1.1.3l-.5 2.1 1.3.3.5-2.2c2.2.4 3.9.2 4.6-1.7.6-1.5 0-2.4-1.1-3 1.2-.5 1.7-1.4 1.4-2.8zm-2.5 5.4c-.4 1.6-3.1.7-4 .5l.7-2.9c.9.2 3.6.7 3.3 2.4zm.4-4.5c-.4 1.5-2.6.7-3.4.5l.6-2.6c.8.2 3.1.6 2.8 2.1z"
            />
          </svg>
        </div>
      );

    case 'sol':
    case 'solana':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#000000" />
            <path
              fill="url(#chain_sol_grad)"
              d="M8.5 21.7c.1-.1.3-.2.5-.2h12.9c.2 0 .4.1.5.2l1.6 1.6c.2.2.1.6-.2.6H10.9c-.2 0-.4-.1-.5-.2l-1.9-2zm0-5.8c.1-.1.3-.2.5-.2h12.9c.2 0 .4.1.5.2l1.6 1.6c.2.2.1.6-.2.6H10.9c-.2 0-.4-.1-.5-.2l-1.9-2zm2.1-7.8h12.9c.2 0 .4.1.5.2l1.6 1.6c.2.2.1.6-.2.6H10.9c-.2 0-.4-.1-.5-.2l-1.9-2c-.1-.1-.1-.4.1-.5l1.9-1.7z"
            />
            <defs>
              <linearGradient id="chain_sol_grad" x1="8" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      );

    case 'base':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#0052FF" />
            <path
              fill="#FFFFFF"
              d="M16 8.5C11.86 8.5 8.5 11.86 8.5 16s3.36 7.5 7.5 7.5c3.82 0 6.98-2.86 7.43-6.55h-4.97A2.5 2.5 0 1116 13.5c1.15 0 2.12.77 2.43 1.83h5.02A7.51 7.51 0 0016 8.5z"
            />
          </svg>
        </div>
      );

    case 'arbitrum':
    case 'arb':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#28A0F0" />
            <path fill="#FFFFFF" d="M16 6.5L8.5 18.2l2.3 3.6 5.2-8.1 5.2 8.1 2.3-3.6L16 6.5zm-3.2 15.5l3.2 5 3.2-5-3.2-4.9-3.2 4.9z" />
          </svg>
        </div>
      );

    case 'pol':
    case 'polygon':
    case 'matic':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#8247E5" />
            <path fill="#FFFFFF" d="M16 9.5l5.5 3.2v6.4L16 22.3l-5.5-3.2v-6.4L16 9.5zm0 2.3l-3.5 2v4l3.5 2 3.5-2v-4l-3.5-2z" />
          </svg>
        </div>
      );

    case 'op':
    case 'optimism':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#FF0420" />
            <path
              fill="#FFFFFF"
              d="M10.8 11.2c-2.4 0-3.8 1.9-3.8 4.8 0 2.9 1.4 4.8 3.8 4.8 2.4 0 3.8-1.9 3.8-4.8 0-2.9-1.4-4.8-3.8-4.8zm0 7.4c-1.1 0-1.7-1.1-1.7-2.6s.6-2.6 1.7-2.6c1.1 0 1.7 1.1 1.7 2.6s-.6 2.6-1.7 2.6zm6.8-7.2h3.5c2.3 0 3.9 1.4 3.9 3.6s-1.6 3.6-3.9 3.6h-1.5v2.2h-2V11.4zm3.4 5.3c1.1 0 1.9-.6 1.9-1.7s-.8-1.7-1.9-1.7h-1.4v3.4h1.4z"
            />
          </svg>
        </div>
      );

    case 'bsc':
    case 'bnb':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
            <path fill="#FFFFFF" d="M16 8l3 3-4.7 4.7 1.7 1.7L20.7 12.7 23.7 15.7 16 23.4l-7.7-7.7 3-3 4.7 4.7 1.7-1.7L13 11 16 8zm0 5.4l1.6 1.6-1.6 1.6-1.6-1.6L16 13.4z" />
          </svg>
        </div>
      );

    case 'avax':
    case 'avalanche':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#E84142" />
            <path fill="#FFFFFF" d="M16 7.5L8.5 20.8h4.6l2.9-5.1 2.9 5.1h4.6L16 7.5zm0 8.6l-1.8 3.2h3.6L16 16.1z" />
          </svg>
        </div>
      );

    case 'tron':
    case 'trx':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#FF060A" />
            <path fill="#FFFFFF" d="M8.5 9.5l14.2 4.2-11.9 8.8L8.5 9.5zm2.1 2.3l1.8 7.2 7.7-5.7-9.5-1.5z" />
          </svg>
        </div>
      );

    case 'doge':
    case 'dogecoin':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#C2A633" />
            <path
              fill="#FFFFFF"
              d="M11 9.5h5.5c3.6 0 6 2.5 6 6.5s-2.4 6.5-6 6.5H11V9.5zm3.2 3v2.3h3.5v1.8h-3.5v3.1h2.2c2.1 0 3.3-1.4 3.3-3.6 0-2.3-1.2-3.6-3.3-3.6h-2.2z"
            />
          </svg>
        </div>
      );

    case 'scroll':
      return (
        <div className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}>
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
            <circle cx="16" cy="16" r="16" fill="#FFE799" />
            <path fill="#D27A3A" d="M16 9c-3.9 0-7 3.1-7 7s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 2.5c2.5 0 4.5 2 4.5 4.5s-2 4.5-4.5 4.5-4.5-2-4.5-4.5 2-4.5 4.5-4.5z" />
          </svg>
        </div>
      );

    default:
      return (
        <div className={`rounded-full bg-stone-900 text-stone-200 font-mono text-[10px] font-bold flex items-center justify-center flex-shrink-0 border border-stone-800 ${className}`}>
          <span>{id.slice(0, 3).toUpperCase()}</span>
        </div>
      );
  }
};
