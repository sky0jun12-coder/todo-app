// 로그아웃으로 세션이 사라지기 전에 실행할 작업. 저장 대기 중인 노트를 보내는 데 쓴다.
export const beforeLogout = new Set<() => Promise<void>>();
