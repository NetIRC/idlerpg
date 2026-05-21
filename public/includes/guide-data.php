<?php
declare(strict_types=1);

/** Shared command tables and FAQ entries for public guide pages (how-to-play, commands, FAQ). */

require_once __DIR__ . '/guide-env.php';

/**
 * @return list<array{cmd: string, args: string, desc: string, group: string}>
 */
function guide_channel_commands(): array
{
    $c = guide_runtime_config();
    $ch = (string) $c['ircChannel'];
    $gap = (int) $c['duelMaxLevelGap'];
    $prestigeLvl = (int) $c['v3PrestigeMinLevel'];
    $prestigePct = (string) $c['v3PrestigeIdleBonusPct'];
    $guildPct = (string) $c['v3GuildIdleBonusPct'];

    $rows = [
        ['group' => 'Help & rules', 'cmd' => '!help', 'args' => '', 'desc' => 'Short help tailored to whether you are logged in.'],
        ['group' => 'Help & rules', 'cmd' => '!cmds', 'args' => '', 'desc' => 'Alias: !commands — full list of recognized public commands (no chat penalty).'],
        ['group' => 'Help & rules', 'cmd' => '!rules', 'args' => '', 'desc' => 'One-line summary: idle to level, chat costs time, PM REGISTER/LOGIN while in ' . $ch . '.'],
        ['group' => 'Help & rules', 'cmd' => '!ping', 'args' => '', 'desc' => 'Bot liveness check and build version.'],

        ['group' => 'Your hero', 'cmd' => '!whoami', 'args' => '', 'desc' => 'IRC nick, character name, level, and cooldown summary.'],
        ['group' => 'Your hero', 'cmd' => '!stats', 'args' => '[name]', 'desc' => 'Class, level, timer, idle hours, alignment, streak, guild, relic (self or named hero).'],
        ['group' => 'Your hero', 'cmd' => '!time', 'args' => '[name]', 'desc' => 'Countdown to next level (self or named hero).'],
        ['group' => 'Your hero', 'cmd' => '!medals', 'args' => '[name]', 'desc' => 'Alias: !badges — medal rack and arena/gauntlet wins.'],
        ['group' => 'Your hero', 'cmd' => '!top', 'args' => '', 'desc' => 'Top three heroes by level.'],
        ['group' => 'Your hero', 'cmd' => '!records', 'args' => '', 'desc' => 'Realm records and highs.'],

        ['group' => 'Realm & events', 'cmd' => '!quest', 'args' => '', 'desc' => 'Active quest status and time left.'],
        ['group' => 'Realm & events', 'cmd' => '!realm', 'args' => '', 'desc' => 'Alias: !pulse — online count, quest, lucky hour, daily trial, peak level.'],
        ['group' => 'Realm & events', 'cmd' => '!chronicle', 'args' => '', 'desc' => 'Recent realm events (logins, levels, duels, part/quit, boss, etc.).'],
        ['group' => 'Realm & events', 'cmd' => '!lore', 'args' => '[topic]', 'desc' => 'Optional flavor text; topic is free-form.'],

        ['group' => 'Actions (cooldowns)', 'cmd' => '!omen', 'args' => '', 'desc' => 'Personal omen — cooldown ' . guide_format_duration((int) $c['omenCooldownSec']) . '; neutral, boon, curse, or rare outcome.'],
        ['group' => 'Actions (cooldowns)', 'cmd' => '!duel', 'args' => '<irc_nick>', 'desc' => 'PvP in ' . $ch . ' (±' . $gap . ' levels); initiator cooldown ' . guide_format_duration((int) $c['duelCooldownSec']) . '.'],
        ['group' => 'Actions (cooldowns)', 'cmd' => '!gauntlet', 'args' => '', 'desc' => 'PvE trial; cooldown ' . guide_format_duration((int) $c['gauntletCooldownSec']) . '; risk/reward timer change.'],
    ];

    if ($c['v3BountyEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!bounty', 'args' => '', 'desc' => 'Daily contract: ' . guide_format_duration((int) $c['v3BountyTargetSec']) . ' idle target, reward -' . guide_format_duration((int) $c['v3BountyRewardSec']) . ' timer.'];
    }
    if ($c['v3SeasonEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!season', 'args' => '', 'desc' => 'Season pass — ' . (string) $c['v3SeasonLengthDays'] . 'd seasons, ' . (string) $c['v3SeasonPassXpPerMinute'] . ' XP/min idle, tier every ' . (string) $c['v3SeasonTierXp'] . ' XP.'];
    }
    if ($c['v3WorldBossEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!boss', 'args' => '', 'desc' => 'World boss window (' . guide_format_duration((int) $c['v3WorldBossDurationSec']) . '), spawns about every ' . guide_format_duration((int) $c['v3WorldBossIntervalSec']) . '.'];
    }
    if ($c['v3GuildEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!guild', 'args' => 'status', 'desc' => 'Guild tag, members, passive idle bonus ' . $guildPct . '.'];
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!guild', 'args' => 'create <TAG> <Name>', 'desc' => 'Create a guild (you become leader).'];
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!guild', 'args' => 'join <TAG>', 'desc' => 'Join an existing guild by tag.'];
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!guild', 'args' => 'leave', 'desc' => 'Leave your current guild.'];
    }
    if ($c['v3RelicEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!relic', 'args' => 'status | list', 'desc' => 'Owned relic keys; * marks active (quest levy -' . (string) $c['v3RelicQuestLevyPct'] . ', omen +' . (string) $c['v3RelicOmenLuckPct'] . ', streak +' . (string) $c['v3RelicStreakPct'] . ').'];
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!relic', 'args' => 'equip <key>', 'desc' => 'Set your active relic perk.'];
    }
    if ($c['v3PrestigeEnabledLive'] ?? false) {
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!prestige', 'args' => '', 'desc' => 'Prestige rank, +' . $prestigePct . ' idle rate per rank, rebirth at L' . $prestigeLvl . '.'];
        $rows[] = ['group' => 'V3 systems', 'cmd' => '!prestige', 'args' => 'now', 'desc' => 'Rebirth at L' . $prestigeLvl . '+: reset level/timer, permanent +' . $prestigePct . ' idle bonus per rank.'];
    }

    return $rows;
}

/**
 * @return list<array{cmd: string, args: string, desc: string, group: string}>
 */
function guide_pm_commands(): array
{
    $c = guide_runtime_config();
    $ch = (string) $c['ircChannel'];

    return [
        ['group' => 'Account', 'cmd' => 'REGISTER', 'args' => '<Name> <password> <class...>', 'desc' => 'Create a hero while your nick is in ' . $ch . '. Password = one word; class may contain spaces.'],
        ['group' => 'Account', 'cmd' => 'LOGIN', 'args' => '<Name> <password>', 'desc' => 'Open a game session (required after LOGOUT, kick, or admin session reset).'],
        ['group' => 'Account', 'cmd' => 'LOGOUT', 'args' => '', 'desc' => 'Close session immediately (~' . (string) $c['penLogoutMult'] . '× base penalty on level timer); LOGIN required to return.'],

        ['group' => 'Help', 'cmd' => 'HELP', 'args' => '', 'desc' => 'PM help page 1 (register/login).'],
        ['group' => 'Help', 'cmd' => 'CMDS', 'args' => '', 'desc' => 'PM help page 2 (full command list).'],
        ['group' => 'Help', 'cmd' => 'PING', 'args' => '', 'desc' => 'Bot liveness and version.'],

        ['group' => 'Same as channel', 'cmd' => 'STATS', 'args' => '[name]', 'desc' => 'Same as !stats.'],
        ['group' => 'Same as channel', 'cmd' => 'TIME', 'args' => '[name]', 'desc' => 'Same as !time.'],
        ['group' => 'Same as channel', 'cmd' => 'WHOAMI', 'args' => '', 'desc' => 'Same as !whoami.'],
        ['group' => 'Same as channel', 'cmd' => 'TOP', 'args' => '', 'desc' => 'Leaderboard snapshot.'],
        ['group' => 'Same as channel', 'cmd' => 'RECORDS', 'args' => '', 'desc' => 'Same as !records.'],
        ['group' => 'Same as channel', 'cmd' => 'QUEST', 'args' => '', 'desc' => 'Same as !quest.'],
        ['group' => 'Same as channel', 'cmd' => 'BOUNTY', 'args' => '', 'desc' => 'Same as !bounty (when enabled).'],
        ['group' => 'Same as channel', 'cmd' => 'SEASON', 'args' => '', 'desc' => 'Same as !season (when enabled).'],
        ['group' => 'Same as channel', 'cmd' => 'BOSS', 'args' => '', 'desc' => 'Same as !boss (when enabled).'],
        ['group' => 'Same as channel', 'cmd' => 'GUILD', 'args' => '…', 'desc' => 'Same subcommands as !guild.'],
        ['group' => 'Same as channel', 'cmd' => 'RELIC', 'args' => '…', 'desc' => 'Same subcommands as !relic.'],
        ['group' => 'Same as channel', 'cmd' => 'PRESTIGE', 'args' => '[now]', 'desc' => 'Same as !prestige.'],
        ['group' => 'Same as channel', 'cmd' => 'REALM', 'args' => '', 'desc' => 'Alias: PULSE — same as !realm.'],
        ['group' => 'Same as channel', 'cmd' => 'CHRONICLE', 'args' => '', 'desc' => 'Same as !chronicle.'],
        ['group' => 'Same as channel', 'cmd' => 'OMEN', 'args' => '', 'desc' => 'Same as !omen.'],
        ['group' => 'Same as channel', 'cmd' => 'DUEL', 'args' => '<irc_nick>', 'desc' => 'Same as !duel.'],
        ['group' => 'Same as channel', 'cmd' => 'GAUNTLET', 'args' => '', 'desc' => 'Same as !gauntlet.'],
        ['group' => 'Same as channel', 'cmd' => 'MEDALS', 'args' => '[name]', 'desc' => 'Alias: BADGES — same as !medals.'],
        ['group' => 'Same as channel', 'cmd' => 'LORE', 'args' => '[topic]', 'desc' => 'Same as !lore.'],
    ];
}

/**
 * @return list<array{cmd: string, args: string, desc: string}>
 */
function guide_admin_commands(): array
{
    return [
        ['cmd' => 'ADMIN HELP', 'args' => '', 'desc' => 'List admin subcommands (authorized nicks only; usually must be in game channel).'],
        ['cmd' => 'ADMIN FORCELOGOUT', 'args' => '<CharacterName>', 'desc' => 'Close active session for that hero.'],
        ['cmd' => 'ADMIN DELETEUSER', 'args' => '<CharacterName>', 'desc' => 'Permanently delete character and related data.'],
        ['cmd' => 'ADMIN RESETPASS', 'args' => '<CharacterName> <newpassword>', 'desc' => 'Set new password and clear session.'],
        ['cmd' => 'ADMIN STARTQUEST', 'args' => '', 'desc' => 'Force-start a quest when runtime checks pass.'],
        ['cmd' => 'ADMIN LUCKY', 'args' => '', 'desc' => 'Trigger lucky-hour style broadcast.'],
        ['cmd' => 'ADMIN SAY', 'args' => '<text…>', 'desc' => 'Bot speaks in the game channel.'],
        ['cmd' => 'ADMIN SHUTDOWN', 'args' => '[note…]', 'desc' => 'Graceful bot shutdown.'],
        ['cmd' => 'ADMIN RESTART', 'args' => '[note…]', 'desc' => 'Restart signal for process supervisor.'],
    ];
}

/**
 * @return list<array{q: string, a: string}>
 */
function guide_faq_entities(): array
{
    $c = guide_runtime_config();
    $ch = (string) $c['ircChannel'];
    $host = (string) $c['ircHost'];
    $port = (int) $c['ircPort'];
    $gap = (int) $c['duelMaxLevelGap'];
    $grace = (int) $c['netsplitGraceSec'];
    $graceNote = $grace > 0
        ? ' Netsplit grace: ' . guide_format_duration($grace) . '.'
        : '';

    return [
        [
            'q' => 'How do I start playing?',
            'a' => 'Join ' . $ch . ' on NetIRC (' . $host . ':' . $port . '), then private-message the bot: REGISTER <CharacterName> <password> <class…>. Password must be one word.',
        ],
        [
            'q' => 'Why am I not leveling?',
            'a' => 'You must be logged in, your nick must stay visible in ' . $ch . ', and the bot must be online. Base level timer starts at ' . guide_format_duration((int) $c['rpbase']) . '. Normal channel chat adds penalty; recognized !commands do not.',
        ],
        [
            'q' => 'How long is each level if I stay idle?',
            'a' => 'Standard idle time is rpbase × rpstep^L seconds up to L60, then +1 day per level above 60 (no hero level cap). See the Level timer formula section on How to Play, Commands, or FAQ for this shard\'s numbers and examples.',
        ],
        [
            'q' => 'Do I need LOGIN after PART or QUIT?',
            'a' => 'No. PART or QUIT IRC suspends your session; rejoin ' . $ch . ' to resume. LOGIN is required after LOGOUT, kick, admin reset, or expired netsplit grace.' . $graceNote,
        ],
        [
            'q' => 'What is the difference between QUIT and LOGOUT?',
            'a' => 'QUIT is an IRC disconnect (penalty ~' . (string) $c['penQuitMult'] . '× base) — session stays suspended. LOGOUT is a PM command (~' . (string) $c['penLogoutMult'] . '× base) — session closes and you must LOGIN again.',
        ],
        [
            'q' => 'What if I PART and then QUIT IRC?',
            'a' => 'PART applies first (~' . (string) $c['penPartMult'] . '× base). The later QUIT is ignored if you were already offline in-game. Rejoin ' . $ch . ' — no LOGIN needed.',
        ],
        [
            'q' => 'Does chatting slow me down?',
            'a' => 'Yes. Normal messages add to your level timer (scales with your level). Valid !commands do not. Unknown !foo lines count as chat.',
        ],
        [
            'q' => 'How do quests, boss, and season work?',
            'a' => 'They run automatically when enabled on this realm. Quests need ' . (string) $c['questMinPlayers'] . '+ heroes online; lucky hour chance is ' . (string) $c['luckyHourChancePct'] . ' when active. Use !quest, !boss, and !season for live status.',
        ],
        [
            'q' => 'What are !omen, !duel, and !gauntlet?',
            'a' => 'Cooldown actions: omen every ' . guide_format_duration((int) $c['omenCooldownSec']) . ', duel every ' . guide_format_duration((int) $c['duelCooldownSec']) . ' (±' . $gap . ' levels), gauntlet every ' . guide_format_duration((int) $c['gauntletCooldownSec']) . '.',
        ],
        [
            'q' => 'Why does !guild or !bounty say disabled?',
            'a' => 'That feature is turned off on this realm. Check the Realm settings section in Commands for what is active here.',
        ],
        [
            'q' => 'I forgot my password.',
            'a' => 'Ask a channel admin to run ADMIN RESETPASS <CharacterName> <newpassword> in PM. You must LOGIN again with the new password.',
        ],
    ];
}

/**
 * @param list<array{cmd: string, args: string, desc: string, group?: string}> $rows
 */
function guide_render_command_table(array $rows): void
{
    if ($rows === []) {
        return;
    }
    $currentGroup = null;
    echo '<div class="cmd-ref-wrap">';
    foreach ($rows as $row) {
        $group = $row['group'] ?? '';
        if ($group !== '' && $group !== $currentGroup) {
            if ($currentGroup !== null) {
                echo '</tbody></table>';
            }
            $currentGroup = $group;
            echo '<h3 class="cmd-ref-group">' . htmlspecialchars($group, ENT_QUOTES, 'UTF-8') . '</h3>';
            echo '<table class="cmd-ref cmd-ref--commands"><colgroup><col class="cmd-ref-col-cmd" /><col class="cmd-ref-col-args" /><col class="cmd-ref-col-desc" /></colgroup><thead><tr><th scope="col">Command</th><th scope="col">Args</th><th scope="col">What it does</th></tr></thead><tbody>';
        } elseif ($currentGroup === null) {
            $currentGroup = '_';
            echo '<table class="cmd-ref cmd-ref--commands"><colgroup><col class="cmd-ref-col-cmd" /><col class="cmd-ref-col-args" /><col class="cmd-ref-col-desc" /></colgroup><thead><tr><th scope="col">Command</th><th scope="col">Args</th><th scope="col">What it does</th></tr></thead><tbody>';
        }
        $cmd = htmlspecialchars($row['cmd'], ENT_QUOTES, 'UTF-8');
        $args = htmlspecialchars($row['args'], ENT_QUOTES, 'UTF-8');
        $desc = htmlspecialchars($row['desc'], ENT_QUOTES, 'UTF-8');
        echo "<tr><td class=\"mono\">{$cmd}</td><td class=\"mono muted-strong\">{$args}</td><td>{$desc}</td></tr>";
    }
    echo '</tbody></table></div>';
}
