import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type TexUi = { attachTabScrolls(): Promise<number> };

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<TexUi>('TexUi') : null;

/**
 * 탭 화면의 스크롤을 iOS 탭바에 알려 스크롤하면 탭바가 작아지게 하고, 뒤집힌 대화 목록에
 * iOS 26 가장자리 효과가 뒤집혀 그려지지 않게 한다. 스크롤이 화면에 붙은 뒤(onLayout) 부른다.
 * 이 모듈이 없는 빌드와 iOS 밖에서는 아무것도 안 한다.
 */
export function attachTabScrolls(): void {
  native?.attachTabScrolls().catch(() => {});
}
