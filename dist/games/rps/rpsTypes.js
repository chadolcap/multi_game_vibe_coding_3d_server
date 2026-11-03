// 가위바위보(RPS) 전용 메시지 payload 타입. `common/types.ts` 에서 분리했다(2026-10-02) —
// 나중에 다른 게임(예: 오델로)을 추가할 때 이 파일과 같은 패턴으로 `games/othello/othelloTypes.ts` 를
// 만들면 된다. CLAUDE.md "게임별 분리 구조" 참고.
//
// ⚠️ 여기 있는 타입들은 와이어 메시지의 payload "모양"만 정의한다 — 실제 메시지 `type` 문자열
// (SELECT_GAME, GAME_RESULT 등)은 이미 만들어진 클라이언트가 그 이름에 의존하므로 바꾸지 않았고,
// 여전히 `common/types.ts` 의 `MessageType`(플랫폼 공용 와이어 상수) 안에 그대로 있다.
export {};
//# sourceMappingURL=rpsTypes.js.map