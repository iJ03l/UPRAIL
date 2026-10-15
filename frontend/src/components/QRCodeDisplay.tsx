'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  value: string;
  size?: number;
  className?: string;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  value,
  size = 200,
  className = '',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value || value.trim().length === 0) {
      setDataUrl('');
      return;
    }

    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: {
        dark: '#0A0807',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch((err) => {
        console.error('QR code generation error:', err);
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!value) return null;

  return (
    <div
      style={{ backgroundColor: '#FFFFFF' }}
      className={`p-3 rounded-2xl border border-stone-200 shadow-sm inline-flex items-center justify-center ${className}`}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR Code for ${value}`}
          width={size}
          height={size}
          className="rounded-xl block select-none max-w-full h-auto"
        />
      ) : (
        <div
          style={{ width: size, height: size, maxWidth: '100%' }}
          className="animate-pulse bg-stone-100 rounded-xl flex items-center justify-center text-xs font-mono text-stone-400"
        >
          Generating QR...
        </div>
      )}
    </div>
  );
};
