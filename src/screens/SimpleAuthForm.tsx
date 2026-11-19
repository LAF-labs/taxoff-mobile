// 폰에서 시작하는 간편인증(대표 결정 2026-11-19 A): PC가 공동인증서로 홈택스에 로그인하지 못했을 때 폰에서 간편인증 값을 받는다.
// 홈택스 개인용 간편인증 창과 같은 칸: 인증 앱, 이름, 생년월일 8자리, 휴대폰 번호. 보내면 PC가 홈택스 창을 채워 [인증 요청]을 누르고,
// 사장님은 고른 인증 앱에서 승인한 뒤 진행 화면의 [승인했어요]를 누른다.
// 값은 봉인 상태 파일(AppData.simpleId)에만 두고 다음에 미리 채운다. 화면에는 PC 화면을 보라는 말이 없다(대표 규칙 2026-11-19).
import { Pressable, StyleSheet, View } from 'react-native';
import { PASS_CARRIERS, SIMPLE_APPS } from '../run';
import { radius, space, usePalette } from '../theme';
import { Field } from '../ui/field';
import { Group, T, tap } from '../ui/kit';
import type { SimpleId } from '../storage/state';

export interface SimpleDraft {
  provider: string;
  /** PASS만 */
  carrier: string;
  name: string;
  /** 입력 표기(YYYY-MM-DD) */
  birth: string;
  /** 입력 표기(010-1234-5678) */
  phone: string;
}

export const draftOf = (id?: SimpleId | null): SimpleDraft => ({
  provider: id?.provider ?? '',
  carrier: id?.carrier ?? '',
  name: id?.name ?? '',
  birth: id?.birth ? `${id.birth.slice(0, 4)}-${id.birth.slice(4, 6)}-${id.birth.slice(6, 8)}` : '',
  phone: id?.phone ? id.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') : '',
});

/** 다 맞으면 숫자만 뽑은 값, 아니면 칸별 오류 */
export function checkDraft(d: SimpleDraft): { ok: true; id: SimpleId } | { ok: false; errors: Partial<Record<keyof SimpleDraft, string>> } {
  const errors: Partial<Record<keyof SimpleDraft, string>> = {};
  const birth = d.birth.replace(/\D/g, '');
  const phone = d.phone.replace(/\D/g, '');
  if (!SIMPLE_APPS.some((a) => a.code === d.provider)) errors.provider = '인증 앱을 골라 주세요';
  else if (d.provider === 'pass' && !PASS_CARRIERS.some((c) => c.code === d.carrier)) errors.carrier = 'PASS는 통신사를 골라 주세요';
  if (!/^[가-힣A-Za-z][가-힣A-Za-z ]{0,19}$/.test(d.name.trim())) errors.name = '이름을 넣어 주세요';
  if (!/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(birth)) errors.birth = '생년월일 8자리를 넣어 주세요(예: 1990-01-01)';
  if (!/^01[016789]\d{7,8}$/.test(phone)) errors.phone = '휴대폰 번호를 넣어 주세요';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, id: { provider: d.provider, name: d.name.trim(), birth, phone, ...(d.provider === 'pass' ? { carrier: d.carrier } : {}) } };
}

export function SimpleAuthForm({ draft, onChange, errors, failed }: { draft: SimpleDraft; onChange: (d: SimpleDraft) => void; errors: Partial<Record<keyof SimpleDraft, string>>; failed?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.s4 }} testID="simple-form">
      <View style={{ gap: space.s1, paddingHorizontal: space.s1 }}>
        <T v="subStrong">간편인증으로 홈택스에 로그인해요</T>
        <T v="sub" c="ink2">
          고른 앱으로 승인 요청이 가요. 승인하면 발급을 이어서 해요.
        </T>
        {failed && (
          <T v="sub" c="attention" testID="simple-failed">
            방금 요청을 보내지 못했어요. 값을 확인하고 다시 보내 주세요.
          </T>
        )}
      </View>
      <Group title="인증 앱">
        <View style={st.grid} accessibilityRole="radiogroup">
          {SIMPLE_APPS.map((a) => {
            const on = draft.provider === a.code;
            return (
              <Pressable
                key={a.code}
                onPress={() => {
                  tap();
                  onChange({ ...draft, provider: a.code });
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={a.name}
                testID={`simple-app-${a.code}`}
                style={({ pressed }) => [st.app, { borderColor: on ? p.ink : p.line, backgroundColor: on ? p.tint : p.canvas }, pressed && { opacity: 0.7 }]}
              >
                <T v={on ? 'subStrong' : 'sub'} lines={1}>
                  {a.name}
                </T>
              </Pressable>
            );
          })}
        </View>
        {draft.provider === 'pass' && (
          <View style={{ gap: space.s2, paddingHorizontal: space.s3, paddingBottom: space.s3 }}>
            <T v="meta" c="ink2">
              통신사
            </T>
            <View style={st.carriers} accessibilityRole="radiogroup">
              {PASS_CARRIERS.map((c) => {
                const on = draft.carrier === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      tap();
                      onChange({ ...draft, carrier: c.code });
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={c.name}
                    testID={`simple-carrier-${c.code}`}
                    style={({ pressed }) => [st.app, { borderColor: on ? p.ink : p.line, backgroundColor: on ? p.tint : p.canvas }, pressed && { opacity: 0.7 }]}
                  >
                    <T v={on ? 'subStrong' : 'sub'} lines={1}>
                      {c.name}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            {errors.carrier && (
              <T v="meta" c="attention">
                {errors.carrier}
              </T>
            )}
          </View>
        )}
        {errors.provider && (
          <T v="meta" c="attention" style={{ paddingHorizontal: space.s3, paddingBottom: space.s2 }}>
            {errors.provider}
          </T>
        )}
      </Group>
      <Group title="본인 정보" note="홈택스 간편인증에만 써요. 이 폰에 잠가 두고 다음에 미리 채워요.">
        <Field label="이름" value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} placeholder="홍길동" error={errors.name} testID="simple-name" maxLength={20} />
        <Field label="생년월일" value={draft.birth} onChange={(v) => onChange({ ...draft, birth: v })} mask="day" placeholder="1990-01-01" error={errors.birth} testID="simple-birth" />
        <Field label="휴대폰 번호" value={draft.phone} onChange={(v) => onChange({ ...draft, phone: v })} mask="phone" placeholder="010-1234-5678" error={errors.phone} testID="simple-phone" />
      </Group>
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, padding: space.s3 },
  carriers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  app: { minHeight: 44, width: '31.5%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s2 },
});
