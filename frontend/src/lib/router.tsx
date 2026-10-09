import React from 'react';
import {
  Link as RouterLink,
  useNavigate as useRouterNavigate,
  useLocation as useRouterLocation,
  useSearchParams as useRouterSearchParams,
  Navigate as RouterNavigate,
} from 'react-router-dom';

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to?: string;
  href?: string;
  children: React.ReactNode;
}

/**
 * Universal Link component supporting both `to` and `href`
 */
export const Link: React.FC<LinkProps> = ({ to, href, children, className, ...props }) => {
  const destination = to || href || '#';
  return (
    <RouterLink to={destination} className={className} {...props}>
      {children}
    </RouterLink>
  );
};

/**
 * Universal useNavigate hook compatible with react-router-dom
 */
export function useNavigate() {
  const navigate = useRouterNavigate();
  return (path: string, options?: { replace?: boolean }) => {
    navigate(path, options);
  };
}

/**
 * Universal useLocation hook returning current pathname and search
 */
export function useLocation() {
  const location = useRouterLocation();
  return { pathname: location.pathname, search: location.search };
}

/**
 * Universal useSearchParams hook
 */
export function useSearchParams() {
  return useRouterSearchParams();
}

/**
 * Client-side Navigate component for route redirects
 */
export const Navigate: React.FC<{ to: string; replace?: boolean; state?: any }> = ({
  to,
  replace,
  state,
}) => {
  return <RouterNavigate to={to} replace={replace} state={state} />;
};
