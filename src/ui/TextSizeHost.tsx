import type { ReactNode } from 'react';
import { useSession } from '../session';
import { TEXT_SIZE_FACTOR, TextSizeContext, textScale } from '../theme';

export function TextSizeHost({ children, base = 1 }: { children: ReactNode; base?: number }) {
  const s = useSession();
  const k = base * TEXT_SIZE_FACTOR[s.data.textSize ?? 'medium'];
  textScale.web = k;
  return <TextSizeContext.Provider value={k}>{children}</TextSizeContext.Provider>;
}
