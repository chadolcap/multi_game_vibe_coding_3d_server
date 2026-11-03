// 점핑(stepping) 전용 payload / 상태 타입 (2026-10-14 추가).
// 와이어 프로토콜은 `멀티게임_바이브.xlsx` 의 `stepping` 시트가 기준이다.
// 공통 payload(EnterRoomPayload, ReadyPayload, OutUserPayload 등)는 common/types.ts 에 있다.
//
// 게임 개요: 두 유저가 **같은 맵**에서 각자 자기 블록을 점프해 나간다(화면은 나란히). 점프 판정
// (블록 안에 착지했는지)은 클라이언트가 하고, 서버는 그 결과(MOVE_INFO)를 검증·중계하고 승패를 낸다.
export {};
//# sourceMappingURL=steppingTypes.js.map