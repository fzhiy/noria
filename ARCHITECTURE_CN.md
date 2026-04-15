# NORIA 知识库 — 架构文档

> 中文版架构文档。English version: ARCHITECTURE.md

> 最后更新：2026-04-10。历史审阅记录：`outputs/reviews/`

## 愿景

NORIA 是一个面向 CS/AI 研究人员的**以 Agent 为核心、以 CLI 为优先的学术研究知识服务**。

**核心目标**：
- 以最低 Token 成本提供可靠的知识检索与问答
- 通过知识飞轮加速研究进程（反馈 → 缺口发现 → 扩展 → 更好的检索）
- 以 Obsidian 作为人类友好的可视化前端（MOC + Canvas + Dataview）
- 作为研究项目的 MCP 知识服务，接受反馈持续改进知识库
- 快速提炼研究主题：论文 → 概念 → 综合 → 可引用的结构化知识

**设计原则**：
- **溯源优先**：每一条断言均携带信任级别，引用精确到章节层级
- **Token 高效**：渐进式阅读 + 实时预筛 + 清单门控编译
- **人工把关**：自动发现，人工审批扩展——防止知识污染
- **精简 CLAUDE.md**：Agent 指令不超过 80 行；完整 schema 位于 `schema.md`

本项目在 [Karpathy llm-wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 基础上扩展，新增 5 级信任层级、多模型对抗式审阅、渐进式 PDF 阅读以及双轨信息架构。

## 三层架构

```
原始来源（用户拥有）  →  LLM 引擎（Claude Code）  →  Wiki（LLM 维护）
                                                   →  检索层（QMD MCP）
```

### 第一层：原始来源（用户拥有，LLM 只读）

| 目录 | 来源 | 编译时溯源 |
|---|---|---|
| `raw/zotero/papers/` | 从 Zotero 自动同步 | `source-derived` |
| `raw/arxiv/` | arXiv API 搜索结果 | `source-derived` |
| `raw/semantic-scholar/` | Semantic Scholar API | `source-derived` |
| `raw/twitter/` | Twitter/X 帖子（经质量过滤） | `social-lead` |
| `raw/wechat/` | 微信文章（经质量过滤） | `social-lead` |
| `raw/github/` | GitHub 仓库、发行版 | `social-lead`（例外：论文官方代码库 → `source-derived`） |
| `raw/notes/` | 人工 / Claude 分析笔记 | `llm-derived` |

### 第二层：Wiki 知识（LLM 维护，用户验证）

| 目录 / 文件 | 内容 | 数量（当前） |
|---|---|---|
| `wiki/sources/` | 每个已摄入来源的一份摘要 | **129** 页 |
| `wiki/concepts/` | 含 Wikilink 的主题概念文章 | **32** 页 |
| `wiki/synthesis/` | 跨主题综合文章（仅通过 lint 后生成） | **7** 页 |
| `wiki/archive/` | 已废弃 / 被撤回的页面 | — |
| `wiki/index.md` | 供粗粒度路由使用的主索引 | 1 |
| `wiki/dashboard.md` | Dataview 仪表盘（5 个查询） | 1 |
| `wiki/moc-*.md` | 内容地图（agent、peft、benchmark、adaptation、safety） | 5 |
| `wiki/*.canvas` | Obsidian Canvas 知识图谱 | 3 |

实体类型（作者、方法、数据集、场馆、基准）均以**前置元数据标签**表示，而非独立目录。

### 第三层：Schema 与指令

| 文件 | 用途 | 加载时机 |
|---|---|---|
| `CLAUDE.md` | 精简 Agent 指令（约 71 行） | 每次请求时自动加载 |
| `schema.md` | 完整 Wiki schema、溯源规则、页面格式 | 由技能按需加载 |
| `AGENTS.md` | Codex/GPT Agent 指令 | 由 Codex CLI 自动加载 |

## 溯源模型

5 级信任层级（完整规则见 `schema.md`）：

| 级别 | 信任度 | 可支撑综合文章？ |
|---|---|---|
| `user-verified`（用户验证） | 最高 | 是 |
| `source-derived`（来源衍生） | 高 | 是 |
| `llm-derived`（LLM 衍生） | 中 | 是（须引用 ≥2 个来源） |
| `social-lead`（社交线索） | 低 | **否** — 仅作为发现线索 |
| `query-derived`（查询衍生） | 最低 | **否** — 仅存于 `outputs/` |

**硬性规则**：`query-derived` 内容绝不进入 `wiki/`。综合文章须引用 ≥2 条 `source-derived` 引文。

## 双轨信息架构

| 轨道 | 来源 | 溯源 | 可修改概念页？ |
|---|---|---|---|
| **Track A**（社交线索） | Twitter、GitHub、微信、Web | `social-lead` | 否 |
| **Track B**（学术研究） | arXiv、Semantic Scholar、Zotero | `source-derived` | 是 |

Track A 负责发现线索，Track B 负责提供证据。Track A→B 晋升通过 `tools/track-promote.ts` 显式执行，从不自动触发。

## 操作流水线

### Token 高效执行模式

每个流水线步骤均遵循渐进式阅读模式：

```
1. noria-reader --exists  （去重检查，约 10 tokens）
2. noria-reader --brief   （实时相关性预筛，约 200 tokens）
3. noria-reader --head    （章节结构，约 800 tokens）
4. noria-reader --section （定向阅读，长度可变）
5. 全文阅读仅在必要时使用     （最后手段）
```

### 第一阶段 — 摄入与编译（已运行）

| 顺序 | 命令 | 功能说明 | 关键细节 |
|---|---|---|---|
| 1 | `/kb-sync` | Zotero/arXiv/S2/Twitter/微信/GitHub → raw/ | 多平台，相关性过滤 |
| 2 | `/kb-ingest` | 将 URL / 笔记 / PDF 暂存至 raw/ | 手动暂存 |
| 3 | `/kb-compile` | raw/ → wiki/sources/ + concepts/ + index.md | 清单门控，幂等操作 |
| 4 | `/kb-lint` | 对 wiki/ 执行 7 项健康检查 | **强制**在综合前执行（钩子强制） |
| 5 | `/kb-ask` | 查询 → 综合答案 → outputs/ | 查询衍生，绝不进入 wiki/ |

### 第二阶段 — 智能分析（已运行）

| 顺序 | 命令 | 功能说明 |
|---|---|---|
| 6 | `/kb-reflect` | 跨主题综合（须通过 lint） |
| 7 | `/kb-deepen` | 读取本地 PDF，深入摘要级别以上 |
| 8 | `/research-lit` | 多源文献综述（知识库 + arXiv + S2 + Web） |
| 9 | `/kb-trending` | 通过 DeepXiv 社交信号发现趋势论文 |

### 第三阶段 — 服务（已运行）

| 组件 | 实现方式 | 状态 |
|---|---|---|
| 远程 MCP 服务器 | `tools/noria-mcp-server.py`（SSH 隧道） | 已运行 |
| 主题包 | `tools/kb-topic-bundle.ts`（外部项目查询） | 已运行 |
| Obsidian Vault | Wikilink 管道语法、Canvas、Dataview | 已运行 |
| 反馈循环 | `submit_feedback` → 分诊 → 人工审阅 | 部分实现（无持久化信号索引） |
| HTTP API | 延后 | 未启动 |

### 全部 18 个斜线命令（Claude Code 技能）

这些是位于 `.claude/commands/` 下的 Claude Code 技能文件，按需加载（不在 CLAUDE.md 中）：

`agent-team-plan`、`gpt-nightmare-review`、`kb-ask`、`kb-compile`、`kb-deepen`、`kb-import`、`kb-ingest`、`kb-lint`、`kb-merge`、`kb-output`、`kb-reflect`、`kb-sync`、`kb-trending`、`mermaid-diagram`、`meta-optimize`、`research-lit`、`research-review`、`wiki-help`

## 工具清单（27 个文件）

### 读取器（Token 高效，渐进式）
| 工具 | 用途 |
|---|---|
| `noria-reader.ts` | 本地渐进式读取器（7 种模式：brief/head/section/triage/search/budget/exists） |
| `deepxiv-reader.ts` | 云端读取器（290 万篇 arXiv 论文，零 LLM 成本，API 限额 10K/天） |

### 搜索与摄入
| 工具 | 用途 |
|---|---|
| `arxiv-search.ts` | arXiv API 搜索 |
| `semantic-scholar-search.ts` | S2 Graph API（场馆论文、引用、相关文献） |
| `github-search.ts` | GitHub 仓库、发行版、标签搜索 |
| `twitter-ingest.ts` | Twitter/X 提取（三层质量过滤） |
| `twitter-scweet-bridge.py` | Scweet Python 桥接（搜索 / 主页） |
| `wechat-ingest.ts` | 微信文章（Docker，三层过滤） |
| `zotero_sync.py` | Zotero 同步（在线 / 离线双路径） |
| `zotero_push.py` | 推送至 Zotero Web API + PDF 下载 |

### 知识处理
| 工具 | 用途 |
|---|---|
| `kb-lint.ts` | 7 项确定性检查的 Linter |
| `kb-gap-scan.ts` | 5 类知识缺口检测 |
| `kb-relations.ts` | 附属有类型关系图 |
| `kb-topic-bundle.ts` | 外部项目知识查询 |
| `kb-feedback-triage.ts` | 反馈分类与分诊 |
| `kb-merge.ts` | 概念页合并（含反向链接重连） |
| `kb-canvas.ts` | Obsidian Canvas 生成 |
| `kb-import.ts` | 外部笔记导入器 |
| `kb-export.ts` | 按溯源过滤的导出 |
| `kb-output.ts` | 多格式导出（JSONL / Marp / 报告） |

### 质量与验证
| 工具 | 用途 |
|---|---|
| `venue-verify.ts` | 场馆声明验证（S2 + DBLP） |
| `track-promote.ts` | Track A→B 晋升（`social-lead` → `source-derived`） |
| `relevance-filter.ts` | 摄入前三层相关性过滤 |
| `backfill_metadata.py` | 已有页面元数据补全 |

### 基础设施
| 工具 | 用途 |
|---|---|
| `noria-mcp-server.py` | 远程 MCP 服务器（搜索 + 获取 + 反馈） |
| `qmd-reindex.ts` | QMD 搜索索引管理 |
| `serve-remote.sh` | SSH 隧道配置脚本 |

## 目录结构

```
noria/
├── CLAUDE.md              # 精简 Agent 指令（约 71 行）
├── schema.md              # 完整 Wiki schema + 溯源规则
├── ARCHITECTURE.md        # 英文架构文档
├── ARCHITECTURE_CN.md     # 本文件（中文架构文档）
├── AGENTS.md              # Codex/GPT Agent 指令
├── log.md                 # 只追加操作日志
├── raw/                   # 原始来源（用户拥有，LLM 只读）
│   ├── zotero/papers/     # Zotero 同步的论文元数据
│   ├── arxiv/             # arXiv 搜索结果
│   ├── semantic-scholar/  # S2 搜索结果
│   ├── twitter/           # Twitter/X 帖子
│   ├── wechat/            # 微信文章
│   ├── github/            # GitHub 仓库 / 发行版
│   └── notes/             # 分析笔记
├── wiki/                  # 知识 Wiki（LLM 维护）
│   ├── index.md           # 主索引
│   ├── dashboard.md       # Dataview 仪表盘
│   ├── moc-*.md           # 内容地图（5 个 MOC）
│   ├── sources/           # 129 篇来源摘要
│   ├── concepts/          # 32 篇概念文章
│   ├── synthesis/         # 7 篇综合文章
│   ├── archive/           # 已废弃页面
│   └── *.canvas           # Obsidian Canvas 图谱
├── outputs/               # 生成产物（绝不回流）
│   ├── queries/           # 问答结果（查询衍生）
│   └── reviews/           # GPT/Codex 审阅结果
├── tools/                 # 27 个 TS/Python 工具
├── docs/                  # 参考文档
│   ├── tooling-reference.md
│   ├── agent-team-workflow.md
│   ├── remote-wiki-access.md
│   └── feedback-loop-design.md
├── .kb/                   # 内部状态
│   ├── manifest.json      # 编译状态
│   ├── relations.jsonl    # 有类型关系图
│   └── sync_state.json    # 同步状态
├── .llm/                  # 多模型 Agent 配置
│   └── agent-team.json    # 模型路由规则
└── .claude/
    ├── commands/          # 18 个斜线命令技能
    └── settings.local.json
```

## 多 Agent 模型路由

| 角色 | 模型 | 使用场景 |
|---|---|---|
| **编排器** | Claude Opus 4.6 | 主会话：规划、综合、架构 |
| **工作节点**（默认） | Claude Sonnet 4.6 | 编译、搜索、深化、代码编写 |
| **分诊** | Claude Haiku 4.5 | Lint、存在性检查、简单阅读 |
| **审阅器** | GPT-5.4（via Codex MCP） | 对抗式 Nightmare 审阅 |

通过 `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`（环境变量）+ CLAUDE.md 路由表强制执行。

## Zotero 集成（双路径）

| 路径 | 时机 | 方式 | 故障域 |
|---|---|---|---|
| **在线** | Zotero 运行中 | pyzotero 本地 API（Windows 宿主 IP:23119） | Zotero 进程 + 网络 |
| **离线** | Zotero 已关闭 | Better BibTeX JSON 导出文件 | 仅文件系统 |

支持集合级同步：`--list-collections`、`--collection "Name"`、`--tag-collection "Name"`。PDF 路径通过 `zotero_sync.py --pdf-paths` 解析（只读 SQLite 查询）。

## 技术栈

| 组件 | 技术选型 |
|---|---|
| Wiki 引擎 | Claude Code（Opus 4.6 编排器） |
| Zotero 访问 | pyzotero（在线）/ JSON 导入（离线） |
| 搜索 | QMD（BM25 + 向量 + RRF）via MCP |
| 文献检索 | arXiv API + Semantic Scholar API + DeepXiv |
| 知识查看器 | Obsidian（Canvas + Dataview + MOC） |
| 版本控制 | Git（Worktree 隔离用于并行工作） |
| 对抗式审阅 | Codex CLI（GPT-5.4 xhigh） |

## 核心设计原则

1. **用户拥有 raw/，LLM 维护 wiki/** — 清晰的所有权边界
2. **溯源无处不在** — 每条断言均有标注，查询衍生内容隔离管理
3. **先 Lint，再 Reflect** — 在 LLM 综合前执行确定性检查（钩子强制）
4. **少目录，富元数据** — 实体类型以标签表达，避免过早分类
5. **默认 Token 高效** — 渐进式阅读、清单门控、实时预筛
6. **精简 CLAUDE.md** — 不超过 80 行；schema 与工具按需加载
7. **多模型路由** — 每项任务使用能胜任的最低成本模型
8. **冲突显式呈现，不隐藏** — 矛盾内容明确标出，不静默覆盖
