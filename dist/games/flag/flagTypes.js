// 청기백기(flag, 1인) 전용 payload / 상태 타입 (2026-10-22 추가).
// 와이어 프로토콜은 `멀티게임_바이브.xlsx` 의 `flag` 시트가 기준이다.
// 공통 payload(EnterRoomPayload, ReadyPayload 등)는 common/types.ts 에 있다.
//
// 게임 개요: 혼자 한다. 서버가 "청기 올려 / 백기 내려 …" 문제를 5번 내고, 유저는 5초 안에 오리의 오른손(청기)·
// 왼손(백기) 쪽 위/아래 버튼으로 답한다. 맞추면 5점. (2026-10-22 사용자 변경: 손 방향은 **오리 기준**.
// 서버는 b/w 값만 판정하고 손·화면 방향은 모른다 — 화면 배치는 클라이언트가 정한다)
export {};
//# sourceMappingURL=flagTypes.js.map