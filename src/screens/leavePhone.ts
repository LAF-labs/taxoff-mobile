import { Alert } from 'react-native';
import { devicesClient, leaveThisPhone } from '../devices';
import type { DeviceKeys } from '../keyring';
import { resetDevice } from '../keyring';
import { accountOrigin } from '../net/account';
import { clearDeviceToken, deviceAuthFor, fetchJson } from '../net/devauth';
import { forgetPushToken, pushClient } from '../notify/pushApi';
import type { AppData } from '../storage/state';

const LEAVE_TITLE = '이 폰 연결 해제';
const LEAVE_BODY = '이 폰의 열쇠와 아직 보내지 않은 사진·현금 매출을 지우고, 계정의 기기 목록에서 이 폰을 빼요.';
const LEAVE_NOT_TOLD = '연결 끊기를 다 마치지 못했어요. PC에는 이 폰이 잠시 남아 있을 수 있어요.';

export function confirmLeaveThisPhone(o: { pair: NonNullable<AppData['pair']>; keys: DeviceKeys; onReset: () => void }): void {
  Alert.alert(LEAVE_TITLE, LEAVE_BODY, [
    { text: '취소', style: 'cancel' },
    {
      text: '해제',
      style: 'destructive',
      onPress: async () => {
        const auth = deviceAuthFor(o.pair.pairId, o.pair.cert, o.keys.vm);
        await forgetPushToken(() => pushClient(fetchJson, accountOrigin(), auth).remove());
        const client = devicesClient(fetchJson, accountOrigin(), auth);
        const { told } = await leaveThisPhone({ leave: client.leave, reset: resetDevice });
        clearDeviceToken();
        if (told) o.onReset();
        else Alert.alert(LEAVE_TITLE, LEAVE_NOT_TOLD, [{ text: '확인', onPress: o.onReset }]);
      },
    },
  ]);
}
