// 메시지 타입, envelope, 공통 타입 (CLAUDE.md 통신 프로토콜 기준)
// C→S 로 받은 메시지에서 payload 를 꺼낸다. (envelope 정의 바로 옆에 둔다 — log.ts 의
// RegisterLoggedMessage 가 모든 C→S 메시지에 이걸 적용한다. messages.ts 는 log.ts 를 import 하므로
// 거기 두면 순환 import 가 된다)
//
// 통신 프로토콜 문서는 C→S 를 envelope(`{ payload: {...} }`)로 정의하지만, 서버가 오랫동안 메시지
// 최상위를 그대로 읽고 있었다(이 변환이 어디에서도 호출되지 않는 죽은 코드였다 — 2026-10-06 발견).
// 클라이언트가 어느 형식으로 보내고 있는지 확실하지 않아 **둘 다 받아들인다**(사용자 결정, 2026-10-06):
//   - `{ payload: {...} }` → payload 를 돌려준다 (문서 형식, 정식)
//   - `{ ... }`            → 메시지 자체를 돌려준다 (기존 동작, 하위 호환)
// payload 가 객체가 아니어도(예: `{ payload: "문자열" }`) 그대로 돌려준다 — 형식 검사는 지금처럼
// 각 핸들러가 자기 payload 타입 기준으로 한다.
export function ReadPayload(message) {
    if (typeof message !== "object" || message === null)
        return message;
    if (!("payload" in message))
        return message;
    return message.payload;
}
// 메시지 타입 — payload 가 "(Phase N 확정)" 인 것은 해당 Phase 에서 payload 타입을 정한다
// ENTER_LOBBY / NAME 은 클라이언트-서버 통신 정리 문서(구글 시트) 기준으로, 같은 type 이름을
// 요청(C→S)과 결과 응답(S→C, {result, error?})에 그대로 재사용한다.
// 문서: https://docs.google.com/spreadsheets/d/1zmxIhBU8UsEiI4cFFBs94Y4gNfsl1QbINjZMGQwNzBQ
export const MessageType = {
    // 로비
    ENTER_LOBBY: "ENTER_LOBBY", // C→S 요청 { partner, mid, gender, phone } / S→C 결과
    // { result:"Y", userid, new, name, avatar } 또는 { result:"N", error }.
    // 예전엔 성공 시 별도로 LOBBY_ENTERED 를 이어서 보냈는데, 2026-09-30
    // 문서 갱신으로 그 필드들이 ENTER_LOBBY 성공 응답 하나로 합쳐졌다
    // (LOBBY_ENTERED 는 폐지 — 문서 반영)
    NAME: "NAME", // C→S 요청 { name } / S→C 결과 { result, error? }
    PLAY_INFO: "PLAY_INFO", // C→S 요청 { game? } / S→C 결과 { result, total_game_count, ... }
    // C→S 요청(payload 없음) / S→C 같은 type 재사용, { date, list:[[name,score],...], my:{rank,score} }
    // — 일간 랭킹. 2026-10-01 통신규약 시트에 추가됨(문서 기준).
    RANK_DAILY: "RANK_DAILY",
    // C→S 요청(payload 없음) / S→C 같은 type 재사용, { term:{start,end}, list:[[name,score],...], my:{rank,score} }
    // — 주간 랭킹. 2026-10-01 통신규약 시트에 추가됨(문서 기준).
    RANK_WEEKLY: "RANK_WEEKLY",
    // C→S {} — 로비에서 광고를 끝까지 본 뒤 보낸다 / S→C 같은 type 재사용,
    // { result:"Y", star_add, star } 또는 { result:"N", error, star } (AdViewCompleteResultPayload)
    AD_VIEW_COMPLETE: "AD_VIEW_COMPLETE",
    // 로비 3D 섬에서 서로 보기. 다른 유저를 가리키는 id 는 userid 가 아니라 로비 sessionId 다(userid 는 mid 로 되돌릴 수 있다).
    LOBBY_MOVE: "LOBBY_MOVE", // C→S { x, z } — 내 오리 위치
    LOBBY_USERS: "LOBBY_USERS", // S→C { users:[LobbyUserInfo], color } — ENTER_LOBBY 성공 직후 한 번, 지금 로비의 다른 유저 전부 + 내 오리 색
    LOBBY_USER_JOIN: "LOBBY_USER_JOIN", // S→C LobbyUserInfo — 새 유저 입장. 별명을 정했을 때도 같은 id 로 다시 온다
    LOBBY_USER_LEAVE: "LOBBY_USER_LEAVE", // S→C { id } — 유저 퇴장(매칭으로 게임에 간 경우 포함)
    LOBBY_MOVES: "LOBBY_MOVES", // S→C { moves:[[id, x, z, name]…] } — LOBBY_MOVE_FLUSH_MS 마다 바뀐 위치만 묶어서. name 은 머리 위 이름표용(별명 전이면 "")
    MOTION_CHANGE: "MOTION_CHANGE", // C→S { kind } / S→C { id, kind } — 오리 행동(1 앉기/2 일어서기/3 인사/4 점프)을 보낸 본인 포함 전체에게.
    // 시트는 userid 지만 다른 유저에게 userid 를 안 보내는 원칙에 따라 id(로비 sessionId)로 보낸다(2026-11-03 사용자 결정)
    // ⚠️ 2026-11-04 부터 S→C 는 아래 MOTION_CHANGES 묶음으로만 간다(C→S 는 그대로)
    MOTION_CHANGES: "MOTION_CHANGES", // S→C { motions:[[id, kind]…] } — LOBBY_MOVE_FLUSH_MS 마다 받아들인 MOTION_CHANGE 를 묶어서(본인 포함 전체).
    // 즉시 중계는 200명 연타 때 초당 십수만 건이 돼 이벤트 루프가 밀렸다(scripts/load-lobby-crowd.mjs 실측)
    JOIN_MATCH: "JOIN_MATCH", // C→S { select: "Y"|"N" } — Y: 게임 참여(매칭 대기열 등록), N: 매칭 대기 취소
    // (CANCEL_MATCH 는 더 이상 안 쓴다 — JOIN_MATCH 로 통합됨, 문서 반영)
    MATCH_FOUND: "MATCH_FOUND", // S→C
    REJOIN_GAME: "REJOIN_GAME", // S→C { room_name, room_id, seat_reservation } — 문서에 없는 메시지
    // (Phase 6-1 이후 CLAUDE.md 가 기준, MATCH_FOUND 와 같은 자리).
    // 게임 중이던 유저가 F5 등으로 다시 ENTER_LOBBY 를 보내면, 평범한
    // 로비 입장 대신 이걸 보내고 곧바로 로비 연결을 끊는다(CONSENTED)
    // 게임방 — ENTER_ROOM 부터는 로컬 엑셀본(통신규약) 기준. payload 가 "(Phase 5, 추후 정의)" 인
    // 것만 아직 미정이다.
    ENTER_ROOM: "ENTER_ROOM", // C→S 요청(payload 없음, 로딩 등 준비 완료 신호) / S→C 결과 { result, room, player1, player2 } — 같은 type 재사용
    OUT_USER: "OUT_USER", // S→C — 게임 전/후 상대가 나가면 남은 유저에게 알림
    READY: "READY", // C→S { ready: "Y"|"N" } — 응답(ack) 없음
    GAME_START: "GAME_START", // S→C — 양쪽 ready:Y 확인 후 전송. payload 없음
    RETURN_TO_LOBBY: "RETURN_TO_LOBBY", // S→C (Phase 5, 추후 정의)
    OPPONENT_JOINED: "OPPONENT_JOINED", // S→C { player: RoomPlayerInfo } — 기다리는 방에 새 상대 입장
    // SELECT_GAME / GAME_RESULT 는 **여러 게임이 공유**하는 이름이다 — payload 모양만 게임마다 다르다
    // (games/rps/rpsTypes.ts, games/othello/othelloTypes.ts 참고).
    SELECT_GAME: "SELECT_GAME", // C→S — RPS: { select: "가위"|… } / 오델로: { select: {x,y} }
    GAME_RESULT: "GAME_RESULT", // S→C { winner, loser, draw? } 최종 결과 / C→S { replay: "Y"|"N" } — 같은 type 재사용
    // 가위바위보(RPS) 전용 — 2선승제의 "한 판" 단위 진행 (payload 는 games/rps/rpsTypes.ts)
    ONE_START: "ONE_START", // S→C { count } — 한 판 시작
    ONE_REMAIN_TIME: "ONE_REMAIN_TIME", // S→C { count } — ONE_START 이후 남은 초를 1초 단위로 전달. count:0 이 선택 종료 신호
    ONE_RESULT: "ONE_RESULT", // S→C { player1, player2, win? } — 한 판 결과 (무승부면 win 없음)
    // 오델로 전용 — 돌 색 선택 + 턴 진행 (2026-10-07, payload 는 games/othello/othelloTypes.ts).
    // 엑셀본 `othello` 시트 기준.
    DOLL_SELECT: "DOLL_SELECT", // C→S { color: 0|1 } (0=흰색, 1=검정) / S→C { select: {색: userid} } — 같은 type 재사용
    DOLL_SELECT_REMAIN_TIME: "DOLL_SELECT_REMAIN_TIME", // S→C { count } — 돌 선택 남은 초
    TURN_START: "TURN_START", // S→C { turn: userid, can: [{x,y}] } — can 은 시트에 없는 확장(놓을 수 있는 자리)
    TURN_REMAIN_TIME: "TURN_REMAIN_TIME", // S→C { count } — 턴 남은 초를 1초 단위로 전달
    GAME_STATUS: "GAME_STATUS", // S→C { select, status0, status1 } — 게임 중 재접속한 **그 유저에게만** 보내는 보드 스냅샷
    // (점핑은 같은 이름으로 { map, count?, player1, player2 } — steppingTypes.ts)
    // 점핑(stepping) 전용 (2026-10-14, payload 는 games/stepping/steppingTypes.ts). 엑셀본 `stepping` 시트 기준.
    // ⚠️ 시트는 MAP_SEELCT 로 오타가 나 있다 — 와이어 이름은 MAP_SELECT 로 정했다(시트 수정 필요).
    MAP_SELECT: "MAP_SELECT", // S→C { map: 1~3 } — 양쪽 READY 후 맵 지정
    GAME_REMAIN_TIME: "GAME_REMAIN_TIME", // S→C { count } — GAME_START 이후 게임 남은 초 (59 … 0)
    MOVE_INFO: "MOVE_INFO", // C→S { count, location:{x,y}, save:"yes"|"no" } / S→C 같은 type 에 userid, life 추가
    // 에어하키(airhockey) 전용 (2026-10-15, payload 는 games/airhockey/airhockeyTypes.ts). 엑셀본 `airhockey` 시트 기준.
    // ONE_START / ONE_RESULT 는 RPS 와 같은 이름을 쓴다(한 골 = 한 판). 좌표는 **받는 유저 기준**(내가 아래쪽).
    // ⚠️ 둘 다 초당 수십 번 오가므로 C↔S 로그를 남기지 않는다(log.ts HIGH_FREQUENCY_MESSAGE_TYPES).
    SERVE_SELECT: "SERVE_SELECT", // S→C { userid } — 첫 서브 동전 던지기 결과. 5초 뒤 GAME_START (2026-10-29)
    PUCK_MOVE: "PUCK_MOVE", // S→C { loc:{x,y} } — 서버가 계산한 퍽 위치
    LEVER_MOVE: "LEVER_MOVE", // C→S { loc:{x,y} } / S→C { user, loc } — 상대 레버 위치 중계
    // 청기백기(flag, 1인) 전용 (2026-10-22, payload 는 games/flag/flagTypes.ts). 엑셀본 `flag` 시트 기준.
    // ONE_START / ONE_RESULT 는 RPS 와 같은 이름을 쓴다(한 문제 = 한 판).
    QUEST_SHOW: "QUEST_SHOW", // S→C { quest:{b,w} } 문제 제시 / C→S { quest:{b,w} } 답 — 같은 type 재사용
    // 공통
    ERROR: "ERROR", // S→C
    // 관리자(Watcher, Phase 7) — "통신규약" 문서가 아니라 로컬 엑셀본 "관리자" 시트 기준.
    // ADMIN_LOGIN 은 그 시트에 아직 없는 메시지라 CLAUDE.md 가 기준이다. SEND_NOTICE 는 2026-09-30
    // 시트에 추가됐다 — 문서 쪽이 우선이므로 이 자리를 그 스펙에 맞췄다(아래 SendNoticePayload 참고).
    ADMIN_LOGIN: "ADMIN_LOGIN", // C→S { id, password } / S→C { result:"Y"|"N", error? } — 문서에 없음
    // 2026-10-07 통신규약 변경 반영 (엑셀본 "관리자" 시트 행 3~6):
    //   C→S { game? } / S→C 같은 type 재사용, { game, count: { [room_name]: 접속자 수 } }
    ADMIN_CHANNEL_COUNT: "ADMIN_CHANNEL_COUNT",
    //   C→S { game?, channel } / S→C 같은 type 재사용, { game, channel, user: [{userid, room?}], total }
    //   ⚠️ 예전 숫자 형식 { lobby: N } / { game: N } 은 폐지됐다 — channel(room_name 문자열)로만 받는다.
    ADMIN_CHANNEL_USER: "ADMIN_CHANNEL_USER",
    // C→S { channel, message } — 관리자가 지정한 채널(room_name 목록)에만 즉시 공지를 전파한다
    // (예약 발송 없음 — 문서의 time 필드는 이번 구현 범위 밖, SendNoticePayload 참고).
    // S→C { message } — 그 채널들에 붙어 있는 유저에게 **같은 type 을 재사용**해 전송한다(문서 기준,
    // ENTER_LOBBY/NAME 등과 같은 "요청·응답 type 재사용" 관례). 예전엔 별도 이름 NOTICE 였는데 폐지.
    SEND_NOTICE: "SEND_NOTICE",
    // C→S { date:"YYYY-MM-DD" } / S→C 같은 type 재사용, 그날 광고 로그 요약 + 목록 (AdminAdLogResultPayload)
    ADMIN_AD_LOG: "ADMIN_AD_LOG",
};
// ERROR 코드 — ENTER_LOBBY / NAME 처럼 문서에 정의된 결과 응답이 있는 메시지는 각자의
// result/error 로 답하므로(아래 EnterLobbyErrorCode, NameErrorCode) 이 ERROR 는 쓰지 않는다.
// 여기 남은 코드는 "클라이언트가 아직 아무 요청도 보내지 않은 상태"에서 서버가 먼저 끊어야 하는
// 경우(ENTER_LOBBY 를 기다리다 시간 초과)나, 문서 범위 밖의 상황(게임방 부족)에만 쓴다.
export const ErrorCode = {
    ENTER_TIMEOUT: "ENTER_TIMEOUT", // 제한 시간 안에 ENTER_LOBBY 를 보내지 않음 → 연결 종료
    NO_GAME_ROOM: "NO_GAME_ROOM", // 모든 게임 채널이 가득 참 → 연결 유지
    NOT_ENOUGH_STAR: "NOT_ENOUGH_STAR", // JOIN_MATCH 했는데 보유 star 부족 → 연결 유지
};
// ENTER_LOBBY 결과 응답 (S→C, type 은 ENTER_LOBBY 를 그대로 재사용)
// 문서: https://docs.google.com/spreadsheets/d/1zmxIhBU8UsEiI4cFFBs94Y4gNfsl1QbINjZMGQwNzBQ
// (2026-09-28 로컬 엑셀본 기준으로 번호가 다시 바뀜: 2번에 "중복 접속"이 새로 들어와 DB_ERROR/OTHER 번호가 밀렸다)
export const EnterLobbyErrorCode = {
    INVALID_FORMAT: 1, // 형식에 맞지 않은 정보
    DUPLICATE_CONNECTION: 2, // 중복 접속 (같은 유저가 이미 로비 대기 중/게임 중, 또는 이 연결이 이미 입장 완료)
    DB_ERROR: 3, // DB, Redis 오류
    OTHER: 4, // 기타 (채널 인원 초과 등 — 문서에 없는 상황을 여기로 모은다)
};
// AD_VIEW_COMPLETE 결과 코드 (S→C, result:"N" 일 때만)
export const AdViewErrorCode = {
    TOO_FREQUENT: 1, // 직전 광고 보상 뒤 AD_VIEW_COOLDOWN_SEC 가 안 지남 — 재전송·연타
    SERVER_ERROR: 2, // DB/Redis 오류
};
// NAME 결과 응답 (S→C, type 은 NAME 을 그대로 재사용)
// error:3 은 문서에 없는 코드다. ENTER_LOBBY 의 error:4(기타)와 같은 자리 — DB/Redis 오류처럼
// "중복도 아니고 부적절한 것도 아닌" 서버 쪽 문제를 알릴 방법이 없어서 추가했다. 클라이언트도 반영 필요.
export const NameErrorCode = {
    DUPLICATE: 1, // 이미 다른 사용자가 사용중인 별명
    INAPPROPRIATE: 2, // 욕설이 들어간 별명 등 문제가 있는 별명 (형식 오류도 이 코드로 응답한다)
    SERVER_ERROR: 3, // DB/Redis 오류 등 서버 쪽 문제 (문서에 없는 코드 — 위 설명 참고)
};
//# sourceMappingURL=types.js.map