# RESEARCH-0001 AC-18 合成存储与删除 runbook

| 字段 | 值 |
| --- | --- |
| 状态 | `Draft / Do not run` |
| 版本 | `0.1.0` |
| 日期 | `2026-09-01` |
| 适用决策 | [`ADR-0004`](../adr/ADR-0004-research-data-custody-and-deletion.md) |
| 执行者 | 仅 Alune |

## 1. 授权边界

本文件是唯一的版本化操作说明，不是脚本，也不构成执行授权。只有同时满足以下条件后，才可在本机 Terminal 手工逐段执行：

1. `ADR-0004` 已由 Alune 明确改为 `Accepted`；
2. Alune 另行明确授权一次本机合成演练；
3. preflight 的每项结果均为已证明，而不是 `UNKNOWN`、不可用或推测；
4. 只使用本文件的三条 `.invalid` 合成记录，不招募、不联系参与者、不分发原型，也不处理真实数据。

第 1 项已满足；第 2 项的一次性合成演练授权尚未给予，实际 preflight 也未执行，因此四项仍未全部满足，本文件当前不得执行。ADR 获批只批准设计，不自动批准本演练；本演练通过也只可能支持 AC-18，不改变 `RESEARCH-0001=Draft`。

## 2. 全程停止条件

以下任一情形立即停止：命令非零且本节没有明确把非零列为预期；输出与预期不符；命令不可用或被权限/框架阻止；路径、owner、mode、ACL、挂载、快照、同步/备份代理无法完整确认；出现未知文件、sidecar、打开句柄或额外挂载；SQLite 约束、事务、完整性或外键 readback 不符。

停止时不得猜测、跳过、建立恢复副本或先删 A；停止写入，关闭数据库，能安全卸载时卸载，并把结果记为 `pause / not-proven`。任何密码、研究编号、联系方式、数据库页或完整终端输出都不得写入仓库或证据。

## 3. 新 Terminal 与固定路径

新开一个未共享屏幕、未录制、已获 Full Disk Access 的本机 Terminal 窗口。先关闭历史和 tracing；不要打开 Finder、Quick Look、编辑器或终端 transcript 记录功能。

```zsh
unset HISTFILE
set +x
set -e
set -o pipefail
umask 077

BASE='/Users/alune/Library/Application Support'
RESEARCH_PARENT='/Users/alune/Library/Application Support/Zhiguan Research'
ROOT='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001'
A_IMAGE='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/A.asif'
B_IMAGE='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/B.asif'
MOUNT_A='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/.mount-a'
MOUNT_B='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/.mount-b'
DB_A='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/.mount-a/participant.sqlite3'
DB_B='/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/.mount-b/observation.sqlite3'

SQLITE_PROLOGUE="PRAGMA foreign_keys=ON;
PRAGMA journal_mode=DELETE;
PRAGMA synchronous=EXTRA;
PRAGMA secure_delete=ON;
PRAGMA journal_size_limit=0;
PRAGMA temp_store=MEMORY;
CREATE TEMP TABLE runtime_contract_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO runtime_contract_guard
SELECT (SELECT foreign_keys FROM pragma_foreign_keys)=1
   AND (SELECT journal_mode FROM pragma_journal_mode)='delete'
   AND (SELECT synchronous FROM pragma_synchronous)=3
   AND (SELECT secure_delete FROM pragma_secure_delete)=1
   AND (SELECT journal_size_limit FROM pragma_journal_size_limit)=0
   AND (SELECT temp_store FROM pragma_temp_store)=2;
SELECT 'runtime_contract=pass';"

sqlite_run() {
    { /usr/bin/printf '%s\n' "$SQLITE_PROLOGUE"; /bin/cat; } |
        /usr/bin/sqlite3 -noinit -batch -bail -nofollow "$1"
}

test "$(/usr/bin/id -un)" = 'alune' || exit 1
test "$(/usr/bin/id -u)" -ne 0 || exit 1
test ! -L "$BASE" || exit 1
test "$(/bin/realpath "$BASE")" = "$BASE" || exit 1
test ! -L "$RESEARCH_PARENT" || exit 1
test ! -L "$ROOT" || exit 1
test ! -e "$ROOT" || exit 1
```

固定根目录是 `/Users/alune/Library/Application Support/Zhiguan Research/RESEARCH-0001/`。不得改到仓库、Desktop、Documents、iCloud Drive、`~/Library/CloudStorage`、共享目录或外置卷。

`sqlite_run` 只在当前 shell 内为每次连接注入同一运行合同和临时 guard，不创建脚本或配置文件。每次调用必须在业务输出前出现 `runtime_contract=pass`；设置命令还会瞬时输出 `delete`、`1`、`0`。guard 不通过时 SQLite 以非零退出，后续 SQL 不执行。

## 4. 空根目录与 fail-closed preflight

先只创建空目录并设置固定路径 Time Machine 排除；此时仍不得创建镜像。

```zsh
if test -e "$RESEARCH_PARENT"; then
    test -d "$RESEARCH_PARENT" || exit 1
    test "$(/bin/realpath "$RESEARCH_PARENT")" = "$RESEARCH_PARENT" || exit 1
else
    /bin/mkdir -m 700 "$RESEARCH_PARENT"
fi
test ! -L "$RESEARCH_PARENT" || exit 1
test "$(/bin/realpath "$RESEARCH_PARENT")" = "$RESEARCH_PARENT" || exit 1
/bin/chmod 700 "$RESEARCH_PARENT"
/bin/chmod -N "$RESEARCH_PARENT"
test "$(/usr/bin/stat -f '%Su:%OLp' "$RESEARCH_PARENT")" = 'alune:700' || exit 1
/bin/ls -ldeO@ "$RESEARCH_PARENT"

/bin/mkdir -m 700 "$ROOT"
/bin/mkdir -m 700 "$MOUNT_A" "$MOUNT_B"
/bin/chmod -N "$ROOT" "$MOUNT_A" "$MOUNT_B"
/usr/bin/sudo /usr/bin/tmutil addexclusion -p "$ROOT"

test ! -L "$ROOT" || exit 1
test "$(/bin/realpath "$ROOT")" = "$ROOT" || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$ROOT")" = 'alune:700' || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$MOUNT_A")" = 'alune:700' || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$MOUNT_B")" = 'alune:700' || exit 1
/bin/ls -ldeO@ "$ROOT" "$MOUNT_A" "$MOUNT_B"
test "$(/usr/bin/tmutil isexcluded -X "$ROOT" | /usr/bin/plutil -extract 0.IsExcluded raw -)" = '1' || exit 1
```

`ls` 不得显示额外 ACL。随后逐项人工检查以下瞬时输出，不保存原始输出：

```zsh
/usr/bin/tmutil destinationinfo
/usr/bin/tmutil status -X
/usr/bin/tmutil currentphase
/usr/bin/tmutil listlocalsnapshots /System/Volumes/Data
/usr/sbin/diskutil apfs listSnapshots -plist /System/Volumes/Data

/usr/bin/fileproviderctl dump
/usr/bin/pluginkit -m -p com.apple.fileprovider-nonui -A -D -v
for CANDIDATE in \
    '/Users/alune/Library/CloudStorage' \
    '/Users/alune/Library/Mobile Documents/com~apple~CloudDocs' \
    '/Users/alune/Library/LaunchAgents' \
    '/Library/LaunchAgents' \
    '/Library/LaunchDaemons'; do
    if test -d "$CANDIDATE"; then
        /usr/bin/find "$CANDIDATE" -mindepth 1 -maxdepth 1 -print
    else
        /usr/bin/printf 'absent: %s\n' "$CANDIDATE"
    fi
done
/usr/bin/sudo /usr/bin/sfltool dumpbtm
/bin/launchctl print gui/"$(/usr/bin/id -u)"
/bin/launchctl print system
/bin/ps -axo pid,user,command
/usr/bin/dscacheutil -q group -a name admin

/usr/bin/sudo /usr/sbin/systemsetup -getremotelogin
/usr/sbin/sharing -l -f json
/bin/launchctl print-disabled system | /usr/bin/grep -E 'screensharing|smbd|sshd'
```

必须同时确认：

- `tmutil destinationinfo` 明确为 `No destinations configured`，`status` 的 `Running=false`，`currentphase=BackupNotRunning`；
- Time Machine 和 APFS 的 Data 卷快照清单均为空；
- 每个 File Provider、后台项、launch agent/daemon 和当前进程都已识别，且其配置没有覆盖 `ROOT`、`Application Support` 或更宽的 Home；仅检查常见同步目录不算完整证明；
- `admin` 组只有系统 `root` 和 `alune`；Remote Login 为 Off，没有共享项覆盖 Home 或 `ROOT`，SMB、SSH 和屏幕共享保持禁用；
- 任一枚举命令不可运行、结果不完整、出现未知代理或作用域无法确认时，停止且不创建镜像。

证据只记录命令可运行、枚举项数量、是否发现覆盖范围和结论，不粘贴原始 provider、process、设备或路径清单。

## 5. 两份纸质密码与两个镜像

分别在两个临时 Terminal 窗口运行一次下列命令，把每个输出只抄到对应的独立密封纸条。不要使用 Keychain、密码管理器、剪贴板、文件或拍照；抄录并复核后清除各窗口的滚动缓冲并关闭窗口。

```zsh
/usr/bin/openssl rand -base64 24
```

回到主窗口。创建时从纸条手工输入隐藏提示；不得使用 `--stdinpassphrase` 或任何把密码放入 argv、环境变量或文件的选项。

```zsh
/usr/sbin/diskutil image create --encrypt blank --format ASIF --size 1GiB --volumeName RESEARCH-A -fs APFS "$A_IMAGE"
/usr/sbin/diskutil image create --encrypt blank --format ASIF --size 1GiB --volumeName RESEARCH-B -fs APFS "$B_IMAGE"

/bin/chmod 600 "$A_IMAGE" "$B_IMAGE"
/bin/chmod -N "$A_IMAGE" "$B_IMAGE"
test "$(/usr/bin/stat -f '%Su:%OLp' "$A_IMAGE")" = 'alune:600' || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$B_IMAGE")" = 'alune:600' || exit 1
/bin/ls -leO@ "$A_IMAGE" "$B_IMAGE"
```

任何创建失败或出现部分文件都停止；不得自动重试或广泛清理。

## 6. 私有挂载、格式和快照 readback

从两张纸分别手工输入隐藏提示。`DISK_A`、`DISK_B` 只保存非秘密设备标识；输出形状不符即停止。

```zsh
DISK_A="$(/usr/sbin/diskutil image attach --nobrowse --mountPoint "$MOUNT_A" "$A_IMAGE")"
DISK_B="$(/usr/sbin/diskutil image attach --nobrowse --mountPoint "$MOUNT_B" "$B_IMAGE")"

case "$DISK_A" in /dev/disk*) DISK_A="${DISK_A#/dev/}" ;; esac
case "$DISK_B" in /dev/disk*) DISK_B="${DISK_B#/dev/}" ;; esac
case "$DISK_A" in disk*) DISK_A_DIGITS="${DISK_A#disk}" ;; *) exit 1 ;; esac
case "$DISK_B" in disk*) DISK_B_DIGITS="${DISK_B#disk}" ;; *) exit 1 ;; esac
case "$DISK_A_DIGITS" in ''|*[!0-9]*) exit 1 ;; esac
case "$DISK_B_DIGITS" in ''|*[!0-9]*) exit 1 ;; esac
test "$DISK_A" != "$DISK_B" || exit 1
unset DISK_A_DIGITS DISK_B_DIGITS

test ! -L "$MOUNT_A" || exit 1
test ! -L "$MOUNT_B" || exit 1
test "$(/bin/realpath "$MOUNT_A")" = "$MOUNT_A" || exit 1
test "$(/bin/realpath "$MOUNT_B")" = "$MOUNT_B" || exit 1
test "$(/usr/sbin/diskutil info -plist "$MOUNT_A" | /usr/bin/plutil -extract MountPoint raw -)" = "$MOUNT_A" || exit 1
test "$(/usr/sbin/diskutil info -plist "$MOUNT_B" | /usr/bin/plutil -extract MountPoint raw -)" = "$MOUNT_B" || exit 1

/usr/sbin/diskutil image --plist info --extra "$A_IMAGE" | /usr/bin/plutil -p -
/usr/sbin/diskutil image --plist info --extra "$B_IMAGE" | /usr/bin/plutil -p -
/usr/sbin/diskutil info -plist "$MOUNT_A" | /usr/bin/plutil -p -
/usr/sbin/diskutil info -plist "$MOUNT_B" | /usr/bin/plutil -p -

VOLUME_A="$(/usr/sbin/diskutil info -plist "$MOUNT_A" | /usr/bin/plutil -extract DeviceIdentifier raw -)"
VOLUME_B="$(/usr/sbin/diskutil info -plist "$MOUNT_B" | /usr/bin/plutil -extract DeviceIdentifier raw -)"
test "$VOLUME_A" != "$VOLUME_B" || exit 1
case "$VOLUME_A" in disk*) VOLUME_A_REST="${VOLUME_A#disk}" ;; *) exit 1 ;; esac
case "$VOLUME_B" in disk*) VOLUME_B_REST="${VOLUME_B#disk}" ;; *) exit 1 ;; esac
VOLUME_A_WHOLE="${VOLUME_A_REST%%s*}"
VOLUME_B_WHOLE="${VOLUME_B_REST%%s*}"
VOLUME_A_SLICE="${VOLUME_A_REST#*s}"
VOLUME_B_SLICE="${VOLUME_B_REST#*s}"
test "$VOLUME_A_REST" != "$VOLUME_A_WHOLE" || exit 1
test "$VOLUME_B_REST" != "$VOLUME_B_WHOLE" || exit 1
case "$VOLUME_A_WHOLE" in ''|*[!0-9]*) exit 1 ;; esac
case "$VOLUME_B_WHOLE" in ''|*[!0-9]*) exit 1 ;; esac
case "$VOLUME_A_SLICE" in ''|*[!0-9]*) exit 1 ;; esac
case "$VOLUME_B_SLICE" in ''|*[!0-9]*) exit 1 ;; esac
unset VOLUME_A_REST VOLUME_B_REST VOLUME_A_WHOLE VOLUME_B_WHOLE VOLUME_A_SLICE VOLUME_B_SLICE
/usr/sbin/diskutil apfs listSnapshots -plist "$VOLUME_A"
/usr/sbin/diskutil apfs listSnapshots -plist "$VOLUME_B"
```

在运行下一个代码块前，人工 readback 必须确认：A/B 均为单文件 ASIF、AES-256 加密、APFS、逻辑上限 `1 GiB`、各只有一个挂载实体；`MountPoint` 与固定路径一致，两个 A/B 卷快照清单为空。`diskutil image info` 会在镜像未挂载时内部 attach，因此只能在本节已完成私有挂载后运行。任一项不符时停止；不得在挂载目录写入索引标记或数据库。

确认挂载确实属于 A/B 后，才执行首次卷内写入并禁用 Spotlight：

```zsh
/bin/chmod 700 "$MOUNT_A" "$MOUNT_B"
/bin/chmod -N "$MOUNT_A" "$MOUNT_B"
test "$(/usr/bin/stat -f '%Su:%OLp' "$MOUNT_A")" = 'alune:700' || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$MOUNT_B")" = 'alune:700' || exit 1
/bin/ls -ldeO@ "$MOUNT_A" "$MOUNT_B"
/usr/bin/touch "$MOUNT_A/.metadata_never_index" "$MOUNT_B/.metadata_never_index"
/bin/chmod 600 "$MOUNT_A/.metadata_never_index" "$MOUNT_B/.metadata_never_index"
/usr/bin/mdutil -i off "$MOUNT_A"
/usr/bin/mdutil -i off "$MOUNT_B"
/usr/bin/mdutil -s "$MOUNT_A"
/usr/bin/mdutil -s "$MOUNT_B"
```

Spotlight readback 必须为 disabled，A/B 卷根 mode 必须为 `0700` 且无额外 ACL，才可创建数据库。

## 7. Storage A：仅 AC-18 合成演练的 DDL

此 DDL 不是 AC-19 的真实同意/联系合同。AC-19 改变状态语义、渠道或撤回确认后，必须更新 DDL并重跑本演练。

```zsh
sqlite_run "$DB_A" <<'SQL'
BEGIN IMMEDIATE;
-- BEGIN A DDL
CREATE TABLE participant (
    research_id TEXT NOT NULL PRIMARY KEY
        DEFAULT (lower(hex(randomblob(16))))
        CHECK (
            length(research_id) = 32
            AND research_id NOT GLOB '*[^0-9a-f]*'
        ),
    contact_value TEXT NOT NULL
        CHECK (
            length(contact_value) BETWEEN 1 AND 320
            AND trim(contact_value) = contact_value
            AND instr(contact_value, char(0)) = 0
            AND instr(contact_value, char(10)) = 0
            AND instr(contact_value, char(13)) = 0
        ),
    materials_version TEXT NOT NULL
        CHECK (
            length(materials_version) BETWEEN 1 AND 64
            AND trim(materials_version) = materials_version
            AND materials_version NOT GLOB '*[^0-9A-Za-z._-]*'
        ),
    research_consent_state TEXT NOT NULL
        CHECK (research_consent_state IN ('pending', 'consented', 'declined')),
    research_consent_decided_at TEXT,
    observation_authorization_state TEXT NOT NULL
        CHECK (observation_authorization_state IN ('pending', 'authorized', 'declined')),
    observation_authorization_decided_at TEXT,
    withdrawal_state TEXT NOT NULL DEFAULT 'not-withdrawn'
        CHECK (withdrawal_state IN ('not-withdrawn', 'withdrawn')),
    withdrawn_at TEXT,
    last_planned_follow_up_on TEXT,
    retention_until TEXT GENERATED ALWAYS AS (
        CASE
            WHEN last_planned_follow_up_on IS NULL THEN NULL
            ELSE date(last_planned_follow_up_on, '+30 days')
        END
    ) STORED,
    CHECK (
        (research_consent_state = 'pending' AND research_consent_decided_at IS NULL)
        OR (research_consent_state IN ('consented', 'declined') AND research_consent_decided_at IS NOT NULL)
    ),
    CHECK (
        research_consent_decided_at IS NULL
        OR (
            length(research_consent_decided_at) = 20
            AND research_consent_decided_at GLOB '????-??-??T??:??:??Z'
            AND strftime('%Y-%m-%dT%H:%M:%SZ', research_consent_decided_at) IS NOT NULL
            AND strftime('%Y-%m-%dT%H:%M:%SZ', research_consent_decided_at) = research_consent_decided_at
        )
    ),
    CHECK (
        (observation_authorization_state = 'pending' AND observation_authorization_decided_at IS NULL)
        OR (observation_authorization_state IN ('authorized', 'declined') AND observation_authorization_decided_at IS NOT NULL)
    ),
    CHECK (
        observation_authorization_decided_at IS NULL
        OR (
            length(observation_authorization_decided_at) = 20
            AND observation_authorization_decided_at GLOB '????-??-??T??:??:??Z'
            AND strftime('%Y-%m-%dT%H:%M:%SZ', observation_authorization_decided_at) IS NOT NULL
            AND strftime('%Y-%m-%dT%H:%M:%SZ', observation_authorization_decided_at) = observation_authorization_decided_at
        )
    ),
    CHECK (
        research_consent_state = 'consented'
        OR observation_authorization_state IN ('pending', 'declined')
    ),
    CHECK (
        (withdrawal_state = 'not-withdrawn' AND withdrawn_at IS NULL)
        OR (withdrawal_state = 'withdrawn' AND withdrawn_at IS NOT NULL)
    ),
    CHECK (
        withdrawn_at IS NULL
        OR (
            length(withdrawn_at) = 20
            AND withdrawn_at GLOB '????-??-??T??:??:??Z'
            AND strftime('%Y-%m-%dT%H:%M:%SZ', withdrawn_at) IS NOT NULL
            AND strftime('%Y-%m-%dT%H:%M:%SZ', withdrawn_at) = withdrawn_at
        )
    ),
    CHECK (
        last_planned_follow_up_on IS NULL
        OR (
            length(last_planned_follow_up_on) = 10
            AND last_planned_follow_up_on GLOB '????-??-??'
            AND date(last_planned_follow_up_on) IS NOT NULL
            AND date(last_planned_follow_up_on) = last_planned_follow_up_on
        )
    )
) STRICT;
-- END A DDL
COMMIT;

INSERT INTO runtime_contract_guard
SELECT count(*) = 1 AND min(integrity_check) = 'ok'
FROM pragma_integrity_check;
INSERT INTO runtime_contract_guard
SELECT count(*) = 0 FROM pragma_foreign_key_check;

PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL

/bin/chmod 600 "$DB_A"
/bin/chmod -N "$DB_A"
```

运行合同 guard 必须为 `pass`，完整性为 `ok`，外键检查无行。

## 8. Storage B：封闭观察 DDL

```zsh
sqlite_run "$DB_B" <<'SQL'
BEGIN IMMEDIATE;
-- BEGIN B DDL
CREATE TABLE observation (
    research_id TEXT NOT NULL PRIMARY KEY
        CHECK (
            length(research_id) = 32
            AND research_id NOT GLOB '*[^0-9a-f]*'
        ),
    batch INTEGER NOT NULL CHECK (batch IN (1, 2)),
    stage_1_result TEXT NOT NULL CHECK (stage_1_result IN ('completed', 'aborted', 'not-reached')),
    stage_2_result TEXT NOT NULL CHECK (stage_2_result IN ('completed', 'aborted', 'not-reached')),
    stage_3_result TEXT NOT NULL CHECK (stage_3_result IN ('completed', 'aborted', 'not-reached')),
    stage_4_result TEXT NOT NULL CHECK (stage_4_result IN ('completed', 'aborted', 'not-reached')),
    explanation_source_ok INTEGER CHECK (explanation_source_ok IS NULL OR explanation_source_ok IN (0, 1)),
    explanation_formula_ok INTEGER CHECK (explanation_formula_ok IS NULL OR explanation_formula_ok IN (0, 1)),
    explanation_evidence_state_ok INTEGER CHECK (explanation_evidence_state_ok IS NULL OR explanation_evidence_state_ok IN (0, 1)),
    explanation_uncertainty_ok INTEGER CHECK (explanation_uncertainty_ok IS NULL OR explanation_uncertainty_ok IN (0, 1)),
    value_expectation_check TEXT NOT NULL CHECK (
        value_expectation_check IN ('passed', 'not-passed', 'not-reached', 'not-observed')
    ),
    input_round TEXT NOT NULL CHECK (input_round IN ('1', '2', '3+', 'not-reached')),
    first_blocked_stage TEXT NOT NULL CHECK (
        first_blocked_stage IN ('none', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'not-reached')
    ),
    active_correction_count TEXT NOT NULL CHECK (active_correction_count IN ('0', '1', '2+', 'not-reached')),
    decision_category TEXT CHECK (
        decision_category IS NULL
        OR decision_category IN ('purchase', 'wait', 'adjust-condition', 'do-not-purchase', 'undecided')
    ),
    input_time_bucket TEXT NOT NULL CHECK (
        input_time_bucket IN ('under-5m', '5-to-under-10m', '10-to-under-20m', '20m-plus', 'not-reached', 'not-observed')
    ),
    review_result_category TEXT CHECK (
        review_result_category IS NULL
        OR review_result_category IN ('result-observed', 'feedback-only', 'no-result', 'not-reached')
    ),
    value_expectation_relation TEXT CHECK (
        value_expectation_relation IS NULL
        OR value_expectation_relation IN ('changed', 'unchanged', 'unclear')
    ),
    basis_revision TEXT CHECK (
        basis_revision IS NULL
        OR basis_revision IN ('revised', 'confirmed-no-change', 'insufficient')
    ),
    CHECK (
        (stage_1_result = 'completed' OR stage_2_result = 'not-reached')
        AND (stage_2_result = 'completed' OR stage_3_result = 'not-reached')
        AND (stage_3_result = 'completed' OR stage_4_result = 'not-reached')
    ),
    CHECK (
        (stage_1_result = 'not-reached'
            AND input_round = 'not-reached'
            AND input_time_bucket = 'not-reached'
            AND active_correction_count = 'not-reached')
        OR (stage_1_result IN ('completed', 'aborted')
            AND input_round <> 'not-reached'
            AND input_time_bucket <> 'not-reached'
            AND active_correction_count <> 'not-reached')
    ),
    CHECK (
        (first_blocked_stage = 'stage-1' AND stage_1_result = 'aborted')
        OR (first_blocked_stage = 'stage-2'
            AND stage_1_result = 'completed' AND stage_2_result = 'aborted')
        OR (first_blocked_stage = 'stage-3'
            AND stage_1_result = 'completed' AND stage_2_result = 'completed'
            AND stage_3_result = 'aborted')
        OR (first_blocked_stage = 'stage-4'
            AND stage_1_result = 'completed' AND stage_2_result = 'completed'
            AND stage_3_result = 'completed' AND stage_4_result = 'aborted')
        OR (first_blocked_stage = 'none'
            AND stage_1_result = 'completed' AND stage_2_result = 'completed'
            AND stage_3_result = 'completed' AND stage_4_result = 'completed')
        OR (first_blocked_stage = 'not-reached'
            AND stage_1_result <> 'aborted' AND stage_2_result <> 'aborted'
            AND stage_3_result <> 'aborted' AND stage_4_result <> 'aborted'
            AND 'not-reached' IN (
                stage_1_result, stage_2_result, stage_3_result, stage_4_result
            ))
    ),
    CHECK (
        (stage_4_result = 'not-reached' AND value_expectation_check = 'not-reached')
        OR (stage_4_result IN ('completed', 'aborted')
            AND value_expectation_check <> 'not-reached')
    ),
    CHECK (
        stage_1_result <> 'not-reached'
        OR review_result_category IS 'not-reached'
    ),
    CHECK (
        (stage_3_result = 'completed'
            AND explanation_source_ok IS NOT NULL
            AND explanation_formula_ok IS NOT NULL
            AND explanation_evidence_state_ok IS NOT NULL
            AND explanation_uncertainty_ok IS NOT NULL)
        OR stage_3_result = 'aborted'
        OR (stage_3_result = 'not-reached'
            AND explanation_source_ok IS NULL
            AND explanation_formula_ok IS NULL
            AND explanation_evidence_state_ok IS NULL
            AND explanation_uncertainty_ok IS NULL)
    ),
    CHECK (
        (stage_4_result = 'completed' AND decision_category IS NOT NULL)
        OR (stage_4_result IN ('aborted', 'not-reached') AND decision_category IS NULL)
    ),
    CHECK (
        (review_result_category IS NULL
            AND value_expectation_relation IS NULL
            AND basis_revision IS NULL)
        OR (review_result_category = 'not-reached'
            AND value_expectation_relation IS NULL
            AND basis_revision IS NULL)
        OR (review_result_category IN ('result-observed', 'feedback-only', 'no-result')
            AND value_expectation_relation IS NOT NULL
            AND basis_revision IS NOT NULL)
    )
) STRICT;

CREATE TABLE trust_event (
    research_id TEXT NOT NULL,
    event_code TEXT NOT NULL CHECK (event_code IN (
        'not-observed',
        'unexpected-product-data-egress',
        'unexpected-persistence-or-copy',
        'sensitive-log-or-capture',
        'evidence-state-overclaim',
        'untraceable-or-stale-result',
        'cannot-correct-exit-clear',
        'coercive-or-shaming-decision',
        'export-contract-breach',
        'boundary-explanation-confusion',
        'evidence-label-confusion',
        'input-burden-friction'
    )),
    PRIMARY KEY (research_id, event_code),
    FOREIGN KEY (research_id) REFERENCES observation(research_id)
        ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE TRIGGER trust_event_not_observed_exclusive_insert
BEFORE INSERT ON trust_event
WHEN (
    NEW.event_code = 'not-observed'
    AND EXISTS (SELECT 1 FROM trust_event WHERE research_id = NEW.research_id)
) OR (
    NEW.event_code <> 'not-observed'
    AND EXISTS (
        SELECT 1 FROM trust_event
        WHERE research_id = NEW.research_id AND event_code = 'not-observed'
    )
)
BEGIN
    SELECT RAISE(ABORT, 'not-observed must be the only trust event');
END;

CREATE TRIGGER trust_event_not_observed_exclusive_update
BEFORE UPDATE OF research_id, event_code ON trust_event
WHEN (
    NEW.event_code = 'not-observed'
    AND EXISTS (
        SELECT 1 FROM trust_event
        WHERE research_id = NEW.research_id
          AND NOT (research_id = OLD.research_id AND event_code = OLD.event_code)
    )
) OR (
    NEW.event_code <> 'not-observed'
    AND EXISTS (
        SELECT 1 FROM trust_event
        WHERE research_id = NEW.research_id
          AND event_code = 'not-observed'
          AND NOT (research_id = OLD.research_id AND event_code = OLD.event_code)
    )
)
BEGIN
    SELECT RAISE(ABORT, 'not-observed must be the only trust event');
END;
-- END B DDL
COMMIT;

INSERT INTO runtime_contract_guard
SELECT count(*) = 1 AND min(integrity_check) = 'ok'
FROM pragma_integrity_check;
INSERT INTO runtime_contract_guard
SELECT count(*) = 0 FROM pragma_foreign_key_check;

PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL

/bin/chmod 600 "$DB_B"
/bin/chmod -N "$DB_B"
test "$(/usr/bin/stat -f '%Su:%OLp' "$DB_A")" = 'alune:600' || exit 1
test "$(/usr/bin/stat -f '%Su:%OLp' "$DB_B")" = 'alune:600' || exit 1
```

运行合同和完整性预期与 A 相同。B 的 `research_id` 没有默认值，必须使用 A 已生成的同一编号。

## 9. 三条合成 fixture 与一次拒绝写入

A 先生成三条编号。到期目标用相对日期，使 `retention_until` 在执行日之前；这只是合成演练，不是研究日历。

```zsh
sqlite_run "$DB_A" <<'SQL'
BEGIN IMMEDIATE;
INSERT INTO participant (
    contact_value, materials_version,
    research_consent_state, research_consent_decided_at,
    observation_authorization_state, observation_authorization_decided_at,
    withdrawal_state, withdrawn_at, last_planned_follow_up_on
) VALUES
    ('withdraw@example.invalid', '0.2.0-synthetic', 'consented', '2026-09-01T00:00:00Z', 'authorized', '2026-09-01T00:00:05Z', 'not-withdrawn', NULL, date('now', '+30 days')),
    ('expire@example.invalid',   '0.2.0-synthetic', 'consented', '2026-09-01T00:01:00Z', 'authorized', '2026-09-01T00:01:05Z', 'not-withdrawn', NULL, date('now', '-31 days')),
    ('stop@example.invalid',     '0.2.0-synthetic', 'consented', '2026-09-01T00:02:00Z', 'authorized', '2026-09-01T00:02:05Z', 'not-withdrawn', NULL, date('now', '+30 days'));
INSERT INTO runtime_contract_guard
SELECT count(*) = 3
   AND count(DISTINCT research_id) = 3
   AND count(*) FILTER (
       WHERE length(research_id) <> 32 OR research_id GLOB '*[^0-9a-f]*'
   ) = 0
FROM participant;
COMMIT;
SELECT 'participant_rows', count(*) FROM participant;
SELECT 'bad_id_rows', count(*) FROM participant
WHERE length(research_id) <> 32 OR research_id GLOB '*[^0-9a-f]*';
SQL
```

预期分别为 `3` 和 `0`。编号只捕获到未导出的 shell 变量，不输出、不写文件：

```zsh
RID_WITHDRAW="$(sqlite_run "$DB_A" <<'SQL' | /usr/bin/grep -E '^[0-9a-f]{32}$'
SELECT research_id FROM participant WHERE contact_value='withdraw@example.invalid';
SQL
)" || exit 1
RID_EXPIRE="$(sqlite_run "$DB_A" <<'SQL' | /usr/bin/grep -E '^[0-9a-f]{32}$'
SELECT research_id FROM participant WHERE contact_value='expire@example.invalid';
SQL
)" || exit 1
RID_STOP="$(sqlite_run "$DB_A" <<'SQL' | /usr/bin/grep -E '^[0-9a-f]{32}$'
SELECT research_id FROM participant WHERE contact_value='stop@example.invalid';
SQL
)" || exit 1

for RID in "$RID_WITHDRAW" "$RID_EXPIRE" "$RID_STOP"; do
    test "${#RID}" -eq 32 || exit 1
    case "$RID" in *[!0-9a-f]*) exit 1 ;; esac
done
unset RID
```

查询中的固定 `.invalid` 值不是秘密；`grep` 只从瞬时 stdout 选取编号，研究编号没有进入 argv，而只捕获到进程内变量。随后经标准输入把已验证编号交给 B：

```zsh
sqlite_run "$DB_B" <<SQL
BEGIN IMMEDIATE;
INSERT INTO observation VALUES (
    '$RID_WITHDRAW', 2,
    'completed', 'completed', 'completed', 'completed',
    1, 1, 1, 1,
    'passed', '2', 'none', '1', 'purchase', 'under-5m',
    'feedback-only', 'unchanged', 'confirmed-no-change'
);
INSERT INTO observation VALUES (
    '$RID_EXPIRE', 2,
    'completed', 'aborted', 'not-reached', 'not-reached',
    NULL, NULL, NULL, NULL,
    'not-reached', '2', 'stage-2', '0', NULL, '5-to-under-10m',
    'not-reached', NULL, NULL
);
INSERT INTO observation VALUES (
    '$RID_STOP', 2,
    'completed', 'completed', 'completed', 'completed',
    1, 1, 1, 1,
    'passed', '1', 'none', '0', 'wait', '5-to-under-10m',
    'result-observed', 'changed', 'revised'
);
INSERT INTO trust_event VALUES ('$RID_WITHDRAW', 'input-burden-friction');
INSERT INTO trust_event VALUES ('$RID_EXPIRE', 'not-observed');
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 3
   AND (SELECT count(*) FROM trust_event) = 2
   AND (SELECT count(*) FROM observation
        WHERE review_result_category IS NULL) = 0;
COMMIT;
SELECT 'observation_rows', count(*) FROM observation;
SELECT 'trust_event_rows', count(*) FROM trust_event;
SELECT 'pending_review_rows', count(*) FROM observation
WHERE review_result_category IS NULL;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL
```

预期为 `3`、`2`、`0`、`ok`，外键检查无行。接着执行一条阶段顺序非法、必须失败并回滚的随机合成写入：

```zsh
set +e
INVALID_WRITE_OUTPUT="$(sqlite_run "$DB_B" <<'SQL' 2>&1
BEGIN IMMEDIATE;
INSERT INTO observation VALUES (
    lower(hex(randomblob(16))), 2,
    'aborted', 'completed', 'completed', 'completed',
    1, 1, 1, 1,
    'passed', '1', 'stage-1', '0', 'undecided', 'under-5m',
    'feedback-only', 'unchanged', 'confirmed-no-change'
);
COMMIT;
SQL
)"
INVALID_WRITE_STATUS=$?
set -e
test "$INVALID_WRITE_STATUS" -eq 1 || exit 1
/usr/bin/printf '%s\n' "$INVALID_WRITE_OUTPUT" |
    /usr/bin/grep -F 'CHECK constraint failed' >/dev/null || exit 1
unset INVALID_WRITE_OUTPUT INVALID_WRITE_STATUS

sqlite_run "$DB_B" <<'SQL'
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 3
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'observation_rows_after_reject', count(*) FROM observation;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL
```

预期拒绝写入后的记录数仍为 `3`，完整性为 `ok`，外键检查无行。三条记录仅用于删除范围验证；其数量不得冒充正式 `N_started`、`C_core` 或研究结论。

## 10. 撤回目标：B → 分母 readback → A

先冻结本轮写入。以下瞬时数量只验证删除范围；证据可记录 `3 → 2`，不得记录编号。

```zsh
sqlite_run "$DB_B" <<SQL
SELECT 'before_total', count(*) FROM observation;
SELECT 'before_target', count(*) FROM observation WHERE research_id='$RID_WITHDRAW';
SELECT 'before_child', count(*) FROM trust_event WHERE research_id='$RID_WITHDRAW';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 3
   AND (SELECT count(*) FROM observation WHERE research_id='$RID_WITHDRAW') = 1
   AND (SELECT count(*) FROM trust_event WHERE research_id='$RID_WITHDRAW') = 1;
SELECT 'synthetic_denominator_before', count(*) FROM observation;
BEGIN IMMEDIATE;
DELETE FROM observation WHERE research_id='$RID_WITHDRAW';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 2
   AND (SELECT count(*) FROM observation WHERE research_id='$RID_WITHDRAW') = 0
   AND (SELECT count(*) FROM trust_event WHERE research_id='$RID_WITHDRAW') = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'after_total', count(*) FROM observation;
SELECT 'after_target', count(*) FROM observation WHERE research_id='$RID_WITHDRAW';
SELECT 'after_child', count(*) FROM trust_event WHERE research_id='$RID_WITHDRAW';
SELECT 'synthetic_denominator_after', count(*) FROM observation;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL
```

预期为 `before_total=3`、`before_target=1`、`before_child=1`、分母 `3 → 2`、`after_total=2`、`after_target=0`、`after_child=0`、完整性 `ok`，外键检查无行。`synthetic_denominator_after=2` 是本轮适用的临时聚合分母重算；不得把它称为正式 `N_started` 或 `C_core`。只有 B 已通过，才删除 A：

```zsh
sqlite_run "$DB_A" <<SQL
SELECT 'before_total', count(*) FROM participant;
SELECT 'before_target', count(*) FROM participant WHERE research_id='$RID_WITHDRAW';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 3
   AND (SELECT count(*) FROM participant WHERE research_id='$RID_WITHDRAW') = 1;
BEGIN IMMEDIATE;
DELETE FROM participant WHERE research_id='$RID_WITHDRAW';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 2
   AND (SELECT count(*) FROM participant WHERE research_id='$RID_WITHDRAW') = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'after_target', count(*) FROM participant WHERE research_id='$RID_WITHDRAW';
SELECT 'after_total', count(*) FROM participant;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL
```

预期为 `before_total=3`、`before_target=1`、`after_target=0`、`after_total=2`、完整性 `ok`，外键检查无行；随后 `unset RID_WITHDRAW`。

## 11. 到期目标：B → A

本 fixture 由 A 的较早适用期限到期；假定本次合成 B 的全局结论期限更晚，不把该日期新增为逐人字段。若真实日历期限缺失或冲突，必须暂停而不是套用本 fixture。

```zsh
sqlite_run "$DB_A" <<SQL
SELECT 'eligible_expiry_target', count(*) FROM participant
WHERE research_id='$RID_EXPIRE' AND retention_until <= date('now');
INSERT INTO runtime_contract_guard
SELECT count(*) = 1 FROM participant
WHERE research_id='$RID_EXPIRE' AND retention_until <= date('now');
SQL
```

预期为 `1`，否则停止。然后按 B→A 删除：

```zsh
sqlite_run "$DB_B" <<SQL
SELECT 'before_total', count(*) FROM observation;
SELECT 'before_target', count(*) FROM observation WHERE research_id='$RID_EXPIRE';
SELECT 'before_child', count(*) FROM trust_event WHERE research_id='$RID_EXPIRE';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 2
   AND (SELECT count(*) FROM observation WHERE research_id='$RID_EXPIRE') = 1
   AND (SELECT count(*) FROM trust_event WHERE research_id='$RID_EXPIRE') = 1;
BEGIN IMMEDIATE;
DELETE FROM observation WHERE research_id='$RID_EXPIRE';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 1
   AND (SELECT count(*) FROM observation WHERE research_id='$RID_EXPIRE') = 0
   AND (SELECT count(*) FROM trust_event WHERE research_id='$RID_EXPIRE') = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'after_target', count(*) FROM observation WHERE research_id='$RID_EXPIRE';
SELECT 'after_child', count(*) FROM trust_event WHERE research_id='$RID_EXPIRE';
SELECT 'after_total', count(*) FROM observation;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL

sqlite_run "$DB_A" <<SQL
SELECT 'before_total', count(*) FROM participant;
SELECT 'before_target', count(*) FROM participant WHERE research_id='$RID_EXPIRE';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 2
   AND (SELECT count(*) FROM participant WHERE research_id='$RID_EXPIRE') = 1;
BEGIN IMMEDIATE;
DELETE FROM participant WHERE research_id='$RID_EXPIRE';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 1
   AND (SELECT count(*) FROM participant WHERE research_id='$RID_EXPIRE') = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'after_target', count(*) FROM participant WHERE research_id='$RID_EXPIRE';
SELECT 'after_total', count(*) FROM participant;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL
```

B 预期从总数 `2`、目标 `1`、子表 `1` 变为 `after_target=0`、`after_child=0`、`after_total=1`；A 预期从总数 `2`、目标 `1` 变为 `after_target=0`、`after_total=1`；完整性均为 `ok`，外键检查均无行。正常到期不反向改变已通过非识别化复核的冻结聚合；本演练不创建聚合文件。随后 `unset RID_EXPIRE`。

## 12. 研究终止、空库与 sidecar readback

终止合成研究，只删除最后的控制记录：

```zsh
sqlite_run "$DB_B" <<SQL
SELECT 'before_total', count(*) FROM observation;
SELECT 'before_target', count(*) FROM observation WHERE research_id='$RID_STOP';
SELECT 'before_child', count(*) FROM trust_event WHERE research_id='$RID_STOP';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 1
   AND (SELECT count(*) FROM observation WHERE research_id='$RID_STOP') = 1
   AND (SELECT count(*) FROM trust_event WHERE research_id='$RID_STOP') = 0;
BEGIN IMMEDIATE;
DELETE FROM observation WHERE research_id='$RID_STOP';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM observation) = 0
   AND (SELECT count(*) FROM trust_event) = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'observation_rows', count(*) FROM observation;
SELECT 'trust_event_rows', count(*) FROM trust_event;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL

sqlite_run "$DB_A" <<SQL
SELECT 'before_total', count(*) FROM participant;
SELECT 'before_target', count(*) FROM participant WHERE research_id='$RID_STOP';
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 1
   AND (SELECT count(*) FROM participant WHERE research_id='$RID_STOP') = 1;
BEGIN IMMEDIATE;
DELETE FROM participant WHERE research_id='$RID_STOP';
INSERT INTO runtime_contract_guard SELECT changes() = 1;
COMMIT;
VACUUM;
INSERT INTO runtime_contract_guard
SELECT (SELECT count(*) FROM participant) = 0
   AND (SELECT count(*) = 1 AND min(integrity_check) = 'ok'
        FROM pragma_integrity_check)
   AND (SELECT count(*) FROM pragma_foreign_key_check) = 0;
SELECT 'participant_rows', count(*) FROM participant;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SQL

unset RID_STOP
SIDECAR_OUTPUT="$(/usr/bin/find "$MOUNT_A" "$MOUNT_B" -xdev -type f \
    \( -name '*-wal' -o -name '*-shm' -o -name '*-journal' -o -name '*-mj *' \) \
    -print -quit)"
test -z "$SIDECAR_OUTPUT" || exit 1
UNEXPECTED_A="$(/usr/bin/find "$MOUNT_A" -mindepth 1 -maxdepth 1 \
    ! -name '.metadata_never_index' ! -name 'participant.sqlite3' \
    -print -quit)"
test -z "$UNEXPECTED_A" || exit 1
UNEXPECTED_B="$(/usr/bin/find "$MOUNT_B" -mindepth 1 -maxdepth 1 \
    ! -name '.metadata_never_index' ! -name 'observation.sqlite3' \
    -print -quit)"
test -z "$UNEXPECTED_B" || exit 1
unset SIDECAR_OUTPUT UNEXPECTED_A UNEXPECTED_B
/usr/sbin/diskutil apfs listSnapshots -plist "$VOLUME_A"
/usr/sbin/diskutil apfs listSnapshots -plist "$VOLUME_B"
set +e
LSOF_B_OUTPUT="$(/usr/sbin/lsof -nP +D "$MOUNT_B" 2>&1)"
LSOF_B_STATUS=$?
LSOF_A_OUTPUT="$(/usr/sbin/lsof -nP +D "$MOUNT_A" 2>&1)"
LSOF_A_STATUS=$?
set -e
test "$LSOF_B_STATUS" -eq 1 || exit 1
test "$LSOF_A_STATUS" -eq 1 || exit 1
test -z "$LSOF_B_OUTPUT" || exit 1
test -z "$LSOF_A_OUTPUT" || exit 1
unset LSOF_B_OUTPUT LSOF_A_OUTPUT LSOF_B_STATUS LSOF_A_STATUS
```

三张表计数均为 `0`，完整性为 `ok`，外键检查、sidecar、卷快照和 `lsof` 均无结果，才可继续。`lsof` 的“无输出”退出状态可为非零，本节只把无输出视为通过；出现任何输出必须停止。

## 13. 卸载、限定删除与 postflight

先确认根目录顶层只有两个镜像和两个固定挂载点：

```zsh
UNEXPECTED_ROOT="$(/usr/bin/find "$ROOT" -mindepth 1 -maxdepth 1 \
    ! -name 'A.asif' ! -name 'B.asif' ! -name '.mount-a' ! -name '.mount-b' \
    -print -quit)"
test -z "$UNEXPECTED_ROOT" || exit 1
unset UNEXPECTED_ROOT

/usr/sbin/diskutil eject "$DISK_B"
/usr/sbin/diskutil eject "$DISK_A"
MOUNT_OUTPUT="$(/sbin/mount)"
case "$MOUNT_OUTPUT" in *"$ROOT"*) exit 1 ;; esac
unset MOUNT_OUTPUT
MOUNT_A_CONTENT="$(/usr/bin/find "$MOUNT_A" -mindepth 1 -maxdepth 1 -print -quit)"
MOUNT_B_CONTENT="$(/usr/bin/find "$MOUNT_B" -mindepth 1 -maxdepth 1 -print -quit)"
test -z "$MOUNT_A_CONTENT" || exit 1
test -z "$MOUNT_B_CONTENT" || exit 1
unset MOUNT_A_CONTENT MOUNT_B_CONTENT

test -f "$B_IMAGE" || exit 1
test -f "$A_IMAGE" || exit 1
test ! -L "$B_IMAGE" || exit 1
test ! -L "$A_IMAGE" || exit 1
test "$(/bin/realpath "$B_IMAGE")" = "$B_IMAGE" || exit 1
test "$(/bin/realpath "$A_IMAGE")" = "$A_IMAGE" || exit 1
/bin/unlink "$B_IMAGE"
/bin/unlink "$A_IMAGE"
test ! -e "$B_IMAGE" || exit 1
test ! -e "$A_IMAGE" || exit 1
test -d '/Users/alune/.Trash' || exit 1
test ! -L '/Users/alune/.Trash' || exit 1
TRASH_MATCH="$(/usr/bin/find '/Users/alune/.Trash' -xdev -mindepth 1 \
    \( -name 'A.asif*' -o -name 'B.asif*' -o -name 'RESEARCH-0001' \) \
    -print -quit)"
test -z "$TRASH_MATCH" || exit 1
unset TRASH_MATCH
```

Trash 必须无匹配项。根目录仍存在且为空数据时，重新执行第 4 节的 Time Machine、Data 卷快照、File Provider、后台项、进程、远程服务和共享 readback；结果必须仍与 preflight 一致。随后只删除已确认为空的固定目录：

```zsh
test "$(/usr/bin/tmutil isexcluded -X "$ROOT" | /usr/bin/plutil -extract 0.IsExcluded raw -)" = '1' || exit 1
/bin/rmdir "$MOUNT_B"
/bin/rmdir "$MOUNT_A"
/bin/rmdir "$ROOT"
test ! -e "$ROOT" || exit 1
unset DB_A DB_B MOUNT_A MOUNT_B A_IMAGE B_IMAGE ROOT RESEARCH_PARENT BASE
unset DISK_A DISK_B VOLUME_A VOLUME_B
unset SQLITE_PROLOGUE
unfunction sqlite_run
```

本流程不移除固定路径 Time Machine 排除；它不含数据，并确保同一路径未来被误建时仍默认排除。只有全部 postflight 通过后，Alune 才物理销毁两张密码纸，并只记录日期和 `pass/fail`。

## 14. 证据与允许声明

实际获批演练后，只新建一份 `evidence/research/ac-18-storage-readback-YYYY-MM-DD.md`，且只保存：

- `synthetic-only=true`、执行日期、macOS 和 `/usr/bin/sqlite3` 版本；
- ASIF/APFS/AES-256、实际固定路径、owner/mode/ACL、no-browse、Spotlight 的脱敏结论；
- Time Machine、APFS 快照、File Provider/同步/备份枚举的可运行性、项目数量、覆盖判断和限制；
- schema/非法写入、三次 B→A 删除、目标/子表/总数、完整性、外键、sidecar、挂载、Trash 和镜像不存在的 readback；
- 纸质密码已销毁的日期与结果；不得记录密码、编号、联系方式、数据库页、设备标识、provider 原始清单或完整 transcript。

最终最多声明：

> 在指定 macOS 主机、指定时间、已枚举的 A/B 容器路径及已检查的 SQLite、快照、同步与 Trash 边界内，逻辑删除已验证。

不得声明 SSD 法证擦除，也不覆盖 RAM、swap、系统缓存、系统 `root`、恶意软件、未知代理或未枚举副本。任何检查未通过时，证据状态必须是 `not-proven`，不得勾选 AC-18。
