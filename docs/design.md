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

## 돈 탭(기획 v2 PR 8, 11-cash-flow §3.7)

- 위에서부터 알림 한 줄(있을 때만, 주의 면은 하나) → 이번 달(라벨 왼쪽·금액 오른쪽 세 줄) + 기준 줄 → 받을 돈 → 낼 돈 → 앞으로 30일 → "세무·회계 의견이 아니에요".
- 기준 줄: PC에서 지금 받았으면 "기준 11월 17일 오전 9:10 · 계좌 2개", 아니면 "PC에서 마지막으로 받은 값이에요 · 어제 오후 6:20".
- 모르는 것을 0으로 보이지 않는다: 이번 달 숫자는 "—"와 "확인 못 함 · ○○ 계좌 거래내역이 7일 넘게 오래됐어요".
- 금액은 줄바꿈 없이 고정폭, 1억이 넘으면 "1억 2,345만원"처럼 줄이고 누르면 정확한 값. 기한 지남은 황토 글자(면이 아니다).
- 받을 돈 줄의 [받았어요] → 받은 방법(현금·다른 계좌·상계·기타) · 금액 · 날짜 → 줄 아래 "받음 처리했어요 · [되돌리기]". 낼 돈은 보기만.

## 찍기 화면(P-08·사업자등록증)

- 카메라와 앨범 둘 다(2026-11-16 대표 결정). 셔터 왼쪽에 [앨범] 글자 단추. 카메라 권한 전에는 셔터를 숨기고 [앨범]은 그대로 둔다.
- 권한 문구는 두 줄(굵게 이유 / 작게 안심). 한 번 거절했으면 [설정에서 허용].
- 앨범에서 고른 사진은 자르지 않고 같은 읽기·확인 화면으로. 확인 화면 회색 줄 "사진은 PC에 보관해요 · 앨범 원본은 그대로 둬요".

## 앱 잠금(P-01)

- 조용한 면 하나에 가운데 단추 하나("Face ID로 열기"·"Touch ID로 열기"·"지문으로 열기"·"얼굴로 열기", 기기 종류에 맞게). 앱 이름·자물쇠는 두지 않는다.
- 해제는 생체 또는 폰 암호로 열리는 키 항목 읽기(D08 §3.1, 2026-11-17 대표 결정 "비밀번호 허용"). 생체가 실패하면 OS 기본 대체("암호 입력")가 뜬다.
- 실패는 같은 화면에 두 줄(굵게 무엇이 / 작게 어떻게) + [다시 시도], 그 아래 회색 글자 단추 [폰 암호로 열기]. 생체 미등록 폰은 처음부터 [폰 암호로 열기]가 기본 단추.
- 첫 실행 온보딩(`OnboardingScreen`, 스플래시 직후·열쇠 만들기 앞, 한 번만): 세 장(편리함 · 할 수 있는 일 · 보안). 위 왼쪽 작은 표시+이름, 1·2장 오른쪽 위 [건너뛰기], 바닥 점 셋(고른 점은 길게) + [다음](ink 채움, 마지막 장도 [다음] → 열쇠 만들기의 [시작하기]). 각 장은 tint 큰 면(xl) 안의 그림 + 제목 17/600 + 풀이 15. 그림은 실제 화면을 줄인 모형(대화와 [승인하고 발급] 카드, 할 일 네 줄, 자물쇠와 사실 네 줄)이라 앱의 면·색 규칙을 그대로 따른다. 3D 모션: 넘길 때 그림 면이 원근 속에서 돌아 들어오고(rotateY ±32°, 0.84배, 옆 장은 흐리게), 장이 보이면 겹마다 깊이가 다르게 차례로 떠오른다(대화 → 카드 → [승인하고 발급]과 지나가는 빛 / 기능 줄이 위에서 뒤집히며 / 자물쇠가 돌아 들어와 고리가 철컥 내려앉고 물결, 체크가 차례로). 그 뒤에는 카드·빛이 잔잔히 떠 있다(사인 반복). 떠 있는 겹에만 은은한 그림자를 쓴다(앱 화면 카드에는 여전히 그림자 없음). 모두 transform·opacity, 네이티브 드라이버(새 의존성 없음). 동작 줄이기면 움직임 없이 완성 상태.
- 첫 실행 한 흐름(점 다섯 개가 이어진다): 시스템 스플래시 → 같은 모습의 덮개에서 표시가 한 번 숨 쉰 뒤(약 1.8~2초) 덮개가 제자리에서 바래며 첫 장이 넘겨 들어온다 → 온보딩 1~3 → 열쇠 만들기(4/5) → PC와 연결(5/5) → 연결 끝 장면(체크·물결, [시작하기]) → 홈. 4·5는 앞 장과 같은 틀(OnboardingStep: 머리 표시+이름, tint 그림 면, 제목·풀이, 점, 바닥 단추 자리)이고 들어올 때 앞 장을 넘긴 것처럼 돌아 들어온다. 4·5에서 ‹ 또는 왼쪽 가장자리 쓸기 → 온보딩 3장, [다음]은 온 단계로(열쇠는 다시 만들지 않는다). PC와 연결에는 건너뛰기가 없다(연결해야 쓸 수 있다). 카메라 전에는 바닥 [카메라 켜기], 켠 뒤에는 그 자리에 "QR이 보이면 저절로 넘어가요".
- 온보딩 글은 코드에 있는 사실만: 홈택스 비밀번호·인증서는 PC 금고, 폰↔PC는 릴레이가 못 여는 암호, 승인은 매번 생체, 열쇠는 ThisDeviceOnly·백업 제외·PC에서 끊기. iPhone은 하드웨어 키 증명이 없으니 "하드웨어"라고 쓰지 않는다. 넘긴 시각은 설치 표지(`onboardedAt`)에 적고, 초기화 뒤에도 다시 보이지 않는다.
- 첫 실행(열쇠 만들기, 온보딩 다음)만 다르다: 표시(96) + "이 폰에만 있는 열쇠를 만들어요" + 풀이 한 줄, 그 아래 tint 면에 체크 두 줄(폰 밖으로 나가지 않음 · 앞으로 열 때 무엇으로 확인하는지, 생체 없는 폰은 폰 암호), 바닥 [시작하기] 하나.
- 스플래시는 앱 바탕색(라이트 `#FCFCFC` · 다크 `#181819`) 위 표시 하나(`assets/splash-icon*.png`, tax.laf-co.com 파비콘과 같은 문서+체크 표시). 첫 화면이 그려진 다음 프레임에 걷는다(App.tsx). 빈 바탕 한 장이 끼지 않는다.
- 폰 암호가 없는 폰은 열 수 없다는 것과 설정에서 할 일을 먼저 보인다. 잠금 끄기는 없다. 설정 줄은 "앱 잠금 · 켜짐 / Face ID, 안 되면 폰 암호".
- 다른 앱으로 넘어가면 바탕색 면으로 가린다(앱 전환 화면). 승인 서명과 시작 게이트는 잠금 해제와 별개로 매번 생체만 + 하드웨어 키(폰 암호 대체 없음).

## PC 사본(remote-envelope v1.8 phone.copy)

- 발급 거래처 고르기: 저장소에 거래처가 없으면 사본 거래처로 채우고, 최근 거래처 아래 회색 한 줄 "PC 기준 11월 17일 오전 10:00". 사본이 없으면 그대로(빈 상태).
- 돈 탭: 받아 둔 요약이 없으면 사본 돈 요약. 숫자는 PC 값 그대로, null은 "—"와 "확인 못 함" 한 줄. 알림은 PC 문구 그대로 Notice 하나.
- 받을 돈·낼 돈 카드는 사본에 목록이 없어 누르지 않는다(꺾쇠 없음). 아래 회색 한 줄 "한 건씩 보는 목록은 PC에서 볼 수 있어요".

## 폰 발급 명령(cmd.run, remote-envelope v1.8)

- PC 사본에서 고른 거래처는 [발급 맡기기](꺼져 있으면 [PC 켜지면 맡기기])로 PC에 보낸다. 거래처는 ref만, 작성일자는 오늘(한국 시간, 고칠 수 없는 줄), 단추 위 회색 한 줄 "승인은 PC 승인 바에서 해요".
- 보내기 전에 cmdId를 봉인 상태에 저장하고, 다시 연결하면 같은 cmdId로 다시 보낸다. 보낸 뒤에는 폰에서 취소하지 않는다.
- 진행은 기존 진행 카드·화면을 그대로 쓴다. 승인 단계는 황토 한 줄 "PC 승인 바에서 승인해 주세요". 폰에서는 지켜보기만 하고 바닥 단추는 [닫기] 하나.
- PC가 받지 않으면 칩 "시작 못 함" + 이유 한 줄(단계 막대 없음). 결과는 승인번호·합계·이메일 여부, 서류는 "PC 기록에 있어요".

## 승인 시트(P-03, 기획 v2 PR 5)

- 바닥에서 올라오는 시트 하나에 비가역 행위 하나. 묶음 승인 없음. 값은 PC가 되읽은 값 전체(금액 → 받는 곳 → 내용 → 보내는 곳), 라벨은 앱 내장 사전.
- 폰이 cardHash·actionHash를 다시 계산해 맞을 때만 [승인하고 발급]이 켜진다. 시트가 뜬 뒤 0.8초는 잠김(무장 지연). 남은 시간 120초, 마지막 20초만 황토 + 600.
- 멈춤(처음 거래처 · 하루 5건 · 키 없음 · 정책으로 iPhone을 막은 경우 · 모르는 항목 · 해시 불일치)은 시트 안 Notice 한 줄 + 다음 할 일 단추. 새 알림창 없음.
- 같은 건 경고($dup.*)는 황토 면 한 줄 + [확인했어요]. 확인해야 승인이 켜진다.
- 결과 모름이면 다시 발급하는 단추를 두지 않는다([닫기]만).
- iPhone(앱 무결성만, `ios_app_attest`)도 승인 기기로 받는다(ADR-046 결정 4 채택, tex #403). 하루 5건·처음 거래처 PC 승인은 그대로이고, 단추 위 회색 한 줄 "이 iPhone은 앱 무결성만 확인돼요"를 둔다.

## 진행·결과·서류(P-04·P-05, 기획 v2 PR 6)

- 진행 카드: 일 이름 + 합계, 상태 칩(진행 중 · 내 차례 · 중지됨 · 확인 중 · 확인 필요 · 발급됨) · 경과, 단계 줄은 지금 단계만 ink 600(지난 단계 ink3, 남은 단계 ink4). 화살표는 다음 단계 이름에 붙인다.
- 예외는 같은 카드 안 한 줄 + 다음 행동(08 §11). 폰에서 못 하는 행동(브라우저로 가기·금고 확인)은 [PC에서 열기 예약]. 중지 문구에는 "아무것도 발급하지 않았어요"를 그대로 둔다.
- 확인 중·확인 필요에는 다시 발급하는 단추가 없다. "발급목록에 없음" 증언은 PC에서만.
- 대화 카드 안 단추는 바탕색 알약(기본) + 글자(보조). 진행 화면 바닥은 ink 알약 하나 + 글자.
- 승인번호는 4자리씩 고정폭으로 라벨 아래 한 줄, 길게 누르면 원문 복사("복사했어요"는 그 자리 글자로).

## 앱 틀과 대화 홈(기획 v2)

- 아래 탭 셋(홈 · 돈 · 기록), 글자만. 고른 탭은 ink 600 + 밑 막대. 키보드가 올라오면 탭 줄을 숨기고 입력 줄이 키보드 위에 붙는다.
- 홈 맨 위: PC 한 줄(켜짐 파랑 점 · 꺼짐 "마지막 접속 n시간 전" · 오래 꺼짐 황토 · 연결 안 됨), 그 밑 "지금 할 일" tint 한 줄.
- 연결 전 홈: PC 한 줄은 "PC 연결 안 됨" 점만, 가운데 tint 면에 안내 두 줄 + [PC와 연결](ink 채움, 주 단추 하나) → QR 찍기.
- 대화: PC 답은 바탕 위 글자, 카드 답은 tint 면(라벨·값 두 칸, 합계는 600), 내 말은 오른쪽 tint 말풍선. 폰에서 나눈 구간은 가운데 tint 알약 머리("폰에서 나눈 대화 · 오전 8:10~9:40").
- 바닥: 빠른 일 tint 알약(44) + 입력 칸 + [보내기](ink 알약, 이 화면의 주요 단추).
- 빈 대화: 무엇을 할 수 있는지 굵게 한 줄 + 풀이 한 줄 + 예시 문장 셋(tint 알약). 누르면 입력 칸에 들어가고 보내지는 않는다(고쳐서 보낼 수 있게). PC가 꺼져 폰이 답할 때는 "PC가 꺼져 있어도 물어볼 수 있어요"와 폰용 예시.
- 폰이 답한 말(PC 꺼짐, ADR-047)은 아래 작은 줄이 "폰에서 답함 · 시각", PC 답은 "PC · 시각". 말풍선 모양은 같다(누가 답했는지는 글자로만).
- 내 말 아래 작은 줄: 보내는 중 · 못 보냈어요 · PC 켜지면 보내요. 답을 쓰는 동안 상대 쪽에 숨 쉬는 점 "답을 쓰고 있어요"(보내기 단추는 잠김).
- 못 보낸 말: 내 말은 그대로 두고 바로 아래 tint 면에 이유 한 줄(코어 문구 그대로) + 다시 할 수 있으면 [다시 보내기] 알약. 체크 표시를 붙이지 않는다. 한도처럼 다시 해도 안 되는 것은 단추 없이 언제 다시 되는지만.
- 되묻기 칩(부가세 별도·포함 등)은 마지막 답 아래 tint 알약. 누르면 바로 보낸다.
- 줄바꿈은 낱말 단위(iOS `hangul-word`, 웹 `keep-all`). 붙어 있어야 하는 묶음("밀린 일 1건")은 붙은 칸(U+00A0)으로 잇는다.

아이콘 묶음을 들이지 않는다. 꺾쇠·체크는 선 두 개로 그린다.

## 움직임과 진동

움직임은 상태가 바뀔 때만(점 숨쉬기, 카메라 셔터 누름 0.92배). 진동은 주요 단추·고르기(selection), 보내기 성공(success), 보낼 수 없음(warning) 셋뿐이다.

## 알림(설정 > 알림)

- 서버 푸시(APNs·FCM)는 아직 없다(tex `poc/services/push`는 배포 전, Phase 1은 실제 푸시를 보내지 않는다). 기기 안 알림만 만든다(`src/notify/`).
- 발급 진행이 내 차례 · 발급됨 · 중지 · 확인 필요 · 시작 못 함으로 바뀌면 한 번. 앱이 앞에 있으면 화면 위 배너(tint 면 + 은은한 경계, 6초, 누르면 진행 화면, 그 일을 보고 있으면 안 띄움), 뒤에 있으면(잠기기 전 30초) OS 알림.
- 돈 기한: 마지막으로 받은 PC 값으로 다음 오전 9시 한 번(건수만).
- OS 알림 글에는 거래처·금액을 넣지 않는다(잠금 화면). 앱 안 배너에만 일 이름이 있다.
- 설정 화면: 폰 알림(허용됨 · 꺼짐 · 아직 안 정함) + 받을 알림 둘(스위치, 켜짐은 ink 채움). 꺼 두었으면 [폰 설정]으로.

## 설정

- 묶음: 연결(PC · 계정 · 연결된 기기) → 알림 → 보안(앱 잠금) → 도움말(사용 안내 · 문의하기) → 앱 정보(버전 · 개인정보 처리방침 · 이용약관). "준비 중"처럼 누를 것도 볼 것도 없는 줄은 두지 않는다.

- 글자 크기: 작게(0.88배) · 중간 · 크게(1.15배). 앱 안 모든 글자(`T`, 입력 칸)에 걸리고 OS 글자 크기 설정과 곱해진다(1.6배 상한은 그대로). 값은 봉인 상태 파일(`AppData.textSize`), 장치는 `src/ui/TextSizeHost.tsx`.

## 밀린 일

- 레퍼런스는 iOS 알림 센터: 일마다 카드 하나(tint 면, 둥근 모서리 16, 카드 사이 8). 첫 줄 거래처 + 금액, 둘째 줄 지금 상태 한 문장.
- 상태 문장은 짧은 말로 한다("중지됐어요", "PC가 다른 일 중이었어요", "처음 거래하는 곳은 PC에서 승인해요"). 가운데점(·)으로 낱말을 잇지 않는다. 확인 필요·내 차례만 황토 글자.
- 묶음 이름은 사장님 쪽 말("승인할 일 1건", "PC에서 할 일 2건").
- 단추: 승인할 일만 채운 [승인하기](승인 시트). 빼기·취소·다시 맡기기는 상태 줄 끝 글자 단추.
- PC가 거절·중지해 끝난 일은 "발급 안 된 일"에 흐린 글자로. 카드를 좌우로 밀면 치워지고(`src/ui/SwipeAway.tsx`, 손가락과 1:1, 폭 40% 또는 빠른 튕김), 머리 [모두 치우기]로 한 번에. 읽기 도구에는 "치우기" 동작.
- PC가 다른 일 중이라 받지 않은 발급(pc_busy)은 거절로 보지 않는다. "기다리는 일" 카드에 "다른 일이 끝나면 할게요"와 [취소]. 폰은 세션이 열려 있는 동안 30초마다, 다시 연결할 때마다 같은 cmdId, 같은 입력으로 다시 보낸다(맡긴 지 72시간이 지나면 그만두고 "발급 안 된 일"로). 기다리는 사이 날짜가 바뀌면 작성일자를 몰래 바꾸지 않는다: 다시 보내지 않고 카드에 "11월 18일로 맡긴 일이에요. 오늘 날짜로 바꿔야 발급할 수 있어요" + [오늘 날짜로 맡기기](채운 단추)와 [취소].
- 돈 탭 받을 돈·낼 돈 카드의 0건 줄은 숨긴다.

## 점검

`pnpm gallery`로 화면 갤러리를 웹으로 묶는다(가짜 세션, 네트워크·키·카메라 없음). `?s=home-chat-online`, `home-chat-offline`, `home-chat-merged`, `home-unpaired`, `home-chat-empty`, `home-phone-empty`, `home-phone-typing`, `home-phone-reply`, `home-phone-failed`, `home-phone-limit`, `home`, `home-stale`, `money-empty`, `money-copy`, `money-copy-unsure`, `money-copy-no-account`, `issue-picker-copy`, `issue-copy-filled`, `issue-copy-online`, `run-pc-prepare`, `run-pc-readback`, `run-pc-approve`, `run-pc-in-doubt`, `run-pc-stopped`, `run-pc-turn-simple`, `run-pc-turn-other`, `home-chat-pc-turn`, `queue-pc-turn`, `run-pc-turn-choice`, `run-pc-turn-choice-failed`, `run-pc-simple-wait`, `run-pc-simple-timeout`, `simple-form-empty`, `simple-form-filled`, `simple-form-errors`, `simple-form-pass`, `run-pc-done`, `run-pc-refused`, `run-pc-busy`, `run-pc-old`, `home-chat-pc-run`, `lock-faceid`, `lock-touchid`, `lock-android`, `lock-failed`, `lock-passcode-fallback`, `lock-no-biometric-passcode`, `lock-no-passcode`, `onboarding-easy`, `onboarding-what`, `onboarding-safe`, `onboarding-pair`, `onboarding-paired`, `lock-first-run`, `lock-first-run-no-bio`, `lock-first-run-no-passcode`, `lock-cover`, `records-empty`, `settings`, `settings-unpaired`, `settings-text-small`, `settings-text-large`, `settings-notify`, `settings-notify-ask`, `settings-notify-off`, `notify-banner`, `notify-banner-turn`, `queue-refused`, `home-chat-entrusted`, `queue-mixed`, `queue-empty`, `issue-picker`, `issue-picker-empty`, `issue-filled-online`, `issue-filled-offline`, `issue-stale`, `issue-first-counterparty`, `issue-duplicate`, `issue-limit`, `issue-inexact`, `approval-default`, `approval-arming`, `approval-urgent`, `approval-expired`, `approval-dup`, `approval-dup-acked`, `approval-unknown`, `approval-first`, `approval-limit`, `approval-no-key`, `approval-ios-allowed`, `approval-ios-policy-blocked`, `approval-mismatch`, `approval-in-doubt`, `approval-long`, `run-prepare`·`run-login`·`run-readback`·`run-issue`·`run-verify-step`, `run-simple-auth`, `run-simple-auth-unknown`, `run-cert`, `run-stop-blocked`, `run-stop-blocked-reserved`, `run-stop-unknown-screen`, `run-stop-date`, `run-stop-input`, `run-in-doubt`, `run-verify-needed`, `result-email`, `result-no-email`, `result-long`, `home-chat-run`, `home-chat-result`, `queue-with-done`, `doc-loading`, `doc-receiving`, `doc-pc-off`, `doc-pc-off-asked`, `doc-backup`, `doc-error`, `doc-ready`, `doc-long`, `demo`, `demo-in-doubt`, `bizreg-camera`, `bizreg-confirm`, `bizreg-email-empty`, `bizreg-low-conf`, `bizreg-checksum`, `bizreg-blurry`, `bizreg-existing`, `bizreg-long`, `issue-new-checking`, `issue-new-pc-off`, `issue-new-closed`, `bizreg-camera-denied`, `bizreg-album`, `bizreg-pdf`, `camera`(앨범 단추), `money-ok`, `money-late`, `money-shortfall`, `money-unsure`, `money-last`, `money-no-account`, `money-loading`, `money-error`, `money-empty`, `money-unpaired`, `money-recv`, `money-recv-marked`, `money-recv-late`, `money-pay`, `money-mark`, `money-mark-offline`, `cash`, `connection`, `devices`, `devices-full`, `devices-suspended`, `devices-error`, `devices-stopped`, `devices-unpaired`, `devices-loading`, `invoice-confirm`, `invoice-issues`, `receipt-confirm`, `saved`, `camera`를 라이트·다크로 본다. `&fs=1.6`을 붙이면 글자 크기 1.6배를, `&w=375&h=667`이면 작은 폰(SE)을 흉내 낸다. 웹 번들에만 들어가고 앱 번들에는 들어가지 않는다(`metro.config.cjs`).
