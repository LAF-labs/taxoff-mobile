// 이 폰의 모델 이름(예: "iPhone 16 Pro"). 연결할 때 기기 이름으로 보내고, 기기 토큰을 받을 때도 알려
// 이미 연결된 폰의 이름도 계정의 기기 목록에서 모델 이름으로 바뀐다(2026-11-19 대표: 기기 목록에는 이름과 마지막 접속일만).
// iOS는 기기 이름(deviceName)을 "iPhone"으로만 주므로 모델 이름을 쓴다.
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export const deviceModel = (): string => (Device.modelName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android')).slice(0, 40);
