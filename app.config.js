/* eslint-disable @typescript-eslint/no-require-imports */
const apnsEnv = require('./src/notify/apns-env.json');

/** 푸시 환경(aps-environment)은 apns-env.json 한 곳에서 정한다. 폰이 서버에 밝히는 토큰 종류(push.ts)도 같은 값을 읽는다. */
const withApnsMode = (config) => ({
  ...config,
  plugins: (config.plugins ?? []).map((p) => (Array.isArray(p) && p[0] === 'expo-notifications' ? [p[0], { ...p[1], mode: apnsEnv.mode }] : p)),
});

module.exports = ({ config: base }) => {
  const config = withApnsMode(base);
  const team = process.env.APPLE_TEAM_ID;
  if (team !== undefined && !/^[A-Z0-9]{10}$/.test(team)) throw new Error('APPLE_TEAM_ID must be the 10-character Apple team ID');
  return team ? { ...config, ios: { ...config.ios, appleTeamId: team } } : config;
};
