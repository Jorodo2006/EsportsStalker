import { useEffect, useState } from 'react';

// Si la pantalla cumple una media query (por ejemplo, para montar una columna sólo en pantallas anchas)
export function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return on;
}
