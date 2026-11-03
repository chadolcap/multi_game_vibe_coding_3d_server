// 오델로 전용 payload / 보드 타입 (2026-10-07 추가).
// 와이어 프로토콜은 `멀티게임_바이브.xlsx` 의 `othello` 시트가 기준이다.
// 공통 payload(EnterRoomPayload, ReadyPayload, OutUserPayload 등)는 common/types.ts 에 있다 —
// 어떤 2인용 게임이든 재사용하는 것들이라 게임 폴더로 내리지 않는다.
// 돌 색. 시트 기준 0=흰색, 1=검정. ⚠️ 오델로 표준 규칙상 **검정(1)이 선공**이다.
export const OTHELLO_WHITE = 0;
export const OTHELLO_BLACK = 1;
// 빈 칸. 보드 한 칸은 EMPTY | OTHELLO_WHITE | OTHELLO_BLACK 중 하나다.
export const OTHELLO_EMPTY = -1;
//# sourceMappingURL=othelloTypes.js.map