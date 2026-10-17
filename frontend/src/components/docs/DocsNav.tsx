'use client';

import React from 'react';
import { Link, useLocation } from '@/lib/router';

const LINKS: { to: string; label: string }[] = [
  { to: '/docs', label: 'Overview' },
  { to: '/docs/agents', label: 'Agent rail' },
  { to: '/docs/mcp', label: 'MCP server' },
  { to: '/docs/x402', label: 'x402 / MPP' },
  { to: '/docs/fees', label: 'Creator fees' },
];

export const DocsNav: React.FC = () => {
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/docs';

  return (
    <nav className="space-y-0.5">
      {LINKS.map((link) => {
        const active = path === link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-stone-900 text-white'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
};
