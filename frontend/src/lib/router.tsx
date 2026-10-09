'use client';

import React from 'react';
import NextLink, { LinkProps as NextLinkProps } from 'next/link';
import {
  useRouter as useNextRouter,
  usePathname,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to?: string;
  href?: string;
  children: React.ReactNode;
}

/**
 * Universal Link component supporting both `to` and `href`
 */
export const Link: React.FC<LinkProps> = ({ to, href, children, className, ...props }) => {
  const destination = href || to || '#';
  return (
    <NextLink href={destination} className={className} {...props}>
      {children}
    </NextLink>
  );
};

/**
 * Universal useNavigate hook compatible with Next.js navigation
 */
export function useNavigate() {
  const router = useNextRouter();
  return (path: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      router.replace(path);
    } else {
      router.push(path);
    }
  };
}

/**
 * Universal useLocation hook returning current pathname and search
 */
export function useLocation() {
  const pathname = usePathname() || '/';
  const searchParams = useNextSearchParams();
  const search = searchParams ? `?${searchParams.toString()}` : '';
  return { pathname, search };
}

/**
 * Universal useSearchParams hook
 */
export function useSearchParams() {
  const searchParams = useNextSearchParams();
  return [searchParams || new URLSearchParams(), () => {}] as const;
}

/**
 * Client-side Navigate component for route redirects
 */
export const Navigate: React.FC<{ to: string; replace?: boolean; state?: any }> = ({
  to,
  replace,
}) => {
  const router = useNextRouter();
  React.useEffect(() => {
    if (replace) {
      router.replace(to);
    } else {
      router.push(to);
    }
  }, [to, replace, router]);
  return null;
};
