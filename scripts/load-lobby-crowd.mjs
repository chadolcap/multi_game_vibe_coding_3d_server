// 로비 분수대 군중 부하 측정 스크립트 (2026-11-04)
//
// 봇 BOT_COUNT 명(기본 200)이 로비에 들어와 별명을 정하고 분수대(0,0, 충돌 반지름 6.2) 둘레로 모인 뒤
// 세 구간을 차례로 돈다. 단정(통과/실패)이 아니라 **측정**이 목적이라 check-* 가 아닌 load-* 이름이다.
//   [idle]   모두 가만히 서 있음 (IDLE_SEC)
//   [move]   모두 분수대 둘레를 걸음, LOBBY_MOVE MOVE_HZ 번/초 (MOVE_SEC)
//   [motion] 걸으면서 MOTION_CHANGE(점프·인사)를 서버 연타 제한(300ms)에 걸리지 않는 최대 속도로 (MOTION_SEC)
//
// 구간마다 출력하는 값:
//   - lobby_1 CPU%(한 코어 기준)·RSS — pidusage 의 누적 CPU 시간(ctime) 차이로 계산
//   - 봇 전체가 받은 메시지 수·바이트(WS 프레임 payload 기준, TCP/프레임 헤더 제외) → 서버 송신량 근사
//   - 탐침 봇의 MOTION_CHANGE 왕복 지연(보낸 본인도 MOTION_CHANGES 로 받으므로 자기 메아리로 잰다) — 서버 이벤트 루프 밀림.
//     묶음 전송이라 정상이어도 0~200ms(주기 대기)가 들어간다
//   - 탐침 봇이 받은 LOBBY_MOVES 간격(정상 200ms)·평균 크기·항목 수
//   - 이 스크립트 자신의 CPU% — 100% 에 가까우면 측정기 쪽이 병목이라 지연 값을 믿으면 안 된다
//
// ⚠️ 같은 로비에 실제 클라이언트가 있으면 봇 오리 200마리가 그대로 보이고, 그 클라이언트도 부하를 받는다.
//    실행 전에 ~/.pm2/logs/lobby-1-out.log 로 최근 접속을 확인할 것. JOIN_MATCH 는 보내지 않는다.
// ⚠️ DB 에 테스트 유저(partner=zzcrowd)를 만들고 끝에 자기 행만 지운다. 도중에 강제 종료하면 정리가 안 돈다.
// ⚠️ 출력은 | head 로 자르지 말고 파일로 받을 것(정리 단계가 안 돈다).
//
// 사용법 (dev 서버가 떠 있을 때, 기본 약 60초):
//   node scripts/load-lobby-crowd.mjs > crowd.txt
//   BOT_COUNT=100 MOVE_HZ=20 node scripts/load-lobby-crowd.mjs > crowd.txt
//   HOLD_SEC=300 BOT_COUNT=298 node scripts/load-lobby-crowd.mjs > crowd.txt
//     → 측정 구간 대신 n초 동안 분수대 둘레를 걸으며 가끔 행동(앉기·점프·인사)을 한다(브라우저로 군중을 볼 때).
//       30초마다 서버 CPU·RSS 를 찍고, 끝나면 평소처럼 정리한다. Ctrl+C(SIGINT) 를 받아도 정리하고 끝난다

import { execSync } from "node:child_process";
import { unpack } from "msgpackr";
import { WebSocket } from "ws";
import pidusage from "pidusage";
import * as client from "./colyseus-test-client.mjs";

try {
    process.loadEnvFile();
} catch {
    // .env 가 없으면 환경 변수만 사용
}

const host = process.env.PUBLIC_HOST ?? "localhost";
const lobby_port = Number(process.env.LOBBY_PORT ?? 6011);
const bot_count = Number(process.env.BOT_COUNT ?? 200);
const move_hz = Number(process.env.MOVE_HZ ?? 10);
const idle_sec = Number(process.env.IDLE_SEC ?? 8);
const move_sec = Number(process.env.MOVE_SEC ?? 15);
const motion_sec = Number(process.env.MOTION_SEC ?? 15);
const hold_sec = Number(process.env.HOLD_SEC ?? 0);
const HOLD_MOTION_CHANCE_PER_SEC = 0.15; // 보기 모드에서 봇 하나가 1초에 행동할 확률
let stop_requested = false;
process.on("SIGINT", () => {
    stop_requested = true;
});
const CONNECT_BATCH = 20;
const MOTION_INTERVAL_MS = 320; // 서버 LOBBY_MOTION_MIN_INTERVAL_MS(300) 보다 살짝 길게
const PROBE_INTERVAL_MS = 1000;
const MEMORY_ABORT_BYTES = 1.5e9; // 서버 RSS 가 이걸 넘으면 그 구간을 멈춘다(개발 서버 보호)
const FOUNTAIN_RADIUS = 6.2;

const TEST_PARTNER = "zzcrowd";
const run_tag = String(Date.now()).slice(-6);
const Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ExpectedUserid(mid) {
    let xored = "";
    for (const ch of mid) xored += (ch.charCodeAt(0) ^ 5).toString(10);
    return `${TEST_PARTNER}_${xored}`;
}
const MIDS = Array.from({ length: bot_count }, (_, index) => `b${index}t${run_tag}`);
const ALL_USERIDS = MIDS.map(ExpectedUserid);

// ── 전체 수신 집계 ── 봇 대부분은 본문을 풀지 않고 타입 이름만 읽는다.
// 200개 소켓이 받는 걸 전부 msgpack 으로 풀면 측정기 자신이 병목이 되기 때문이다.
const totals = { frames: 0, bytes: 0, by_type: new Map() };
function ResetTotals() {
    totals.frames = 0;
    totals.bytes = 0;
    totals.by_type.clear();
}

function ReadTypeName(bytes) {
    if (bytes[0] !== client.PROTOCOL_ROOM_DATA) return null;
    const header = bytes[1];
    if ((header & 0xe0) !== 0xa0) return null;
    const length = header & 0x1f;
    return Buffer.from(bytes.subarray(2, 2 + length)).toString("utf8");
}

// 가벼운 로비 접속. on_decoded 를 준 타입만 본문까지 푼다.
async function ConnectBot(decode_types) {
    const reservation = await client.ReserveSeat({ host, port: lobby_port, room_name: "lobby_1" });
    const { processId, roomId, sessionId } = reservation;
    const socket = new WebSocket(`ws://${host}:${lobby_port}/${processId}/${roomId}?sessionId=${sessionId}`);
    const bot = { socket, session_id: sessionId, waiters: [], on_decoded: null };

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("JOIN_ROOM 시간 초과")), 8000);
        socket.on("open", () => socket.send(Uint8Array.from([client.PROTOCOL_JOIN_ROOM, 0, 0])));
        socket.on("message", (data) => {
            const bytes = data instanceof Buffer ? data : Buffer.from(data);
            if (bytes[0] === client.PROTOCOL_JOIN_ROOM) {
                clearTimeout(timer);
                resolve();
                return;
            }
            const type = ReadTypeName(bytes);
            if (type === null) return;
            totals.frames++;
            totals.bytes += bytes.length;
            totals.by_type.set(type, (totals.by_type.get(type) ?? 0) + 1);

            const wants = bot.waiters.some((waiter) => waiter.type === type) || (bot.on_decoded && decode_types.has(type));
            if (!wants) return;
            const decoded = client.DecodeRoomData(bytes);
            const payload = client.TakePayload(decoded);
            const index = bot.waiters.findIndex((waiter) => waiter.type === type);
            if (index !== -1) bot.waiters.splice(index, 1)[0].resolve(payload);
            if (bot.on_decoded && decode_types.has(type)) bot.on_decoded(type, payload, bytes.length);
        });
        socket.on("error", (error) => reject(error));
    });

    bot.Send = (type, body) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(client.EncodeRoomData(type, body));
    };
    bot.WaitFor = (type, timeout_ms = 8000) =>
        new Promise((resolve) => {
            const waiter = { type, resolve };
            bot.waiters.push(waiter);
            setTimeout(() => {
                const index = bot.waiters.indexOf(waiter);
                if (index !== -1) {
                    bot.waiters.splice(index, 1);
                    resolve(undefined);
                }
            }, timeout_ms);
        });
    bot.Leave = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(Uint8Array.from([client.PROTOCOL_LEAVE_ROOM]));
    };
    return bot;
}

async function EnterBot(index) {
    const bot = await ConnectBot(new Set(["LOBBY_MOVES", "MOTION_CHANGES"]));
    bot.Send("ENTER_LOBBY", { partner: TEST_PARTNER, mid: MIDS[index], gender: index % 2 ? "M" : "F", phone: "01000000000" });
    const entered = await bot.WaitFor("ENTER_LOBBY");
    if (entered?.result !== "Y") throw new Error(`봇 ${index} ENTER_LOBBY 실패: ${JSON.stringify(entered)}`);
    const users = await bot.WaitFor("LOBBY_USERS");
    bot.others_at_enter = users?.users?.length ?? -1;
    // 실제 별명 길이(6~8자)와 비슷하게 — LOBBY_MOVES 의 name 칸 크기가 현실과 맞도록
    bot.Send("NAME", { name: `오리${run_tag.slice(-3)}${index}` });
    await bot.WaitFor("NAME");
    // 분수대 둘레 자리
    bot.angle = (index / bot_count) * Math.PI * 2;
    bot.ring = FOUNTAIN_RADIUS + 0.6 + (index % 5) * 0.7;
    return bot;
}

function BotPosition(bot, elapsed_sec) {
    const angle = bot.angle + elapsed_sec * 0.15;
    const ring = bot.ring + Math.sin(elapsed_sec * 1.3 + bot.angle * 7) * 0.4;
    return { x: Math.round(Math.cos(angle) * ring * 100) / 100, z: Math.round(Math.sin(angle) * ring * 100) / 100 };
}

function Percentile(values, ratio) {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}
const Fmt = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "-");

function GetLobbyPid() {
    const list = JSON.parse(execSync("npx pm2 jlist", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const lobby = list.find((proc) => proc.name === "lobby_1");
    if (!lobby || lobby.pm2_env.status !== "online") throw new Error("PM2 의 lobby_1 이 online 이 아닙니다");
    return { pid: lobby.pid, cwd: lobby.pm2_env.pm_cwd };
}

// pidusage 는 Windows 에서 한 번에 1초 넘게 걸려서, 백그라운드로 계속 재고 누적 CPU 시간 차이로 % 를 구한다.
function StartServerSampler(pid) {
    const samples = [];
    let running = true;
    (async () => {
        while (running) {
            try {
                const stat = await pidusage(pid);
                samples.push({ at: Date.now(), ctime: stat.ctime, memory: stat.memory });
            } catch {
                // 한 번 실패는 건너뛴다
            }
        }
    })();
    return {
        // [from, to] 구간의 CPU%·최대 RSS
        Summarize(from, to) {
            const inside = samples.filter((sample) => sample.at >= from && sample.at <= to);
            if (inside.length < 2) return { cpu: NaN, rss_max: NaN };
            const first = inside[0];
            const last = inside.at(-1);
            return {
                cpu: ((last.ctime - first.ctime) / (last.at - first.at)) * 100,
                rss_max: Math.max(...inside.map((sample) => sample.memory)),
            };
        },
        LatestMemory: () => samples.at(-1)?.memory ?? 0,
        Stop: () => {
            running = false;
        },
    };
}

// 측정기 자신의 이벤트 루프 지연 — 이게 크면 아래 왕복 지연에 측정기 지연이 섞인다
function StartLoopLagMeter() {
    const lags = [];
    let expected = Date.now() + 50;
    const timer = setInterval(() => {
        const now = Date.now();
        lags.push(now - expected);
        expected = now + 50;
    }, 50);
    return { lags, Stop: () => clearInterval(timer) };
}

async function RunPhase(name, seconds, bots, probe, sampler, options) {
    console.log(`\n[${name}] ${seconds}초 — ${options.description}`);
    ResetTotals();
    const rtts = [];
    const move_gaps = [];
    const move_sizes = [];
    const move_entries = [];
    let last_moves_at = 0;
    let pending_probe = null;

    probe.on_decoded = (type, payload, size) => {
        if (type === "LOBBY_MOVES") {
            const now = Date.now();
            if (last_moves_at > 0) move_gaps.push(now - last_moves_at);
            last_moves_at = now;
            move_sizes.push(size);
            move_entries.push(payload?.moves?.length ?? 0);
        } else if (type === "MOTION_CHANGES" && pending_probe) {
            if (payload?.motions?.some(([id, kind]) => id === probe.session_id && kind === pending_probe.kind)) {
                rtts.push(Date.now() - pending_probe.sent_at);
                pending_probe = null;
            }
        }
    };

    const lag_meter = StartLoopLagMeter();
    const cpu_before = process.cpuUsage();
    const started = Date.now();
    const timers = [];
    let aborted = false;

    if (options.move) {
        timers.push(
            setInterval(() => {
                const elapsed = (Date.now() - started) / 1000;
                for (const bot of bots) bot.Send("LOBBY_MOVE", BotPosition(bot, elapsed));
            }, 1000 / move_hz)
        );
    }
    if (options.motion) {
        // 한꺼번에 몰리지 않게 봇마다 시작 시점을 흩뜨린다(실제 연타도 동시에 오지는 않는다)
        bots.forEach((bot, index) => {
            if (bot === probe) return;
            timers.push(
                setTimeout(() => {
                    let kind = 4;
                    timers.push(
                        setInterval(() => {
                            bot.Send("MOTION_CHANGE", { kind });
                            kind = kind === 4 ? 3 : 4;
                        }, MOTION_INTERVAL_MS)
                    );
                }, (index / bots.length) * MOTION_INTERVAL_MS)
            );
        });
    }
    // 탐침: 1초마다 자기 MOTION_CHANGE 메아리 시간 측정 (응답 없이 다음 탐침이 오면 그건 유실로 센다)
    let probe_kind = 3;
    let probe_lost = 0;
    timers.push(
        setInterval(() => {
            if (pending_probe) probe_lost++;
            probe_kind = probe_kind === 3 ? 4 : 3;
            pending_probe = { kind: probe_kind, sent_at: Date.now() };
            probe.Send("MOTION_CHANGE", { kind: probe_kind });
        }, PROBE_INTERVAL_MS)
    );

    while (Date.now() - started < seconds * 1000) {
        await Sleep(250);
        if (sampler.LatestMemory() > MEMORY_ABORT_BYTES) {
            aborted = true;
            console.log(`  ⚠️ 서버 RSS ${Fmt(sampler.LatestMemory() / 1e6)}MB — 이 구간을 멈춥니다`);
            break;
        }
    }
    for (const timer of timers) {
        clearInterval(timer);
        clearTimeout(timer);
    }
    const ended = Date.now();
    lag_meter.Stop();
    const cpu_used = process.cpuUsage(cpu_before);
    const wall_sec = (ended - started) / 1000;

    // 서버에 쌓여 있던 송신이 다 빠질 때까지 잠깐 더 받아 본다(밀린 양 = 잔여 수신)
    const frames_at_end = totals.frames;
    await Sleep(2000);
    const backlog_frames = totals.frames - frames_at_end;
    probe.on_decoded = null;

    const server = sampler.Summarize(started, ended + 1500);
    const result = {
        name,
        server_cpu: server.cpu,
        server_rss_mb: server.rss_max / 1e6,
        recv_msgs_per_sec: frames_at_end / wall_sec,
        recv_mbps: (totals.bytes * 8) / wall_sec / 1e6,
        per_bot_kbps: (totals.bytes * 8) / wall_sec / bots.length / 1e3,
        rtt_p50: Percentile(rtts, 0.5),
        rtt_p99: Percentile(rtts, 0.99),
        rtt_max: rtts.length ? Math.max(...rtts) : NaN,
        probe_lost,
        moves_gap_p50: Percentile(move_gaps, 0.5),
        moves_gap_max: move_gaps.length ? Math.max(...move_gaps) : NaN,
        moves_size_avg: move_sizes.length ? move_sizes.reduce((a, b) => a + b, 0) / move_sizes.length : NaN,
        moves_entries_avg: move_entries.length ? move_entries.reduce((a, b) => a + b, 0) / move_entries.length : NaN,
        backlog_frames,
        tool_cpu: ((cpu_used.user + cpu_used.system) / 1000 / (wall_sec * 1000)) * 100,
        tool_lag_p99: Percentile(lag_meter.lags, 0.99),
        aborted,
    };
    console.log(`  서버 CPU ${Fmt(result.server_cpu)}% · RSS 최대 ${Fmt(result.server_rss_mb)}MB`);
    console.log(`  봇 전체 수신 ${Fmt(result.recv_msgs_per_sec)}건/초 · ${Fmt(result.recv_mbps, 1)}Mbps (봇 1명 ${Fmt(result.per_bot_kbps)}kbps)`);
    console.log(`  타입별 수신: ${[...totals.by_type].map(([type, count]) => `${type}=${count}`).join(" ")}`);
    console.log(`  MOTION_CHANGE 왕복 p50 ${Fmt(result.rtt_p50)}ms · p99 ${Fmt(result.rtt_p99)}ms · 최대 ${Fmt(result.rtt_max)}ms · 응답 못 받음 ${probe_lost}회`);
    console.log(`  LOBBY_MOVES 간격 p50 ${Fmt(result.moves_gap_p50)}ms · 최대 ${Fmt(result.moves_gap_max)}ms · 평균 ${Fmt(result.moves_size_avg)}B · 항목 ${Fmt(result.moves_entries_avg, 1)}개`);
    console.log(`  종료 후 2초간 더 받은 밀린 메시지 ${backlog_frames}건`);
    console.log(`  측정기 CPU ${Fmt(result.tool_cpu)}% · 이벤트 루프 지연 p99 ${Fmt(result.tool_lag_p99)}ms`);
    return result;
}

// 보기 모드 — 측정 없이 hold_sec 동안 걷고 가끔 행동한다. 앉은 봇은 일어설 때까지 걷지 않는다.
async function HoldCrowd(bots, sampler) {
    console.log(`\n[보기] ${hold_sec}초 동안 분수대 둘레를 걷습니다 (행동 확률 ${HOLD_MOTION_CHANCE_PER_SEC}/초)`);
    const started = Date.now();
    const tick_ms = 1000 / move_hz;
    const motion_chance = HOLD_MOTION_CHANCE_PER_SEC * (tick_ms / 1000);
    const sitting = new Set();
    const timer = setInterval(() => {
        const elapsed = (Date.now() - started) / 1000;
        for (const bot of bots) {
            if (Math.random() < motion_chance) {
                const kind = sitting.has(bot) ? 2 : [1, 3, 4][Math.floor(Math.random() * 3)];
                if (kind === 1) sitting.add(bot);
                if (kind === 2) sitting.delete(bot);
                bot.Send("MOTION_CHANGE", { kind });
            }
            if (!sitting.has(bot)) bot.Send("LOBBY_MOVE", BotPosition(bot, elapsed));
        }
    }, tick_ms);
    let next_report = started + 30000;
    while (Date.now() - started < hold_sec * 1000 && !stop_requested) {
        await Sleep(250);
        if (Date.now() >= next_report) {
            const window = sampler.Summarize(next_report - 30000, Date.now());
            console.log(`  ${Math.round((Date.now() - started) / 1000)}초 · 서버 CPU ${Fmt(window.cpu)}% · RSS 최대 ${Fmt(window.rss_max / 1e6)}MB · 앉은 봇 ${sitting.size}`);
            next_report += 30000;
        }
    }
    clearInterval(timer);
    console.log(stop_requested ? "  중단 요청 — 정리합니다" : "  시간 종료 — 정리합니다");
}

async function Main() {
    const conn = await import("../dist/db/connection.js");
    const redis = await import("../dist/db/redis.js");
    const pool = conn.GetDbPool();
    const bots = [];
    let sampler = null;
    const results = [];
    try {
        const lobby = GetLobbyPid();
        console.log(`lobby_1 pid=${lobby.pid} cwd=${lobby.cwd}`);
        console.log(`봇 ${bot_count}명 · 이동 ${move_hz}Hz · 구간 idle ${idle_sec}s / move ${move_sec}s / motion ${motion_sec}s`);
        sampler = StartServerSampler(lobby.pid);

        console.log("\n[입장] 봇 접속 + 별명");
        const enter_started = Date.now();
        for (let from = 0; from < bot_count; from += CONNECT_BATCH) {
            const batch = [];
            for (let index = from; index < Math.min(bot_count, from + CONNECT_BATCH); index++) batch.push(EnterBot(index));
            for (const outcome of await Promise.allSettled(batch)) {
                if (outcome.status === "fulfilled") bots.push(outcome.value);
                else console.log(`  ✖ ${outcome.reason?.message ?? outcome.reason}`);
            }
        }
        const real_users = bots.length > 0 ? bots[0].others_at_enter : 0;
        console.log(`  입장 ${bots.length}/${bot_count}명 · ${Fmt((Date.now() - enter_started) / 1000, 1)}초 · 첫 봇이 본 기존 접속자 ${real_users}명`);
        if (bots.length === 0) throw new Error("봇이 하나도 못 들어왔습니다");
        const enter_window = sampler.Summarize(enter_started, Date.now());
        console.log(`  입장 동안 서버 CPU ${Fmt(enter_window.cpu)}% · RSS 최대 ${Fmt(enter_window.rss_max / 1e6)}MB`);

        // 분수대로 모으기 — 한 번 보내고 flush 를 기다린다
        for (const bot of bots) bot.Send("LOBBY_MOVE", BotPosition(bot, 0));
        await Sleep(1500);

        if (hold_sec > 0) {
            await HoldCrowd(bots, sampler);
            return;
        }

        const probe = bots[0];
        results.push(await RunPhase("idle", idle_sec, bots, probe, sampler, { description: "분수대 둘레에 가만히" }));
        results.push(await RunPhase("move", move_sec, bots, probe, sampler, { move: true, description: `모두 걷기 (LOBBY_MOVE ${move_hz}Hz)` }));
        results.push(await RunPhase("motion", motion_sec, bots, probe, sampler, { move: true, motion: true, description: `걷기 + MOTION_CHANGE ${MOTION_INTERVAL_MS}ms 연타` }));

        console.log("\n요약 (구간 | 서버 CPU% | RSS MB | 수신 건/초 | Mbps | 봇당 kbps | 왕복 p50/p99 ms | 밀린 건)");
        for (const row of results) {
            console.log(
                `  ${row.name.padEnd(6)} | ${Fmt(row.server_cpu).padStart(4)} | ${Fmt(row.server_rss_mb).padStart(4)} | ${Fmt(row.recv_msgs_per_sec).padStart(7)} | ${Fmt(row.recv_mbps, 1).padStart(5)} | ${Fmt(row.per_bot_kbps).padStart(5)} | ${Fmt(row.rtt_p50)}/${Fmt(row.rtt_p99)} | ${row.backlog_frames}${row.aborted ? " (중단)" : ""}`
            );
        }
    } finally {
        for (const bot of bots) bot.Leave();
        await Sleep(1500);
        for (const bot of bots) bot.socket.terminate();
        sampler?.Stop();
        console.log("\n정리:");
        const placeholders = ALL_USERIDS.map(() => "?").join(",");
        for (const table of ["rps_user_play_info", "othello_user_play_info", "stepping_user_play_info", "airhockey_user_play_info", "flag_user_play_info", "user_member_info", "user_partner_info"]) {
            await pool.query(`DELETE FROM ${table} WHERE userid IN (${placeholders})`, ALL_USERIDS);
        }
        for (const userid of ALL_USERIDS) await redis.DeleteJson(`user:info:${userid}`);
        console.log(`  테스트 유저 ${ALL_USERIDS.length}명 행·Redis 키 삭제 완료`);
        await pool.end();
        redis.GetRedisClient().disconnect();
    }
}

Main().catch((error) => {
    console.error("측정 실패:", error);
    process.exitCode = 1;
});
