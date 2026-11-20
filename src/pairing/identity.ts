
export function identityLines(i: { accountEmail: string | null; desktopName: string | null }): { account: string; pc: string } {
  return { account: i.accountEmail ?? '계정 정보 없음', pc: i.desktopName ?? '알려 준 이름 없음' };
}
