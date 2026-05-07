<?php
declare(strict_types=1);

/** Leaderboard endpoint consumed by PHP/JS web UIs. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

try {
    $pdo = irpg_pdo();
    $presence = irpg_bot_presence($pdo);
    $pulse = irpg_realm_pulse($pdo);
    $stmt = $pdo->query(
        'SELECT character_name, class, level, next_seconds, idled, online,
                COALESCE(guild_id, 0) AS guild_id, COALESCE(prestige_rank, 0) AS prestige_rank
         FROM players
         ORDER BY level DESC, next_seconds ASC
         LIMIT 100',
    );
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $players = [];
    foreach ($rows as $p) {
        $next = (float) $p['next_seconds'];
        $players[] = [
            'name' => $p['character_name'],
            'level' => (int) $p['level'],
            'class' => $p['class'],
            'nextSeconds' => $next,
            'nextHuman' => irpg_duration_it($next),
            'online' => (bool) $p['online'],
            'idledHours' => round(((int) $p['idled'] / 3600) * 10) / 10,
            'guildId' => (int) $p['guild_id'],
            'prestigeRank' => (int) $p['prestige_rank'],
        ];
    }
    $guildPreview = [];
    try {
        $gstmt = $pdo->query(
            'SELECT g.tag, g.name, g.created_at, COUNT(m.player_id) AS members
             FROM guilds g
             LEFT JOIN guild_members m ON m.guild_id = g.id
             GROUP BY g.id, g.tag, g.name, g.created_at
             ORDER BY members DESC, g.created_at ASC
             LIMIT 5'
        );
        $grow = $gstmt ? $gstmt->fetchAll(PDO::FETCH_ASSOC) : [];
        foreach ($grow as $g) {
            $gidStmt = $pdo->prepare('SELECT id FROM guilds WHERE tag = ? AND name = ? LIMIT 1');
            $gidStmt->execute([(string) $g['tag'], (string) $g['name']]);
            $gidRow = $gidStmt->fetch(PDO::FETCH_ASSOC);
            $memberRows = [];
            if ($gidRow && isset($gidRow['id'])) {
                $mstmt = $pdo->prepare(
                    'SELECT p.character_name, m.role
                     FROM guild_members m
                     JOIN players p ON p.id = m.player_id
                     WHERE m.guild_id = ?
                     ORDER BY m.role DESC, p.level DESC, p.character_name ASC
                     LIMIT 20'
                );
                $mstmt->execute([(int) $gidRow['id']]);
                $memberRows = $mstmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            }
            $members = [];
            foreach ($memberRows as $m) {
                $members[] = [
                    'name' => (string) ($m['character_name'] ?? ''),
                    'role' => (string) ($m['role'] ?? 'member'),
                ];
            }
            $guildPreview[] = [
                'tag' => (string) $g['tag'],
                'name' => (string) $g['name'],
                'members' => (int) $g['members'],
                'createdAt' => (int) ($g['created_at'] ?? 0),
                'memberList' => $members,
            ];
        }
    } catch (Throwable) {
        $guildPreview = [];
    }
    $seasonPreview = [];
    $seasonMeta = null;
    try {
        $seasonNow = time();
        $tierXpRaw = getenv('IRPG_V3_SEASON_TIER_XP');
        $tierXp = (int) ($tierXpRaw !== false ? $tierXpRaw : 600);
        if ($tierXp < 1) {
            $tierXp = 600;
        }
        $sst = $pdo->prepare(
            'SELECT id, label, starts_at, ends_at
             FROM seasons
             WHERE ends_at >= ?
             ORDER BY id DESC
             LIMIT 1'
        );
        $sst->execute([$seasonNow]);
        $seasonRow = $sst->fetch(PDO::FETCH_ASSOC);
        if ($seasonRow !== false) {
            $seasonId = (int) ($seasonRow['id'] ?? 0);
            $seasonMeta = [
                'id' => $seasonId,
                'label' => (string) ($seasonRow['label'] ?? ''),
                'startsAt' => (int) ($seasonRow['starts_at'] ?? 0),
                'endsAt' => (int) ($seasonRow['ends_at'] ?? 0),
            ];
            if ($seasonId > 0) {
                $pst = $pdo->prepare(
                    'SELECT p.character_name, p.class, p.level, p.online, psp.xp, psp.updated_at
                     FROM player_season_progress psp
                     JOIN players p ON p.id = psp.player_id
                     WHERE psp.season_id = ?
                     ORDER BY psp.xp DESC, p.level DESC, p.next_seconds ASC, p.character_name ASC
                     LIMIT 10'
                );
                $pst->execute([$seasonId]);
                $prow = $pst->fetchAll(PDO::FETCH_ASSOC);
                foreach ($prow as $s) {
                    $xp = max(0, (int) ($s['xp'] ?? 0));
                    $seasonPreview[] = [
                        'name' => (string) ($s['character_name'] ?? ''),
                        'class' => (string) ($s['class'] ?? ''),
                        'level' => (int) ($s['level'] ?? 0),
                        'online' => ((int) ($s['online'] ?? 0)) === 1,
                        'xp' => $xp,
                        'tier' => (int) floor($xp / $tierXp),
                        'updatedAt' => (int) ($s['updated_at'] ?? 0),
                    ];
                }
            }
        }
    } catch (Throwable) {
        $seasonPreview = [];
    }
    // UTC ISO-8601: snapshot time for the web UI (timers reflect DB at this moment).
    echo json_encode(
        [
            'players' => $players,
            'generatedAt' => gmdate('c'),
            'botOnline' => $presence['botOnline'],
            'botLastSeenMs' => $presence['botLastSeenMs'],
            'aiEnabled' => irpg_ai_enabled($pdo),
            'realmPulse' => $pulse,
            'season' => $pulse['seasonLabel'] ?? null,
            'seasonMeta' => $seasonMeta,
            'worldBoss' => $pulse['worldBoss'] ?? null,
            'guildsPreview' => $guildPreview,
            'seasonPreview' => $seasonPreview,
        ],
        JSON_THROW_ON_ERROR,
    );
} catch (Throwable $e) {
    irpg_server_error($e);
}
