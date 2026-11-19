# taxoff 폰 앱

택스오프 PC 앱과 짝을 이루는 폰 앱(iOS·Android, Expo SDK 58 · React Native 0.88). 사장님이 폰으로 종이 증빙을 찍고 현금매출을 적으면, 릴레이를 거쳐 종단간 암호화로 내 PC에 보낸다. PC는 받은 원본과 데이터를 세무사 꾸러미에 넣는다.

- 출발점: `LAF-labs/tex`의 `poc/apps/mobile`(실기기 페어링·전송 통과본). 그 이력과 설계 근거(D08, ADR-029·034)는 tex에 있다.
- 프로토콜과 대화 코어: `vendor/sax-remote/`(@sax/remote, D08 정본), `vendor/sax-redaction/`(@sax/redaction, 가림 계층), `vendor/sax-chat-core/`(@sax/chat-core, PC가 꺼졌을 때 폰 대화, ADR-047)는 tex `poc/packages/`의 **고정 사본**이다. 여기서 고치지 않는다. tex에서 고친 뒤 `pnpm sync:remote <tex 체크아웃> [remote|redaction|chat-core]`으로 맞추고, 커밋은 사본마다 `vendor/<폴더>/VENDORED_FROM`에 남는다. CI의 `vendor` 작업이 사본마다 그 커밋과 같은지 본다(`TEX_READ_TOKEN` 비밀값이 있을 때).
- 릴레이 서버·계정 서비스는 tex `poc/services/*`에 있다. 이 레포의 `dev/`에는 Node 개발 대역(더미 PC·개발 릴레이·개발 계정)만 있다. 실제 계정·릴레이까지 붙는 개발 스택은 tex의 `poc/scripts/phone-stack/stack.ts`로 돌린다(먼저 `pnpm --dir poc/scripts/phone-stack install`).

### paseo와의 관계

[paseo](https://github.com/getpaseo/paseo)(Apache-2.0)도 Expo 앱 + QR 페어링 + 종단간 암호화 릴레이 구조다. 비교해서 정한 것:
- 전송·암호는 @sax/remote를 그대로 쓴다. paseo는 Noise_NK(폰 쪽 정적 키 없음)이고, 우리는 페어링 Noise_XXpsk0 + 6자리 SAS, 세션 Noise_IK(폰 키 묶음), PC가 꺼져 있을 때 HPKE 큐까지 있다.
- paseo에서 참고하는 것: 앱 구조(Expo 단일 코드, 화면마다 상태 하나), 끊김·재연결 표시, 바이너리 프레임 협상 방식.

## 화면

| 화면 | 08 ID | 파일 |
|---|---|---|
| 잠금(생체, 백그라운드 30초 뒤 재잠금, 앱 전환기 가림) | P-01 | `src/screens/LockScreen.tsx`, `App.tsx` |
| 앱 틀: 아래 탭 홈(대화) · 돈 · 기록, 설정은 홈 오른쪽 위 | 기획 v2 | `src/screens/MainScreen.tsx` |
| 홈 = PC와 나누는 대화: PC 연결 한 줄 · 지금 할 일 한 줄 · 대화 · 빠른 일 [세금계산서 발급] [찍기] [현금] + 입력 줄 | 기획 v2 | `src/screens/HomeScreen.tsx`, `src/chat.ts` |
| 돈: 이번 달(들어온·나간·남은 돈), 받을 돈·낼 돈(안 받은 합계·기한 지남·7일 안), 앞으로 30일, 알림 한 줄(11 §3.5), "확인 못 함", 받음 표시·되돌리기. PC가 꺼져 있으면 마지막 요약을 날짜와 함께 | 기획 v2 PR 8 | `src/screens/MoneyScreen.tsx`, `MoneyListScreen.tsx`, `MarkReceivedScreen.tsx`, `src/money.ts`, `src/moneyStore.tsx` |
| 기록(끝난 발급 목록, 비었으면 [세금계산서 발급]) | 기획 v2 | `src/screens/RecordsScreen.tsx` |
| 설정(연결 · 알림 · 보안 · 도움말 · 앱 정보), 알림 설정과 앱 안 배너·기기 알림 | 기획 v2 | `src/screens/SettingsScreen.tsx`, `NotifyScreen.tsx`, `src/notify/*` |
| 밀린 일: 상태별 묶음, 줄마다 쉬운 말 한 줄 + 동작 하나, 시작 확인이면 [모두 시작], 72시간 지나면 만료 | P-13 | `src/screens/QueueScreen.tsx`, `src/queue.ts`, `src/queueStore.tsx` |
| 승인 시트: 되읽은 값 전체, 해시 재계산이 맞을 때만 [승인하고 발급](유일한 파랑 채움), 0.8초 무장 지연, 120초, 멈춤 상태 | P-03 | `src/screens/ApprovalSheet.tsx`, `src/approval.ts`, `src/approvalKey.ts` |
| 진행·결과 카드: 단계 줄(준비 → 홈택스 로그인 → 값 확인 → 승인 → 발급 → 확인), 내 차례(간편인증·인증서 PC 전용), 중지(08 §11 문구), 확인 중·확인 필요(다시 발급 단추 없음), 결과(승인번호 길게 눌러 복사) | P-04 | `src/screens/RunCard.tsx`, `RunScreen.tsx`, `src/run.ts` |
| 서류 보기: 파일 이름·발급일, 첫 쪽 미리보기, [공유] [파일에 저장], 여는 중·받는 중·PC 꺼짐·백업·열 수 없음 | P-05 | `src/screens/DocScreen.tsx`, `src/doc.ts`, `assets/sample/` |
| 사업자등록증 찍기: 앱 안 카메라(A4 세로 틀) → 기기 안 OCR → 상호·사업자번호(검증식)·대표자·주소·업태·종목 확인, 받을 이메일 → 거래처로 저장 → 발급 작성(휴·폐업 확인 줄, 처음 거래처 안내). 이미 있는 번호면 그 거래처로 | 기획 v2 PR 7 | `src/screens/BizRegScreen.tsx`, `src/capture/bizreg.ts` |
| 발급 작성 + 거래처 고르기: 최근 다섯 곳 · 찾기, 지난번 값, 부가세 별도/포함, 세액 10% 버림, PC 상태에 따른 단추 | P-10 · P-11 | `src/screens/IssueScreen.tsx`, `src/issue.ts` |
| 폰 연결(QR 스캔 → 24시간 경고 → 6자리 + "PC 화면에만 입력" 경고) | S-03 | `src/screens/PairScreen.tsx` |
| 연결 상태(켜짐·꺼짐, 마지막 접속, 보낼 것 건수, 연결 해제, SP-1 보호 상태) | P-06 | `src/screens/ConnectionScreen.tsx` |
| 종이 증빙 촬영: 영수증 · 종이 세금계산서·계산서(앱 안 카메라 → 자르기 → 기기 안 OCR 글자 상자 → 칸 판독·검산 → 확인 → 보관함 → PC) | P-08 | `src/screens/CaptureScreen.tsx`, `src/capture/*` |
| 현금매출(하루 숫자 하나, 날짜별) | P-09 | `src/screens/CashScreen.tsx` |

폰 승인(P-03, M7-7)은 ADR-046 결정 1로 Phase 1에 들어왔다: 승인 시트 화면과 해시 재계산(`src/approval.ts`, PC 엔진 벡터 `test/fixtures/gate-vectors.json`)은 있고, 하드웨어 키(`src/approvalKey.ts`)는 iPhone Secure Enclave P-256이다(tex ADR-052, 네이티브 `modules/sax-native` pxCreate·pxSign, 서명마다 생체 확인). 라이브 세션마다 키를 PC에 알리고(`src/net/pxLive.ts`), PC가 보낸 gate.request를 받아 서명한 gate.response를 보낸다(`src/net/issueLive.ts`, `src/phoneCmd.ts`). Android는 키 증명 검증기가 생길 때까지 승인 기기가 아니다(PC에서 승인). 네이티브가 바뀌었으니 다음 개발 빌드에 `expo prebuild`와 `pod install`이 필요하다. 홈 대화는 아직 화면만 있다: 적은 말은 이 화면에만 남고("PC 켜지면 보냄") PC로 가지 않는다. PC 답·카드는 갤러리 견본에만 있다(대화 프로토콜은 다음 PR). 밀린 일·거래처도 아직 메모리 가짜 저장소뿐이다(앱의 거래처 목록은 비어 있다).

디자인 기준은 [docs/design.md](docs/design.md)(tex design-system v2.0을 폰 크기로).

## 종이 세금계산서

찍기 전에 [영수증 | 세금계산서·계산서]를 고른다(틀 비율이 다르다). 찍은 뒤 서식 이름을 보고 바로잡는다. `src/capture/invoice.ts`가 iOS Vision 글자 상자(위치 포함)를 줄·열로 다시 짜서 공급자·공급받는자(등록번호·상호·성명), 작성일자, 공급가액·세액·합계, 품목, 영수/청구, 책번호·일련번호를 읽는다.

- 숫자는 검산으로 고른다: 세액 ≈ 공급가액 × 10%, 합계 = 공급가액 + 세액, 등록번호 검증 숫자. 자리마다 한 칸인 옛 서식의 숫자도 이어 붙인다.
- '공급받는자 보관용'이면 매입, '공급자 보관용'이면 매출을 미리 고른다. 승인번호가 있으면 홈택스 출력물이라고 알린다(PC가 승인번호로 중복을 맞춘다).
- 확신이 낮은 칸에는 "확인해 주세요"가 붙고, 합계가 안 맞으면 그 칸 아래에 [○○원으로 맞추기]가 뜬다.
- 보내는 것: 원본 JPEG + 확인한 값 전체(`paperInvoice`, remote-envelope v1.7, cap `receipt.v2`) + receipt.v1 후보 4칸. 와이어 모양은 `src/capture/invoice-wire.ts`(확신 0~100 정수, 소수 수량은 규격 칸, 품목 합이 안 맞으면 품목만 뺀다)이고 마지막 관문은 @sax/remote `checkPaperInvoice`다(PC도 같은 함수로 다시 본다). 필수 칸(작성일자·양쪽 등록번호·상호·금액·구분)을 다 못 채우면 [사진만 보내기]로 원본과 v1 후보만 보낸다.

## 지키는 것

- 키: `src/keyring.ts` — ThisDeviceOnly + 생체, 백업 제외, 서버로 가지 않는다(ADR-029, D08 §3.1). 절차·통과 기준은 [docs/sp1-key-backup.md](docs/sp1-key-backup.md).
- 사진: 카메라와 앨범 둘 다(2026-11-16 대표 결정, 종이 증빙·사업자등록증). 앨범은 시스템 사진 고르기(iOS PHPicker, 권한 없이 고른 한 장만)이고, 앱은 고르기가 만든 사본만 지우며 앨범 원본은 건드리지 않는다. 카메라 롤 저장 없음, 봉인 + 파일 보호 Complete + 백업 제외(`src/storage/*`, `modules/sax-native`, `src/capture/pick.ts`).
- 업데이트: 스토어 서명 빌드만, OTA 없음(`updates.enabled=false`, D01 §6·ADR-028). 릴레이 허용 목록은 `src/config.ts`에 내장.
- 로그: 앱 소스에 console 호출 없음(시험이 막는다). 비밀·사진·금액을 로그에 넣지 않는다.
- OCR: iOS Vision(기기 안, 모델 없음) → 규칙 파서(`src/capture/parser.ts`) → 사장님 확인. 값은 후보일 뿐이고 PC docparse가 정본(ADR-034 결정 9). Android·OCR 불가 기기는 사진만 보낸다.

## 개발

```bash
pnpm install
pnpm check                      # 타입·린트·시험(영수증·세금계산서 파서, 자르기, SP-1 설정, node --test)
pnpm gallery                    # 화면 갤러리(웹, dist-gallery/). docs/design.md "점검"
pnpm dummy-pc                   # 더미 PC + 개발 릴레이(localhost:8787)
pnpm smoke                      # Node 폰으로 더미 PC와 페어링·전송 스모크
npx expo prebuild -p ios && npx expo run:ios   # 시뮬레이터
```

시뮬레이터 개발 빌드(`__DEV__ && !Device.isDevice`)에서만: QR 대신 [개발: 더미 PC의 QR 받기], 카메라 대신 [개발: 견본 영수증으로 찍기](앱에 묶인 견본, 갤러리 아님), 키 항목은 생체 없이(여전히 ThisDeviceOnly), 릴레이 `localhost:8787`(ws) 허용. 더미 PC에 6자리 입력은 `curl -XPOST localhost:8787/dev/sas -d '{"code":"123456"}'`.

시뮬레이터 빌드: 키체인은 entitlement가 있어야 열리므로 서명 없는 빌드(`CODE_SIGNING_ALLOWED=NO`)는 잠금 화면에서 멈춘다(의도한 동작, `reports/raw/mobile/00`). `ios/`에서 애드혹 서명으로 빌드한다.

```bash
xcodebuild -workspace tex.xcworkspace -scheme tex -configuration Debug -sdk iphonesimulator -destination 'name=iPhone 17 Pro' -derivedDataPath build/dd CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES DEVELOPMENT_TEAM= build
```

실기기·EAS 빌드: Apple 팀 ID는 저장소에 두지 않고 `APPLE_TEAM_ID`(10자) 환경 변수로만 넘긴다(`app.config.js`가 `ios.appleTeamId`로 얹는다).

### 실기기 개발 빌드(같은 LAN의 맥 개발 스택)

실기기 개발 빌드는 실제 카메라·Face ID·키체인을 쓴다(시뮬레이터 완화 없음). 개발 스택에만 맥의 mDNS 이름으로 붙는다. 평문 http/ws는 `localhost`와 `<이름>.local`만 허용한다(IP·공개 도메인은 거부, `ws-link`·DPoP `htu` 같은 규칙).

```bash
H=$(scutil --get LocalHostName | tr A-Z a-z).local:8787
(cd <tex>/poc && STACK_LIVE=0 STACK_HOST=$H node --conditions=development scripts/phone-stack/stack.ts)   # tex에서: 실제 계정·릴레이 + 더미 PC
EXPO_PUBLIC_TEX_DEV_HOST=$H npx expo start --port 8081                      # 같은 값을 번들에 박는다
APPLE_TEAM_ID=<팀 ID> npx expo prebuild -p ios --no-install && (cd ios && LANG=en_US.UTF-8 pod install)
# ios/: xcodebuild -workspace tex.xcworkspace -scheme tex -configuration Debug -destination 'id=<UDID>' -derivedDataPath build/dd-device -allowProvisioningUpdates build
```

페어링 QR은 맥 브라우저에서 `http://$H/dev/qr.html`을 열어 폰으로 찍는다(120초). 6자리는 `curl -XPOST http://$H/dev/sas -d '{"code":"……"}'`. 처음 연결할 때 iOS가 로컬 네트워크 접근을 물으면 허용한다. `pod install`은 UTF-8 로캘이 필요하다.

빌드 설정은 `eas.json`(simulator·preview·production). 스토어 제출은 하지 않는다(M4-9 패키징·서명 뒤).

## 다른 트랙에 기대는 것

- 폰에는 계정 로그인이 없다. 폰의 계정 등록은 페어링 7단계에서 PC가 대신 하고(클라우드 #115), 폰은 `PAIR_OK`의 AIK 서명 목록을 검사한다(#118).
- 저장 전 확인 화면의 PC 이름·계정 이메일(설계 #120): `PAIR_OK` 필드 이름 `desktopName`·`accountEmail`은 가정이다. 설계 확정 뒤 맞춘다.
- 릴레이 WSS: 경로·헤더·제어 메시지는 services/relay/API.md(클라우드 PR #63)를 따른다. 개발 대역은 `dev/relay-server.ts`다. 우편함 라이브에는 기기 범위 토큰(계정 서비스 `POST /v1/device-tokens`, 개발 대역은 `dev/dev-auth.ts`)과 DPoP가 필요하다. 릴리스 계정 서비스 origin은 클라우드 배포 주소가 정해지면 `src/net/account.ts`에 넣는다(그 전에는 연결하지 않는다).
- App Attest·Play Integrity 등록 확인(D08 §3.1) — 클라우드 트랙.
- 분실 폰 해제: [docs/lost-phone-rehearsal.md](docs/lost-phone-rehearsal.md).
