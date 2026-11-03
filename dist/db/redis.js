// Redis 클라이언트 관리 + JSON 저장/조회/삭제 헬퍼, 채널간 공유 정보 저장
import { Redis } from "ioredis";
import { config } from "../common/config.js";
let client;
export function GetRedisClient() {
    if (!client) {
        client = new Redis({
            host: config.redis_host,
            port: config.redis_port,
            // Colyseus 의 Redis Presence/Driver 도 같은 서버를 쓰게 되므로, 연결이 잠깐 끊겨도 계속 재시도한다
            retryStrategy: (times) => Math.min(times * 200, 2000),
        });
    }
    return client;
}
export async function SetJson(key, value, ttl_sec) {
    await GetRedisClient().set(key, JSON.stringify(value), "EX", ttl_sec);
}
export async function GetJson(key) {
    const raw = await GetRedisClient().get(key);
    if (raw === null)
        return null;
    return JSON.parse(raw);
}
export async function DeleteJson(key) {
    await GetRedisClient().del(key);
}
// 키의 TTL 만 다시 설정한다. 키가 이미 없으면 false (호출한 쪽에서 SetJson 으로 다시 저장해야 함)
export async function Touch(key, ttl_sec) {
    const result = await GetRedisClient().expire(key, ttl_sec);
    return result === 1;
}
// 키가 없을 때만 TTL 과 함께 저장한다 (SET NX EX). 저장했으면 true, 이미 있었으면 false — 간격 제한용
export async function SetIfAbsent(key, ttl_sec) {
    const result = await GetRedisClient().set(key, "1", "EX", ttl_sec, "NX");
    return result === "OK";
}
//# sourceMappingURL=redis.js.map