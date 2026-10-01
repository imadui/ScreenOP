import { useEffect, useState } from 'react';

/** Minimal hash router — each window loads the same bundle at a different `#/route`. */
export function currentRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function navigate(route: string): void {
  if (currentRoute() !== route) window.location.hash = route;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
