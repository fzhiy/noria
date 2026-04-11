# Plan: Cross-Paper Insight Discovery (`kb-discover`)

> Status: **Planned** (saved 2026-04-09, not yet implemented)
> Priority: P0 per Session 7 handoff
> Branch: feature/agent

## Context

NORIA 已有 128 source pages、32 concept pages、7 synthesis pages，claim 级 citation 和 Open Questions 丰富，但缺少**跨论文 insight 发现**能力。Session 7 handoff 明确要求实现此功能作为 P0。

参考：ClaimFlow (5-type claim relations)、Deep Ideation (concept graph distance = novelty proxy)。

## Approach: 新建 `tools/kb-discover.ts` + 小幅扩展 `tools/kb-relations.ts`

---

### Phase 1: 扩展 kb-relations.ts (~20 行改动)

**File: `tools/kb-relations.ts`**

1. L26 `RelationType` 加入 `"supports" | "qualifies"`
2. L33 `origin` 加入 `"discover"`
3. L182 `validTypes` 数组同步更新
4. L307-309 DOT export `colors` map 加入 `supports: "darkgreen"`, `qualifies: "goldenrod"`

不抽取 exports — kb-discover 自行实现 loadRelations（同 repo 惯例：每个工具自包含）。

---

### Phase 2: 新建 tools/kb-discover.ts (~500 行)

复用 `kb-topic-bundle.ts:58-109` 的 `parsePage`/`loadAllPages` 模式（自包含拷贝，非 import）。

#### CLI 接口

```
npx tsx tools/kb-discover.ts --claims          # 提取 claim 级跨论文关系
npx tsx tools/kb-discover.ts --questions       # 聚类 Open Questions
npx tsx tools/kb-discover.ts --distances       # 概念距离矩阵 + bridge candidates
npx tsx tools/kb-discover.ts --all             # 全部分析
npx tsx tools/kb-discover.ts --all --save      # 保存到 outputs/insights/
npx tsx tools/kb-discover.ts --format json     # JSON 输出
```

#### 子命令 A: `--claims` — Claim 关系提取

1. 扫描所有 wiki 页面，按 `## Section` 分段
2. 对每行提取 `[source: citekey, locator]`，找到含 2+ 不同 citekey 的 claim
3. **信号词启发式分类**（零 LLM 成本）：
   - `while/whereas/however/unlike/contradicts` → `contradicts`
   - `extends/builds on/improves/generalizes` → `extends`
   - `confirms/supports/consistent with/validates` → `supports`
   - `refines/qualifies/partially/conditionally` → `qualifies`
   - 无匹配 → `related`
4. 输出 `ClaimRelation[]`：sourceA, sourceB, relationType, evidence(claim text), page, section, confidence

#### 子命令 B: `--questions` — Open Question 聚类

1. 提取所有 `## Open Questions` 下的 bullet items（~50 个）
2. 对每个问题提取：cited papers、keywords（去 stop words，保留 >4 字符 token + 已知 citekey/slug 匹配）
3. 相似度计算：`jaccard(keywords)` + 共享 cited paper 加 0.3 + 跨页面加 0.2
4. Single-linkage 聚类（threshold 0.25，可 CLI 调参）
5. 每个 cluster 输出：theme（top-3 keywords）、questions、shared papers、shared concepts、research angle

#### 子命令 C: `--distances` — 概念距离矩阵

1. 从 `.kb/relations.jsonl` 加载关系，构建无向邻接表（仅 concept→concept 边）
2. BFS 计算所有概念对最短路径（32 concepts，最多 496 对，瞬间完成）
3. 对每对计算 shared sources（同时 related 到两个 concept 的 source pages）
4. `noveltyScore = distance × sharedSources.length`（远距离 + 共享 source = latent bridge）
5. 按 noveltyScore 降序排列，top-N 输出为 bridge candidates

#### 输出格式

- Text 模式（默认）：人可读 markdown report
- JSON 模式：`DiscoverOutput` 对象
- `--save` 时写入 `outputs/insights/YYYY-MM-DD-discover-<mode>.json` + `.md`

---

### Phase 3: 新建 .claude/commands/kb-discover.md

遵循 `kb-lint.md` 模式，编写 slash command 描述。

### Phase 4: 更新 CLAUDE.md

在 `## Installed Workflow Tooling` 末尾添加 kb-discover 工具描述（一行）。

---

## 不做的事

- 不用向量嵌入聚类（50 个问题用 Jaccard 足够）
- 不用加权 Dijkstra（v1 只有 wikilink/related 两种边，权重无意义）
- 不抽取共享模块（遵循 repo 惯例：每个工具自包含 parsePage）
- 不改 wiki/ 内容（输出全部到 outputs/insights/）
- 不自动写入 relations.jsonl（打印建议，手动 `--add` 确认）

## 关键文件

| 文件 | 操作 |
|---|---|
| `tools/kb-relations.ts` | 修改：+2 types, +1 origin, +2 colors |
| `tools/kb-discover.ts` | **新建**：~500 行核心工具 |
| `tools/kb-topic-bundle.ts` | 只读参考：复用 parsePage 模式 |
| `.claude/commands/kb-discover.md` | **新建**：slash command |
| `CLAUDE.md` | 修改：加一行工具描述 |

## 验证方式

```bash
# 1. 扩展后 kb-relations 仍正常
npx tsx tools/kb-relations.ts --stats
npx tsx tools/kb-relations.ts --add test-a test-b supports "test"
npx tsx tools/kb-relations.ts --query test-a

# 2. kb-discover 各模式
npx tsx tools/kb-discover.ts --claims
npx tsx tools/kb-discover.ts --questions
npx tsx tools/kb-discover.ts --distances
npx tsx tools/kb-discover.ts --all --save

# 3. kb-lint 仍通过
npx tsx tools/kb-lint.ts
```
