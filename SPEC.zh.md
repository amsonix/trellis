# Trellis 规范（中文参考）

> **本文件是参考译本，英文版 [`SPEC.md`](SPEC.md) 是唯一权威。**
> 如果两者冲突，以英文版为准，并按 bug 处理。本译本省略了示例与部分论证，
> 保留每条规则的约束。

**状态：** 草案，0.2.x。
**范围：** 面向 agent（或 agent 与人的混合团队）的项目构建协议：阶段、产物、
门禁、角色、任务与证据。

参考实现在 `src/`，机器可读子集在 `schema/`。

---

## 1. 目的

agent 会写代码；难的是知道**建什么、按什么顺序、拿什么证明、什么时候停下来问人**。
协议把这五个问题显式化、可检查：

| 问题 | 答案 |
|---|---|
| 我在哪 | `Project.stage` |
| 现在必须存在什么 | `Profile.requiredArtifacts[stage]` |
| 完成是什么意思 | `Acceptance` + `Verification` + `Evidence` + `Gate` |
| 我可以写哪里 | `Role` + `Task.scope` + `Mandate` |
| 下一步做什么、谁批准 | `next` + `Gate.approvers` |

## 2. 非目标

- 替代代码评审、CI 或人的产品决策；
- 跨机器调度任意 DAG；
- 生成架构内容或文字；
- 充当安全边界（guard 是提交时检查，人可以手改文件）。

## 3. 事实来源

1. 固定的 `<project>/.trellis/` 保存产物；其中的 Markdown 是事实来源。
2. 同一目录保存账本：`state.json`、`evidence.jsonl`、`leases.json`、
   `leases.archive.jsonl`、`audit.jsonl`。`reindex` 可从产物重建 state。
3. 任务是 `.trellis/docs/TASKS.md` 中的一行；租约是独立记录。
4. gate 是审批事件，记在 state 里，不是文件。
5. `init` 可跑在已有项目上：创建 `.trellis/`（以及一次性的
   `.agents/skills/trellis/SKILL.md`），从不覆盖已有文件，并拒绝非空的
   `.trellis/`。

## 4. 阶段

```text
intake → discovery → architecture → plan → ready → executing → integrating → releasing → maintained
```

## 5. 门禁

| Gate | 阶段 | 批准者 | 必需产物 |
|---|---|---|---|
| G0 Scope | intake | human | PROJECT |
| G1 Research | discovery | architect, human | RESEARCH |
| G2 Architecture | architecture | architect, human | ARCHITECTURE + ADR |
| G3 Plan | plan | human | ROADMAP, TASKS, VERIFICATION |
| G4 Ready | ready | coordinator, human | 任务图 |
| G5 Task review | executing | reviewer | 该任务的证据 |
| G6 Integration | integrating | verifier, human | 全部任务 done |
| G7 Release | releasing | human, operator | OPERATIONS |

规则：

1. 项目 gate 必须按 `G0, G1, G2, G3, G4, G6, G7` 顺序批准；G5 按任务，
   但要求 G4 已通过。
2. 批准者角色必须在 gate 的批准者列表中。
3. 有阻断检查时拒绝批准，检查结果在错误详情里。
4. 只有 human 能豁免（waive），必须写理由并记入审计。
5. 已通过的 gate 不能重复批准——除非它已 stale。
6. 批准时记录依赖产物的摘要（G2 含 `docs/adr/*.md`）。
7. 产物变化后 gate 变 **stale**：`check` 报 `GATE_STALE`，后续 gate 被拒，
   必须重新批准；重批按 gate 顺序进行，更早的 stale gate 会阻塞更晚的，反之不成立。摘要对空白/换行不敏感。
8. TASKS 摘要只含结构（id、里程碑、角色、写域、依赖、验收、验证），不含
   status——claim/done 不会让规划 gate 失效。

## 6. 产物

每份产物以 YAML front-matter 开头（id、project、stage、status、owners、
version、created），正文用二级标题组织。必需章节见英文版表格。

特殊检查：PROJECT.Acceptance 至少一条；ARCHITECTURE.Context 至少一个 Mermaid
（warning）；Containers 表需含 Container/Responsibility/Interface 列；
`docs/adr/` 至少一个 ADR（warning）。

## 7. 任务

表头：`| ID | Milestone | Title | Role | Scope | Depends on | Acceptance | Verification | Status | Priority |`

1. ID 唯一，形如 `T-001`。
2. Milestone 必须匹配 ROADMAP 中的 `## M...`。
3. Role 属于 human/coordinator/architect/executor/reviewer/verifier/operator。
4. Status 属于 todo/ready/in_progress/review/blocked/done。
5. Scope 是逗号分隔的路径前缀；`-` 不允许。
6. Depends on 是任务 id 列表或 `-`。
7. Acceptance 说明什么必须为真；Verification 说明怎么检查。
8. 依赖图必须无环。
9. 可并发运行的任务不能共享写域，除非有依赖。
10. Priority 为 `high`/`medium`/`low`；缺少整列或单元格时按 `medium` 处理。
11. `next` 先按 priority（高→中→低）排序，再按 id 排序。
12. done 需要至少一条 pass 证据且没有 fail；inconclusive 不算通过。
13. 新工作用 `task add` 加入：校验第 1–9 条后追加，记录 `task.added`。
14. 跟进（`--follow-up-of`）：继承父里程碑、写域在父范围内、依赖父任务、
    每父最多 3 个、最多 2 层；不使 G3/G4 失效，而是刷新摘要并记
    `task.followUp`。
15. 问题（`task ask`）：任务置 blocked 并记录原状态；只有 human 能
    `task answer`；回答后恢复原状态；未答问题出现在 `next` 与 `report`。
16. `scope suggest` 读取消息中出现该任务 id（完整 token，不是子串）的提交，
    在其当前写域内给出文件级建议；
    只有 `--apply --by <role>:<name>` 才会写回，且只允许收窄。

状态转移：

```text
todo → in_progress | blocked
ready → in_progress | blocked
in_progress → review | blocked | done
review → done | blocked
blocked → in_progress | review | done
done → 终态

`in_progress` 但没有租约的任务可以被接管：`task claim` 会接管，记录
`task.taken_over`，不改状态；`task recover --by human|coordinator --reason ...`
把它退回 `ready` 或 `todo`（记录 `task.recovered`）；`TRELLIS_NO_TAKEOVER=1`
关闭接管。
```

## 8. 证据

```json
{ "id": "EV-...", "taskId": "T-001", "kind": "test", "uri": "path|url|commit",
  "sha256": "...", "verdict": "pass|fail|inconclusive",
  "producedBy": "verifier:ci", "producedAt": "...", "note": "...", "agent": "..." }
```

- 存在 `.trellis/evidence.jsonl`，是 append-only 事件日志（add / retract）；
  可选 `proves` 字段写明这条证据要证明验收条件里的哪一句。日志中间行损坏
  视为错误；只有末尾没有换行符的半行可以按崩溃写入忽略。
- 本地文件在写入时计算 sha256；文件变化需要新证据。
- done 需要 pass 且没有 fail；inconclusive 不是 pass。
- 证据可以由 human/reviewer/verifier 带理由撤回；记录保留、不再计数；
  产出者不能撤回自己的失败。

## 9. 角色

| 角色 | 拥有 | 批准 | 不得 |
|---|---|---|---|
| Coordinator | 项目状态、任务图 | G4 | 写产品代码 |
| Architect | 架构、ADR、路线图 | G1, G2 | 写产品代码 |
| Executor | 任务写域内的代码/测试 | — | 批自己的 gate、改架构 |
| Reviewer | 评审意见 | G5 | 改进评审对象 |
| Verifier | 证据 | G5, G6 | 改被测代码 |
| Operator | 运维、部署 | G7 | 写产品代码 |

`--by role:name` 是自称；`TRELLIS_AGENT` 只做进程归因，不是凭据。

## 10. 命令与退出码

CLI 是参考集成面。JSON 信封：`{ok,command,data}` 或 `{ok:false,command,error}`。
退出码：`0` 成功；`2` 用法错误；`3` 拒绝/检查失败/gate 阻塞；`4` 不可用。

写命令持有 `.trellis/.lock`，JSON 账本经临时文件重命名写入；超过 10 秒的锁
视为陈旧。

`next` 是循环契约：`kind=tasks` 且 `needsUser=false` 时可无人执行；
gate/评审/失效批准/阻塞/检查失败时 `needsUser=true` 并给 `reason`。

## 11. 检查与严重度

`pass` / `warn` / `fail` / `unavailable`。只有 fail 与 unavailable 阻断；
`check` 与 `status` 不写。

## 12. 租约

活跃租约在 `.trellis/leases.json`；释放后移入 `leases.archive.jsonl`。

- `task claim` 按任务写域取租约，冲突则拒绝；
- `task report --state done` 释放租约；
- `guard commit` 检查暂存路径（或显式 `--paths a,b`，避免并行 lane 共用 index）
  是否在写域内、是否被其他任务租用；
- `--observe` 只报告不阻断；
- 租约是建议性的，不是内核锁，也不是安全边界。

## 13. Profile

`generic`（默认）、`web-app`、`library`、`cli`。Profile 决定哪些产物必需。

## 14. 不变量

1. 没有 pass 证据就没有 done。
2. 没有角色能批准自己产出的工作。
3. 两个并发任务不能共享写域，除非有依赖。
4. gate 不能乱序批准。
5. `unavailable` 永远不算通过。
6. 每个写命令都追加审计。
7. `check` 与 `status` 不改状态。

## 15. 实现状态

已实现到 `0.2.x`：init、profile、产物检查、任务与 `task add`、受控跟进、
问题、gate 与失效摘要、证据与撤回、租约与归档、`guard commit`、`status`/
`check`/`next`/`brief`/`report`/`compact`/`reindex`、写锁、审计流、
`TRELLIS_AGENT`、MCP server。

尚未实现：measurement guard、文件级写保护、DSH 专用插件、SQLite/HTTP/多主机、
策略版本化与租约重验、图表渲染与链接检查、从路线图自动生成任务。

## 16. 版本

- `PROTOCOL_VERSION` 在 `src/core/constants.mjs`。
- state 里有 `SCHEMA_VERSION`，更新版本会被拒绝加载。
- `--json` 是契约：新增字段算 minor，删除/改名算 major。
- 模板随包版本走；项目保留自己的副本，升级包不会重写项目。
