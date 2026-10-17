import React from 'react';

export const Code: React.FC<{ children: React.ReactNode; title?: string }> = ({
  children,
  title,
}) => (
  <div className="rounded-2xl overflow-hidden border border-stone-800 bg-stone-950">
    {title && (
      <div className="px-4 py-2 border-b border-stone-800 text-[11px] font-mono font-bold uppercase tracking-wider text-stone-400">
        {title}
      </div>
    )}
    <pre className="p-4 overflow-x-auto text-[12px] leading-relaxed font-mono text-stone-200">
      <code>{children}</code>
    </pre>
  </div>
);

export const Callout: React.FC<{
  children: React.ReactNode;
  tone?: 'info' | 'warn';
}> = ({ children, tone = 'info' }) => (
  <div
    className={`p-4 rounded-2xl border text-sm leading-relaxed ${
      tone === 'warn'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : 'bg-stone-50 border-stone-200 text-stone-700'
    }`}
  >
    {children}
  </div>
);

export const Method: React.FC<{ verb: string }> = ({ verb }) => (
  <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-mono font-bold uppercase">
    {verb}
  </span>
);

export const Endpoint: React.FC<{ verb: string; path: string; auth?: string }> = ({
  verb,
  path,
  auth,
}) => (
  <div className="flex flex-wrap items-center gap-2 py-2">
    <Method verb={verb} />
    <code className="text-[13px] font-mono font-bold text-stone-900">{path}</code>
    {auth && (
      <span className="text-[11px] font-mono text-stone-400 border-l border-stone-200 pl-2">
        {auth}
      </span>
    )}
  </div>
);

export const Field: React.FC<{
  name: string;
  type: string;
  required?: boolean;
  children?: React.ReactNode;
}> = ({ name, type, required, children }) => (
  <div className="grid sm:grid-cols-[200px_1fr] gap-1 sm:gap-3 py-2.5 border-b border-stone-100 last:border-0">
    <div className="font-mono text-[13px]">
      <span className="text-stone-900 font-bold">{name}</span>
      <span className="text-stone-400">:{type}</span>
      {required && <span className="ml-2 text-[10px] text-red-600 font-bold uppercase">req</span>}
    </div>
    <div className="text-sm text-stone-600">{children}</div>
  </div>
);
