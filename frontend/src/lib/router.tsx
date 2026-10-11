'use client';

/**
 * Next.js-native re-implementation of the react-router API surface the app uses.
 *
 * Keeping this thin adapter means views/components keep importing `Link`,
 * `useNavigate`, `useLocation`, `useSearchParams` and `Navigate` from
 * `lib/router` unchanged while the router underneath is Next's App Router.
 *
 * All hooks here are client hooks: any page that renders a component importing
 * this module must be a client component wrapped in `<Suspense>` (Next requires
 * a Suspense boundary for `useSearchParams` during static prerendering).
 */

import React, { Suspense, useEffect } from 'react';
import NextLink from 'next/link';
import {
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to?: string;
  href?: string;
  children: React.ReactNode;
}

/**
 * Universal Link component supporting both `to` and `href`.
 */
export const Link: React.FC<LinkProps> = ({ to, href, children, className, ...props }) => {
  const destination = to || href || '#';
  return (
    <NextLink href={destination} className={className} {...props}>
      {children}
    </NextLink>
  );
};

/**
 * Universal useNavigate hook compatible with the react-router signature used
 * throughout the app: `navigate(path, { replace?: boolean })`.
 */
export function useNavigate() {
  const router = useRouter();
  return (path: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      router.replace(path);
    } else {
      router.push(path);
    }
  };
}

/**
 * Universal useLocation hook returning the current pathname and search string.
 */
export function useLocation() {
  const pathname = usePathname();
  const searchParams = useNextSearchParams();
  const query = searchParams?.toString() ?? '';
  return { pathname, search: query ? `?${query}` : '' };
}

/**
 * react-router style `useSearchParams()` — returns a tuple whose first element
 * is a URLSearchParams instance.
 */
export function useSearchParams(): [URLSearchParams] {
  const searchParams = useNextSearchParams();
  return [searchParams ?? new URLSearchParams()];
}

/**
 * Client-side redirect, matching the react-router `<Navigate>` component.
 */
export const Navigate: React.FC<{ to: string; replace?: boolean; state?: any }> = ({
  to,
  replace,
}) => {
  const router = useRouter();

  useEffect(() => {
    if (replace) {
      router.replace(to);
    } else {
      router.push(to);
    }
  }, [router, to, replace]);

  return null;
};
const DefaultSuspenseFallback = () => null;

/**
 * Suspense boundary every page must wrap its content with: Next.js requires one
 * around any component calling `useSearchParams` during static prerendering.
 */
export const PageSuspense: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({
  children,
  fallback,
}) => <Suspense fallback={fallback ?? <DefaultSuspenseFallback />}>{children}</Suspense>;
