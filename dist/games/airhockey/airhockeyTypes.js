// 에어하키(airhockey) 전용 payload / 상태 타입 (2026-10-15 추가).
// 와이어 프로토콜은 `멀티게임_바이브.xlsx` 의 `airhockey` 시트가 기준이다.
// 공통 payload(EnterRoomPayload, ReadyPayload, OutUserPayload 등)는 common/types.ts 에 있다.
//
// 게임 개요: 2인 실시간 대전. 서버가 퍽의 물리를 계산해 PUCK_MOVE 로 알리고, 클라이언트는 자기 레버
// 좌표(LEVER_MOVE)만 보낸다. 퍽을 상대 골대에 넣으면 1골(= 한 판, ONE_RESULT), 3골 먼저 넣으면 승리.
// ⚠️ 모든 좌표는 **받는 유저 기준**이다 — 내 골대가 아래(y < 0). airhockeyConstants.ts 좌표계 주석 참고.
export {};
//# sourceMappingURL=airhockeyTypes.js.map