'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, DownloadSimple, Key, ShieldCheck } from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';

export interface RecoveryCodesModalProps {
  isOpen: boolean;
  codes: string[];
  onDone: () => void;
  title?: string;
  description?: string;
  notice?: string;
  doneLabel?: string;
}

export const RecoveryCodesModal: React.FC<RecoveryCodesModalProps> = ({
  isOpen,
  codes,
  onDone,
  title = 'Save your recovery codes',
  description = 'Each code works once. Use one if you ever lose your passkey; it lets you register a new passkey on another device.',
  notice = 'UPRAIL cannot recover these for you. Anyone with a code can replace your passkey, so keep them private.',
  doneLabel = 'I saved these codes',
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) setCopied(false);
  }, [isOpen]);

  const codesText = useMemo(() => codes.join('\n'), [codes]);

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codesText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [
        'UPRAIL passkey recovery codes\n',
        'Each code works once. Keep them somewhere safe and offline.\n\n',
        codesText,
        '\n',
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'uprail-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={() => {}}
      canClose={false}
      showCloseButton={false}
      zIndexClass="z-[140]"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 sm:p-7 pt-6 pb-6"
      ariaLabelledBy="recovery-codes-title"
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl border border-stone-200 bg-stone-100 flex items-center justify-center flex-shrink-0">
          <Key weight="fill" className="w-5 h-5 text-stone-900" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <h3
            id="recovery-codes-title"
            className="text-lg sm:text-xl font-display font-extrabold tracking-tight text-stone-950"
          >
            {title}
          </h3>
          <p className="text-xs leading-relaxed text-stone-600">{description}</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {codes.map((code, index) => (
            <div
              key={`${code}-${index}`}
              className="flex items-center gap-2 font-mono text-[12px] tracking-wide text-stone-900"
            >
              <span className="w-5 text-right text-[10px] text-stone-400">{index + 1}.</span>
              <span className="select-all">{code}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-relaxed text-amber-900">
        <ShieldCheck weight="fill" className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-700" />
        <span>{notice}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={copyCodes}
          className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-display font-bold transition-colors cursor-pointer min-h-11"
        >
          {copied ? <Check weight="bold" className="w-3.5 h-3.5" /> : <Copy weight="fill" className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy all'}</span>
        </button>
        <button
          type="button"
          onClick={downloadCodes}
          className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-display font-bold transition-colors cursor-pointer min-h-11"
        >
          <DownloadSimple weight="fill" className="w-3.5 h-3.5" />
          <span>Download</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-2.5 w-full py-3.5 px-4 rounded-2xl bg-black hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
      >
        {doneLabel}
      </button>
    </ModalSheet>
  );
};
