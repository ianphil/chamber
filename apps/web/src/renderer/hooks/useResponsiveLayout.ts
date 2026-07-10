import { useEffect, useState } from 'react';

// Tailwind default breakpoints we care about for shell layout.
const MD_BREAKPOINT = 768;
const LG_BREAKPOINT = 1024;

export interface ResponsiveLayout {
  /** True when viewport is below `lg` (1024px). History panel should auto-collapse. */
  shouldAutoCollapseHistory: boolean;
  /** True when viewport is below `md` (768px). Agents column should clamp to min width. */
  shouldClampMindSidebar: boolean;
}

function readLayout(): ResponsiveLayout {
  if (typeof window === 'undefined') {
    return { shouldAutoCollapseHistory: false, shouldClampMindSidebar: false };
  }
  const w = window.innerWidth;
  return {
    shouldAutoCollapseHistory: w < LG_BREAKPOINT,
    shouldClampMindSidebar: w < MD_BREAKPOINT,
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState<ResponsiveLayout>(() => readLayout());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setLayout(readLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return layout;
}
