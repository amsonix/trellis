# Trellis

[English](README.md) | **中文**

[![CI](https://github.com/amsonix/trellis/actions/workflows/ci.yml/badge.svg)](https://github.com/amsonix/trellis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**面向 agent 的项目构建协议。**

它不教 agent 怎么写代码，而是在每一步告诉它：

1. **这个项目处于哪个阶段？**
2. **现在必须存在哪份产物？**
3. **「完成」指什么，用什么证据证明？**
4. **这个角色可以写哪些路径？**
5. **下一步做什么，由谁批准？**

协议本身是一个小而零依赖的 Node.js 库与 CLI，所有内容放在项目里的一个固定目录：

```text
<project>/.trellis/
```

其中的 Markdown 产物是事实来源；`state.json`、`evidence.json` 和
`leases.json` 是账本。`init` 可以跑在已有项目上：它创建 `.trellis/`，并一次性写入
agent skill 到 `.agents/skills/trellis/SKILL.md`。它从不覆盖已存在的文件。

```text
intake → discovery → architecture → plan → ready → executing → integrating → releasing → maintained
```

> 规范文档 [`SPEC.md`](SPEC.md) 为英文，并以英文版为唯一权威。

---

## 快速开始

需要 Node.js 20 或更新版本，没有运行时依赖。

```bash
git clone https://github.com/amsonix/trellis.git
cd trellis
npm test

# 创建项目的管理目录（新项目或已有项目）
node bin/trellis.mjs init /tmp/demo

# 可选：选择 profile 或显示名
node bin/trellis.mjs init /tmp/demo --profile web-app --name demo

# 查看状态
node bin/trellis.mjs status --dir /tmp/demo
node bin/trellis.mjs check --dir /tmp/demo
node bin/trellis.mjs next --dir /tmp/demo --role architect

# 批准第一个 gate（由人执行，不是执行者）
node bin/trellis.mjs gate G0 --approve --by human:alice --dir /tmp/demo
```

或者把命令安装到本地：

```bash
npm link
trellis --help
```

---

## 它会创建什么

```text
<project>/.trellis/
  PROJECT.md                   问题、用户、范围、非目标、约束、验收标准
  README.md                    协议根的快速开始
  docs/RESEARCH.md             问题、先行实践、未知项、风险
  docs/ARCHITECTURE.md         上下文、容器、组件、数据、接口、故障、安全、部署、可观测性、待定问题
  docs/ROADMAP.md              里程碑，每个都有退出条件
  docs/TASKS.md                任务表：写域、依赖、验收、验证
  docs/VERIFICATION.md         策略、判定基准、夹具、证据
  docs/OPERATIONS.md           部署、回滚、监控、运行手册
  docs/GLOSSARY.md             术语
  docs/INVARIANTS.md           绝不能破坏的东西
  docs/adr/0001-....md         第一个架构决策
  state.json                   gate 账本与审计
  evidence.json                证据账本
  leases.json                  写租约（执行时的约束）
```

profile 决定哪些产物是必需的。它**可选**，默认是 `generic`。

它还会在 `.trellis/` 之外一次性写入 `.agents/skills/trellis/SKILL.md`：这就是告诉
agent 运行时如何操作本项目的 skill（见 [Agent skill](#agent-skill)）。

| Profile | 用途 | 必需产物 |
|---|---|---|
| `generic` | 任意项目（默认） | `PROJECT`、`ARCHITECTURE`、`ROADMAP`、`TASKS`、`VERIFICATION` |
| `web-app` | 面向用户的应用 | 以上全部，加上 `OPERATIONS` 和 `RESEARCH` |
| `library` | 可复用的包 / SDK | 核心五项加 `RESEARCH`；`OPERATIONS` 可选 |
| `cli` | 命令行工具 | 核心五项加 `RESEARCH`；`OPERATIONS` 可选 |

`--name` 也是可选的，默认取项目目录名。

---

## Agent skill

`init` 会把 skill 写到 `.agents/skills/trellis/SKILL.md`。读取 `.agents/skills/` 约定的
运行时（DSH 就是其中之一）会在打开项目时自动加载它，于是 agent 从 `status` 和
`next` 出发，而不是靠猜当前阶段。

skill 里是真正要紧的规则：先 claim 任务再写它的写域；`done` 报告之前先记录通过
证据；卡住时只问一个问题；绝不为自己的产出批准 gate。同样的 brief 也可以直接从
CLI 打印：`trellis brief --role <role>`。

要让它对所有项目可用，可以装到用户级目录：

```bash
mkdir -p ~/.agents/skills
cp -R skills/trellis ~/.agents/skills/trellis
```

---

## MCP 服务

`bin/trellis-mcp.mjs` 是一个零依赖的 stdio MCP 服务。默认只暴露读工具：
`trellis_status`、`trellis_check`、`trellis_next`、`trellis_brief`、
`trellis_report`、`trellis_task_list`、`trellis_evidence_list`、`trellis_verify`、
`trellis_lease_status`、`trellis_profile_list`。

设置 `TRELLIS_MCP_WRITE=1` 后额外暴露写工具：`trellis_init`、
`trellis_task_add`、`trellis_task_ask`、`trellis_task_answer`、
`trellis_task_claim`、`trellis_task_report`、`trellis_evidence_add`、
`trellis_evidence_retract`、`trellis_lease_release`、`trellis_reindex`。

gate 批准**故意不暴露**：批准者不能是产出这项工作的角色，这个决定留在 CLI 里。

DSH 配置：

```yaml
- id: mcp-trellis
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: trellis
    transport: stdio
    command: node
    args: ['/absolute/path/to/trellis/bin/trellis-mcp.mjs']
    env:
      TRELLIS_MCP_WRITE: '1'
```

项目目录依次取工具参数、`TRELLIS_DIR`、当前目录。

---

## 循环

`trellis next` 就是循环契约。它要么返回一批可以直接执行的任务，要么返回一个带原因
的停止：

```json
{ "kind": "tasks", "tasks": [ ... ], "needsUser": false, "reason": null }
{ "kind": "gate",  "gate": { ... }, "needsUser": true,  "reason": "gate G3 (Plan) needs approval" }
```

运行时循环：执行 `tasks` 批次 → 每个任务 claim → 记录证据 → `report --state done`
→ 再调 `next`。只有 `needsUser` 为 true 时才停——gate 审批、任务评审、失效的批准、
被阻塞的任务或失败的检查。就绪的工作不等任何人，需要决策的才等。

写入通过 `.trellis/.lock` 串行：两个 Agent 同时 claim、记证据或提问时会排队，
而不是互相覆盖。超过 10 秒的锁视为陈旧，会被接管。

---

## 生命周期

| Gate | 阶段 | 批准者 | 含义 |
|---|---|---|---|
| **G0 Scope** | intake | human | 问题、用户、范围、非目标、约束、验收标准都已显式写出 |
| **G1 Research** | discovery | architect、human | 先行实践、未知项和风险已写下并有人负责 |
| **G2 Architecture** | architecture | architect、human | 上下文、容器、组件、数据、接口、故障、安全、部署、可观测性 |
| **G3 Plan** | plan | human | 每个里程碑都有退出条件；每个任务都有验收与验证 |
| **G4 Ready** | ready | coordinator、human | 任务图无环；并发任务不共享写域 |
| **G5 Task review** | executing | reviewer | 只有通过证据支撑其验收，任务才算完成 |
| **G6 Integration** | integrating | verifier、human | 所有任务完成并通过验证 |
| **G7 Release** | releasing | human、operator | 部署、回滚、监控和运行手册都已写下 |

gate 只能由 **人类豁免（waive）**，且必须给出理由，豁免会记入审计日志。

批准时会记录该 gate 所依赖产物的摘要。之后如果这些产物变了——`PROJECT.md`、
`ROADMAP.md`、任务结构、ADR——gate 就变成 **stale**：`check` 报 `GATE_STALE`，
后续 gate 被拒绝，`status` 标记为 `STALE`，直到重新批准。任务状态变化和纯空白
编辑不会让 gate 失效；新增或改动任务、新增 ADR 会。

---

## 命令

```text
trellis init [project-dir] [--profile <generic|web-app|library|cli>] [--name <name>]
trellis status [dir] [--json]
trellis check [dir] [--stage <stage>] [--json]
trellis next [dir] [--role <role>] [--json]
trellis brief [dir] [--role <role>] [--json]
trellis report [dir] [--json]

trellis gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
trellis gate <G0..G7> --waive   --by human:<name> --reason <text> [--task <T-NNN>]

trellis task list [dir] [--json]
trellis task add --title <text> --scope <paths> --acceptance <text> --verification <text> \
                 [--role <role>] [--milestone <M0>] [--depends-on <T-NNN>] \
                 [--follow-up-of <T-NNN>] --by <role>:<name>
trellis task claim <T-NNN> --by <role>:<name> [--dir <dir>]
trellis task ask <T-NNN> --question <text> --by <role>:<name>
trellis task answer <Q-NNN> --decision <text> --by human:<name>
trellis task report <T-NNN> --state <todo|ready|in_progress|review|blocked|done> [--note <text>] [--by <role>:<name>]

trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> \
                              --verdict <pass|fail|inconclusive> --by <role>:<name>
trellis evidence retract <EV-id> --by <role>:<name> --reason <text>
trellis evidence list [--task <T-NNN>] [--json]
trellis verify <T-NNN> [--json]

trellis lease status [--json]
trellis lease release <T-NNN> --by <role>:<name>
trellis guard commit --task <T-NNN> --staged [--observe] [--dir <dir>]
trellis reindex [dir] [--json]
trellis profile list [--json]
```

`trellis report` 回答「项目到哪一步了、卡在哪」：gate 与任务计数、按里程碑从任务板
派生出的进度、阻塞检查、被阻塞的任务、标了 done 却没有通过证据的任务，以及超过
24 小时的租约。

新需求或 bug 反馈通过 `trellis task add` 进入任务板：它先校验 milestone、角色、
验收标准、验证方式和写域重叠，再把行追加到 `.trellis/docs/TASKS.md`，并在审计里
记一条 `task.added`。如果和未完成任务写域重叠，用 `--depends-on` 声明依赖，而
不是扩大自己的 scope。

失败证据可以由 human、reviewer 或 verifier 带理由撤回：`evidence retract <EV-id>
--reason "..."`。记录仍留在 `evidence.json` 里并标为 `retracted`，但不再阻塞
`done`，所以 bug 流程是真实的：先记录失败的复现，修好后撤回失败证据，再补一条
通过证据。产出者角色不能撤回自己的失败。

执行过程中发现的工作可以让循环继续跑：`task add --follow-up-of T-NNN` 会继承父
任务的 milestone，写域必须在父任务范围内，自动依赖父任务，并且**不**重开 G3/G4。
每个任务最多派生 3 个跟进、最深 2 层；超出则和普通新任务一样让规划 gate 失效，
交由人决策。

决策以「问题」的形式向上走：`task ask` 把任务置为阻塞并记录问题，`next`/`report`
会以 `needsUser` 呈现，只有 human 能 `task answer`。回答后任务回到提问前的状态。

退出码是约定的一部分：

| 退出码 | 含义 |
|---|---|
| `0` | 成功；检查通过；gate 已批准 |
| `2` | 用法错误 |
| `3` | 被拒绝；检查失败；gate 被阻塞；证据缺失 |
| `4` | 不可用；状态缺失、产物不可读、git 失败 |

`--json` 返回稳定的信封：

```json
{ "ok": true, "command": "check", "data": { "checks": [], "summary": {} } }
{ "ok": false, "command": "gate", "error": { "code": "GATE_BLOCKED", "message": "...", "details": {} } }
```

---

## 设计原则

1. **固定的 `.trellis/` 目录是事实来源。** 其中的产物是提交进仓库的 Markdown；
   JSON 账本只是索引与审计记录，`reindex` 可以重建。
2. **核心不含 LLM。** 协议校验结构、角色、任务和证据；内容由模型或人来写，协议只负责检查。
3. **证据优先于声明。** 没有通过证据时，`task report --state done` 会被拒绝；
   `inconclusive` 不算通过。
4. **不允许自批。** gate 的批准角色不能是产出这项工作的角色。
5. **写域是显式的。** `task claim` 获取任务写域上的租约；`guard commit --staged`
   拒绝写域之外或被其他任务租用的路径；`--observe` 只记录它本会拦截什么，不拦截。
6. **概念要少。** Ticket、mandate、assignment、report、evidence、gate。没有看板、
   没有调度器、没有数据库服务器。
7. **gate 必须能够失败。** 每个检查在 `test/` 里都有负向对照；不能失败的检查不算检查。

---

## 这不是什么

- 不是项目管理器，也不是甘特图。
- 不是任务调度器，也不是 DAG 执行器。
- 不是模型，也不是提示词库。
- 不是多用户服务器（账本是本地的；只有单写者设计经过验证后才考虑共享存储）。
- 不替代代码评审、CI 或人的产品决策。

---

## 开发

```bash
npm test              # node:test，无依赖
node --test test/     # 同上
npm run coverage      # 测试 + CI 强制的覆盖率门槛
```

目录结构：

```text
src/core/     纯领域：产物、任务、gate、证据、租约、存储
src/index.mjs 公共库入口（导入这个，不要深路径）
src/cli.mjs   参数解析、人类可读输出、JSON 信封
src/mcp/      stdio MCP 服务
templates/    `init` 写入的文件
skills/       `init` 写入项目的 agent skill
schema/       state、task、evidence、profile 的 JSON Schema
test/         node:test 测试与夹具
```

协议规范见 [`SPEC.md`](SPEC.md)；在本仓库上工作的 agent 遵循的规则见
[`AGENTS.md`](AGENTS.md)。

欢迎贡献，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。Issue 与 PR 在
<https://github.com/amsonix/trellis>。

---

## 致谢

Trellis 的阶段与 gate 模型参考了 DeepSeek 的 Super Agent。本项目是独立实现：
仓库中不含该项目的代码，运行时也不依赖它。

---

## 许可证

MIT，见 [`LICENSE`](LICENSE)。
