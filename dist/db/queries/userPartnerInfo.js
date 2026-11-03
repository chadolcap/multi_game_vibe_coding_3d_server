// (partner, mid) → userid 조회
export async function FindUseridByPartnerMid(pool, partner, mid) {
    const [rows] = await pool.query("SELECT userid FROM user_partner_info WHERE partner = ? AND mid = ? LIMIT 1", [partner, mid]);
    return rows.length > 0 ? rows[0].userid : null;
}
//# sourceMappingURL=userPartnerInfo.js.map