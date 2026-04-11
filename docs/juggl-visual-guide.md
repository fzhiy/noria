# Juggl Graph Visual Guide

> NORIA 知识图谱的可视化配色方案与使用说明。
> CSS 文件: `wiki/.obsidian/plugins/juggl/graph.css`

---

## 颜色图例

### Layer 1: 页面类型（背景色 + 形状）

| 类型 | 颜色 | 形状 | 说明 |
|------|------|------|------|
| **Source** | 蓝色 `#4a90d9` | 椭圆 | 论文来源页（数量最多） |
| **Concept** | 绿色 `#50b848` | 圆角矩形 | 概念页（中间层，连接多个 source） |
| **Synthesis** | 橙色 `#f5834b` | 菱形（加大） | 综合分析页（最高层，跨概念桥接） |

### Layer 2: Provenance 信任级别（边框）

| Provenance | 边框颜色 | 样式 | 含义 |
|------------|----------|------|------|
| **user-verified** | 金色 `#f1c40f` | 实线 3px | 用户手动确认，最高信任 |
| **source-derived** | 绿色 `#2d8a4e` | 实线 2px | 从学术论文直接提取 |
| **llm-derived** | 灰色 `#888888` | 实线 2px | LLM 跨源综合生成 |
| **social-lead** | 红色 `#e74c3c` | 虚线 3px | 社交媒体/灰色文献，低信任 |

### Layer 3: 研究领域（Source 页面色调变化）

| Domain | 颜色 | 说明 |
|--------|------|------|
| **agent** | 蓝色 `#4a90d9` | Web/GUI Agent（默认蓝） |
| **benchmark** | 浅蓝 `#3498db` | 评测基准 |
| **drift** | 紫色 `#8e44ad` | UI/工作流漂移 |
| **peft** | 青色 `#1abc9c` | 参数高效微调 |
| **foundational** | 灰色 `#95a5a6` | 基础理论（持续学习等） |

### Layer 4: 会议级别（标签样式）

| Venue Tier | 效果 |
|------------|------|
| **top-conf** / **top-journal** | 标签文字加粗 |
| 其他 | 默认样式 |

### 特殊状态

| 状态 | 颜色 | 形状 | 说明 |
|------|------|------|------|
| **Dangling** | 浅灰 `#bdc3c7` | Tag 形状 + 虚线边框 | 未解析的引用（目标页不存在） |
| **MOC** | 深橙 `#e67e22` | 加大圆角矩形 | Map of Content 导航页 |

---

## 快速阅读指南

看到一个节点时，按以下顺序解读：

1. **形状** → 判断页面类型（椭圆=论文，矩形=概念，菱形=综合）
2. **边框** → 判断信任级别（金=人工确认，绿=论文来源，红虚线=社交媒体）
3. **背景色深浅** → 判断研究领域（紫=漂移，青=PEFT，蓝=Agent）
4. **标签粗细** → 判断会议级别（加粗=顶会/顶刊）

---

## 布局切换

Juggl 支持多种布局，在 graph 视图的工具栏选择：

| 布局 | 适用场景 |
|------|----------|
| **fdgd**（默认） | 探索整体结构，发现社区聚类 |
| **dagre** | 查看 synthesis → concept → source 层级关系 |
| **circle** | 突出 hub 节点（高连接度概念） |
| **grid** | 平铺浏览所有节点 |

### 在 Markdown 中嵌入局部图

在任意 `.md` 文件中使用 Juggl code block 创建局部图：

````markdown
```juggl
layout: dagre
local: true
depth: 2
```
````

这会以当前页面为中心，展示 2 层深度的邻居，使用 Dagre 层级布局。

---

## 自定义修改

CSS 文件位于 `wiki/.obsidian/plugins/juggl/graph.css`，修改后 Juggl 实时生效（无需重启 Obsidian）。

语法参考: [Cytoscape.js Style](https://js.cytoscape.org/#style) | [Juggl CSS Styling](https://juggl.io/features/styling/css-styling)

常用选择器:
- `node[type = "source"]` — 按 frontmatter 字段匹配
- `node.tag-xxx` — 按 tags 中的值匹配（`-` 替换为 `-`）
- `node.dangling` — Juggl 内置类
- `edge` — 所有连线
