module.exports = ({ config }) => {
  const team = process.env.APPLE_TEAM_ID;
  if (team !== undefined && !/^[A-Z0-9]{10}$/.test(team)) throw new Error('APPLE_TEAM_ID must be the 10-character Apple team ID');
  return team ? { ...config, ios: { ...config.ios, appleTeamId: team } } : config;
};
