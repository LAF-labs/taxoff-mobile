/* eslint-disable @typescript-eslint/no-require-imports */
const apnsEnv = require('./src/notify/apns-env.json');

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
