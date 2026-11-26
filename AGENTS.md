# 에이전트 공통 규칙 (폰 앱)

공통 규칙은 tex 저장소의 [`AGENTS.md`](https://github.com/LAF-labs/tex/blob/main/AGENTS.md)다. PR 흐름, 검증, 바꾸지 않는 제품 결정, 화면 글 규칙이 거기 있고 이 저장소도 그대로 따른다. 코드 품질 원칙은 tex `sovereign-ax/handover/code-quality.md`, 대표 개입에서 나온 규칙은 tex `sovereign-ax/handover/working-notes.md` 1절이다.

이 저장소에만 있는 것:

- `vendor/sax-remote/`, `vendor/sax-redaction/`, `vendor/sax-chat-core/`는 tex `poc/packages/`의 고정 사본이다. 여기서 고치지 않는다. tex에서 고친 뒤 `pnpm sync:remote <tex 체크아웃> [remote|redaction|chat-core]`으로 맞춘다.
- PR 전에 `pnpm check`를 돌리고 결과를 PR 본문에 적는다.
- 폰 PR은 맥북에서 iOS 빌드와 실기기 확인을 한 뒤 합친다. 화면이 바뀌면 캔버스에서 대표 승인을 먼저 받는다.
- 폰에는 아래 탭바가 없다. 왼쪽 위 더보기 서랍과 오른쪽 위 PC 상태(유리 단추, 대화 화면만), 떠 있는 입력창을 쓴다(2026-11-24, `src/ui/float.tsx`, `src/ui/drawer.tsx`). 시트와 메뉴 같은 다른 부품은 애플 기본 UI를 먼저 쓴다.
- 폰에는 "PC 화면을 봐 달라", "PC에서 먼저 해 주세요" 같은 안내를 넣지 않는다. QR 연결 화면만 예외다.
- Android는 아직 승인 기기가 아니다.
- 디자인 기준은 [docs/design.md](docs/design.md). 맨 앞 "확정 기준 v3.0"을 먼저 읽는다. 새 화면은 `src/ui/` 부품만 써서 만들고, 화면에서 시트, 테두리, 색 값을 직접 쓰지 않는다. `node test/design-check.ts`가 어긋남을 잡고 기준선(`test/design-baseline.json`)은 줄이기만 한다.
