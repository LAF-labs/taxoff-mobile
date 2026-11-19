// 글자 크기 설정(AppData.textSize)을 앱 전체에 건다: textScale.web에 배율을 넣고, 컨텍스트 값을 바꿔 T가 다시 그려지게 한다.
// 갤러리(웹)의 ?fs= 흉내는 base로 받아 곱한다.
import type { ReactNode } from 'react';
import { useSession } from '../session';
import { TEXT_SIZE_FACTOR, TextSizeContext, textScale } from '../theme';

export function TextSizeHost({ children, base = 1 }: { children: ReactNode; base?: number }) {
  const s = useSession();
  const k = base * TEXT_SIZE_FACTOR[s.data.textSize ?? 'medium'];
  // 그리기 전에 값을 넣는다(아래 T가 이번 그리기에서 바로 읽는다)
  textScale.web = k;
  return <TextSizeContext.Provider value={k}>{children}</TextSizeContext.Provider>;
}
