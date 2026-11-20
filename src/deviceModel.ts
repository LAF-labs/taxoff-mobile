import * as Device from 'expo-device';
import { Platform } from 'react-native';

export const deviceModel = (): string => (Device.modelName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android')).slice(0, 40);
