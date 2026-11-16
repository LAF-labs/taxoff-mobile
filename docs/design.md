# 폰 디자인 기준

원본은 tex `sovereign-ax/design-system/` v2.0(2026-11-14, "Meta Muse처럼 정말 미니멀하게")이다. 색의 값과 뜻, 면·단추·상태 규칙은 PC와 같고, 크기만 폰에 맞췄다. 값은 `src/theme.ts` 한 곳에 있다.

## 크기

| | PC v2.0 | 폰 | 이유 |
|---|---|---|---|
| 본문·값 | 14 | 17 | iOS 본문 17pt. Android도 앱 안에서 17로 맞춘다 |
| 보조 | 13 | 15 | iOS subhead |
| 라벨·출처 | 12 | 13 | iOS footnote |
| 화면 제목 | 15/600 | 17/600 | 머리 48 가운데 |
| 단추 | 32·40 | 52(주요)·40(작은) | 엄지 누름, 누름 영역 44 미만 없음 |
| 목록 줄 | 36 | 52 이상 | |

크게 써서 강조하지 않는다. 금액·합계도 17이고, 중요한 값은 `ink` + 600으로만 올린다. 숫자는 고정폭(`tabular-nums`). 큰 글씨는 페어링 6자리(사람이 PC 화면과 한 글자씩 대조) 하나뿐이다. 글자 크기 설정은 따르되 1.6배에서 멈춘다(`MAX_FONT_SCALE`).

## 면과 색

- 바탕 `canvas` 하나, 묶음(`Group`)·입력은 `tint` 채움, 누름은 `sunken`. 카드 테두리·그림자 없음. 줄 사이는 안쪽 머리카락 선.
- 바닥 동작 줄(`Screen footer`)만 위에 머리카락 선이 있다(내용이 그 밑으로 스크롤되므로).
- 파랑(`accent`)은 "PC 켜짐 · 바로 받음"과 연결 완료 점, 그리고 승인 시트의 [승인하고 발급] 하나에만. 파랑 채움 단추는 폰 앱에서 그 하나뿐이다(ADR-046 결정 6, `Button kind="approve"`). 다른 화면의 주요 단추는 ink 채움이다.
- 황토(`attention`)는 확인 필요: 읽은 값의 확신이 낮은 칸("확인해 주세요"), 검산 오류, PC 연결 확인 필요.
- 완료는 체크 모양, 실패는 문구. 초록·빨강 없음.

## 부품(`src/ui/`)

| 부품 | 쓰는 곳 |
|---|---|
| `Screen` | 머리(뒤로 ‹ + 제목) · 내용(스크롤) · 바닥 동작 줄(주요 단추 하나, 안전 영역 위) |
| `Button` | primary(ink 채움 알약) 한 화면에 하나, secondary(tint), quiet(글자). 주요 단추는 누를 때 가벼운 진동 |
| `Group` / `Row` | 묶음과 줄. 왼쪽 라벨, 오른쪽 값, 누를 수 있으면 꺾쇠 |
| `Field` | 확인 화면의 값 칸: 평소에는 글자, 누르면 그 자리에서 칸. 빈 칸은 `line-strong` 테두리가 늘 보인다. 오류는 칸 아래에 남고, 한 번에 고치는 제안(예: 합계 맞추기)을 붙일 수 있다 |
| `Seg` | 둘 중 하나(매입·매출, 영수·청구) |
| `Replies` | 점선 전폭 답 후보(Muse 확인 UI). 고르면 실선 + 체크로 굳는다 |
| `StatusDot` | 점 + 글자. 진행 중이면 2.4초 주기로 숨 쉰다(동작 줄이기면 멈춤) |
| `Notice` | 사라지지 않는 안내 한 줄(한 화면에 하나까지) |
| `Empty` | 빈 화면: 무엇이 비었는지 · 왜 · 다음 할 일 하나 |
| `Pill` | 묶음 줄 안의 작은 동작(바탕색 알약 36, 누름 영역 44). 밀린 일 [취소] [다시 맡기기] 등 |

## 승인 시트(P-03, 기획 v2 PR 5)

- 바닥에서 올라오는 시트 하나에 비가역 행위 하나. 묶음 승인 없음. 값은 PC가 되읽은 값 전체(금액 → 받는 곳 → 내용 → 보내는 곳), 라벨은 앱 내장 사전.
- 폰이 cardHash·actionHash를 다시 계산해 맞을 때만 [승인하고 발급]이 켜진다. 시트가 뜬 뒤 0.8초는 잠김(무장 지연). 남은 시간 120초, 마지막 20초만 황토 + 600.
- 멈춤(처음 거래처 · 하루 5건 · 키 없음 · iPhone 거부 · 모르는 항목 · 해시 불일치)은 시트 안 Notice 한 줄 + 다음 할 일 단추. 새 알림창 없음.
- 같은 건 경고($dup.*)는 황토 면 한 줄 + [확인했어요]. 확인해야 승인이 켜진다.
- 결과 모름이면 다시 발급하는 단추를 두지 않는다([닫기]만).

## 진행·결과·서류(P-04·P-05, 기획 v2 PR 6)

- 진행 카드: 일 이름 + 합계, 상태 칩(진행 중 · 내 차례 · 중지됨 · 확인 중 · 확인 필요 · 발급됨) · 경과, 단계 줄은 지금 단계만 ink 600(지난 단계 ink3, 남은 단계 ink4). 화살표는 다음 단계 이름에 붙인다.
- 예외는 같은 카드 안 한 줄 + 다음 행동(08 §11). 폰에서 못 하는 행동(브라우저로 가기·금고 확인)은 [PC에서 열기 예약]. 중지 문구에는 "아무것도 발급하지 않았어요"를 그대로 둔다.
- 확인 중·확인 필요에는 다시 발급하는 단추가 없다. "발급목록에 없음" 증언은 PC에서만.
- 대화 카드 안 단추는 바탕색 알약(기본) + 글자(보조). 진행 화면 바닥은 ink 알약 하나 + 글자.
- 승인번호는 4자리씩 고정폭으로 라벨 아래 한 줄, 길게 누르면 원문 복사("복사했어요"는 그 자리 글자로).

## 앱 틀과 대화 홈(기획 v2)

- 아래 탭 셋(홈 · 돈 · 기록), 글자만. 고른 탭은 ink 600 + 밑 막대. 키보드가 올라오면 탭 줄을 숨기고 입력 줄이 키보드 위에 붙는다.
- 홈 맨 위: PC 한 줄(켜짐 파랑 점 · 꺼짐 "마지막 접속 n시간 전" · 오래 꺼짐 황토 · 연결 안 됨 [PC 연결하기]), 그 밑 "지금 할 일" tint 한 줄.
- 대화: PC 답은 바탕 위 글자, 카드 답은 tint 면(라벨·값 두 칸, 합계는 600), 내 말은 오른쪽 tint 말풍선. 폰에서 나눈 구간은 가운데 tint 알약 머리("폰에서 나눈 대화 · 오전 8:10~9:40").
- 바닥: 빠른 일 tint 알약(44) + 입력 칸 + [보내기](ink 알약, 이 화면의 주요 단추).
- 줄바꿈은 낱말 단위(iOS `hangul-word`, 웹 `keep-all`). 붙어 있어야 하는 묶음("밀린 일 1건")은 붙은 칸(U+00A0)으로 잇는다.

아이콘 묶음을 들이지 않는다. 꺾쇠·체크는 선 두 개로 그린다.

## 움직임과 진동

움직임은 상태가 바뀔 때만(점 숨쉬기, 카메라 셔터 누름 0.92배). 진동은 주요 단추·고르기(selection), 보내기 성공(success), 보낼 수 없음(warning) 셋뿐이다.

## 점검

`pnpm gallery`로 화면 갤러리를 웹으로 묶는다(가짜 세션, 네트워크·키·카메라 없음). `?s=home-chat-online`, `home-chat-offline`, `home-chat-merged`, `home-unpaired`, `home`, `home-stale`, `money-empty`, `records-empty`, `settings`, `home-chat-entrusted`, `queue-mixed`, `queue-empty`, `issue-picker`, `issue-picker-empty`, `issue-filled-online`, `issue-filled-offline`, `issue-stale`, `issue-first-counterparty`, `issue-duplicate`, `issue-limit`, `issue-inexact`, `approval-default`, `approval-arming`, `approval-urgent`, `approval-expired`, `approval-dup`, `approval-dup-acked`, `approval-unknown`, `approval-first`, `approval-limit`, `approval-no-key`, `approval-ios-allowed`, `approval-ios-denied`, `approval-mismatch`, `approval-in-doubt`, `approval-long`, `run-prepare`·`run-login`·`run-readback`·`run-issue`·`run-verify-step`, `run-simple-auth`, `run-simple-auth-unknown`, `run-cert`, `run-stop-blocked`, `run-stop-blocked-reserved`, `run-stop-unknown-screen`, `run-stop-date`, `run-stop-input`, `run-in-doubt`, `run-verify-needed`, `result-email`, `result-no-email`, `result-long`, `home-chat-run`, `home-chat-result`, `queue-with-done`, `doc-loading`, `doc-receiving`, `doc-pc-off`, `doc-pc-off-asked`, `doc-backup`, `doc-error`, `doc-ready`, `doc-long`, `demo`, `demo-in-doubt`, `cash`, `connection`, `invoice-confirm`, `invoice-issues`, `receipt-confirm`, `saved`, `camera`를 라이트·다크로 본다. `&fs=1.6`을 붙이면 글자 크기 1.6배를, `&w=375&h=667`이면 작은 폰(SE)을 흉내 낸다. 웹 번들에만 들어가고 앱 번들에는 들어가지 않는다(`metro.config.cjs`).
