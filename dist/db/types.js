// DB 에서 막 조회한 유저 정보 전용 타입 — 개인정보(phone)를 포함하므로 클라이언트에는 그대로 보내지
// 않는다(ToPublicUserInfo() 로 phone 을 뺀 UserInfo 로 변환). ⚠️ Redis 캐시(user:info:{userid})에는
// 이 타입이 아니라 phone 없는 UserInfo 그대로 저장한다 — CLAUDE.md "유저 정보 처리 단계" 1번: "phone 은
// 개인정보다. ... 좌석 예약·로그·Redis 공유 정보에 넣지 않는다"를 실제 코드에도 맞췄다(2026-10-01,
// 전엔 이 타입이 Redis 캐시에도 그대로 쓰여서 phone 이 캐시에 남아 있었다 — 사용자 지적으로 분리함).
// phone 은 통계 전용 정보라, 캐시 히트 시에는 phone 변경 여부를 확인하지 않는다(db/userRepository.ts
// GetOrCreateUser 참고) — 캐시가 만료돼 DB 를 다시 조회할 때만 비교/갱신된다.
export function ToPublicUserInfo(user) {
    const { phone: _phone, ...public_info } = user;
    return public_info;
}
//# sourceMappingURL=types.js.map