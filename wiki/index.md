---
title: "Knowledge Base Index"
type: index
provenance: llm-derived
sources: []
tags: [index, navigation]
created: 2026-04-07
updated: 2026-04-09
---

# Knowledge Base Index

> Master navigation for all wiki pages. Each entry: wikilink — one-line summary.
> This file is maintained by `/kb-compile`. Do not edit manually.

## Sources

### PEFT & Continual Adaptation
- [[2025-dynamic-orthogonal-c]] — DOC: dynamic orthogonal constraints for continual fine-tuning without catastrophic forgetting.
- [[aghajanyan2021-intrinsic-dimensiona]] — Foundational study showing pre-trained models have low intrinsic dimensionality for fine-tuning.
- [[ahmad2026-on-catastrophic-forg]] — Analysis of catastrophic forgetting in PEFT methods during sequential task learning.
- [[ding2025-sulora]] — SuLoRA: subspace decomposition for multi-task LoRA without parameter interference.
- [[jiang2024-mora]] — MoRA: high-rank updating via square matrices to improve knowledge memorization.
- [[liu2025-lift-the-veil-for-th]] — LIFT: sparse fine-tuning via principal singular value weight selection.
- [[malladi2023-a-kernel-based-view]] — Neural tangent kernel framework for understanding fine-tuning and PEFT dynamics.
- [[marczak2025-no-task-left-behind]] — Isotropic merging of LoRA-adapted models using common and task-specific SVD subspaces.
- [[meng2024-pissa]] — PiSSA: principal singular value-based LoRA initialization.
- [[panariello2025-accurate-and-efficie]] — Core Space merging framework for accurate and efficient LoRA model merging.
- [[ponkshe2025-initialization-using]] — LoRA-SB: initialization strategy for extreme parameter efficiency in LoRA.
- [[qiu-controlling-text-to]] — OFT/COFT: orthogonal fine-tuning preserving hyperspherical energy.
- [[savadikar-wegeft]] — WeGeFT: weight-generative fine-tuning using pretrained weight representations.
- [[shuttleworth2025-lora-vs-full-fine-tu]] — Spectral analysis of LoRA vs full fine-tuning, identifying intruder dimensions and forgetting.
- [[skorobogat2025-subspace-boosted-mod]] — Subspace Boosting: SVD-enhanced task arithmetic for model merging.
- [[sliwa2025-mitigating-forgettin]] — LALoRA: Laplace approximation regularization to mitigate LoRA forgetting.
- [[tastan2025-loft]] — LoFT: aligning LoRA gradient updates with full fine-tuning optimizer dynamics.
- [[wang2025-hd-pissa]] — HD-PiSSA: distributed high-rank PiSSA for scalable principal component initialization.
- [[wang2025-losia]] — LoSiA: gradient-sparsity subnet selection for high-rank adaptation.
- [[wang2025-milora]] — MiLoRA: minor singular component initialization for improved LoRA knowledge preservation.
- [[wu2025-revisiting-model-int]] — Model interpolation between Base and Instruct for efficient reasoning.
- [[wu2025-shadow-ft]] — Shadow-FT: fine-tuning Instruct models by grafting updates onto Base weights.
- [[wu2025-timber]] — Timber: training-free Instruct model refinement via effective rank analysis.
- [[ye2025-analysis-on-distribu]] — Weight distribution and clustering analysis of LoRA singular value structure.
- [[zhang-an-orthogonal-high-r]] — OHoRA: orthogonal high-rank adaptation via QR decomposition and Kronecker products.

### Agent Sources
- [[bai2024-digirl]] — DigiRL: autonomous RL for device-control agents on Android (67.2% success on AitW).
- [[bui2026-building-effective-a]] — OPENDEV: terminal-native coding agent with dual-agent architecture and adaptive context compaction.
- [[cai2025-flex]] — FLEX: gradient-free continuous agent evolution via structured experience library.
- [[cai2026-building-self-evolvi]] — ELL: experience-driven lifelong learning framework for self-evolving agents with StuLife benchmark.
- [[chezelles2025-the-browsergym-ecosy]] — BrowserGym ecosystem with AgentLab for unified web agent evaluation across 6 benchmarks.
- [[drouin2024-workarena]] — WorkArena: 33 enterprise tasks on ServiceNow with BrowserGym evaluation environment.
- [[feng2026-longcli-bench]] — LongCLI-Bench: long-horizon CLI programming benchmark (agents <20% pass rate).
- [[gandhi2026-endless-terminals]] — Endless Terminals: procedural task generation pipeline for terminal agent RL (3,255 tasks).
- [[guan2026-computer-using-world]] — CUWM: two-stage world model for desktop GUI that predicts next UI state via text→visual factorization.
- [[he2025-recon-act]] — Recon-Act: self-evolving multi-agent browser system with reconnaissance-action tool generation.
- [[introducing-osworld-verified]] — OSWorld-Verified: refined benchmark addressing 300+ issues for reliable agent evaluation.
- [[ishmam2026-timewarp]] — TimeWarp: benchmark for web agent robustness to UI changes across six design eras.
- [[jiang2026-xskill]] — XSkill: dual-stream continual learning (experiences + skills) for multimodal agents.
- [[levy2026-st-webagentbench]] — ST-WebAgentBench: safety and trustworthiness benchmark with CuP metric for web agents.
- [[li2025-encompass]] — EnCompass: agent programming framework with inference-time search over execution paths.
- [[li2026-just-in-time-reinfor]] — JitRL: training-free test-time policy optimization via trajectory memory and logit modulation.
- [[liu2024-visualagentbench]] — VisualAgentBench: benchmark for multimodal agents across embodied, GUI, and visual design.
- [[lou2026-learning-to-learn-at]] — Meta-TTL: bi-level optimization for learning test-time adaptation policies via evolutionary search.
- [[lyu2026-evoscientist]] — EvoScientist: multi-agent AI scientist with persistent memory for scientific discovery.
- [[merrill2026-terminal-bench]] — Terminal-Bench 2.0: 89 hard realistic terminal tasks (frontier models <65%).
- [[patwardhan2025-gdpval]] — GDPval: evaluating AI on real-world economically valuable tasks across 44 occupations.
- [[qi2025-webrl]] — WEBRL: self-evolving online curriculum RL training open LLMs as web agents (surpassing GPT-4-Turbo).
- [[rahmati2026-abstraction-as-a-mem]] — AAT: abstraction as memory-efficient inductive bias for continual learning with zero replay buffer.
- [[thai2026-swe-evo]] — SWE-EVO: long-horizon software evolution benchmark (GPT-5 achieves 21% vs 65% single-issue).
- [[ullrich2025-openapps]] — OpenApps: measuring UI-agent reliability across app variations (50%+ success rate fluctuation).
- [[vattikonda2025-how-to-train-your-ll]] — Statistical diagnosis of training open-source web agents (IL + GRPO pipeline).
- [[wang2025-agent-workflow-memor]] — Agent Workflow Memory: reusable task workflows improving WebArena success by 51.1%.
- [[wang2026-openclaw-rl]] — OpenClaw-RL: universal online learning from next-state signals with PRM judge and on-policy distillation.
- [[wang2026-universe-routing]] — Universe Routing: epistemic control for self-evolving agents with hard routing to belief-space solvers.
- [[wei2025-webagent-r1]] — WebAgent-R1: end-to-end multi-turn RL boosting Llama-3.1-8B to 44.8% on WebArena-Lite.
- [[xiao2026-webworld]] — WebWorld: first open-web simulator (1M+ interactions) for web agent training and inference-time search.
- [[xie2024-osworld]] — OSWorld: real computer environment benchmark for multimodal agents (best model 12.24% vs human 72.36%).
- [[yang2026-autoskill]] — AutoSkill: model-agnostic lifelong skill derivation and evolution from interaction traces.
- [[yao2026-cgl]] — CGL: continual GUI learning balancing SFT and RL with entropy-guided adjustment and gradient surgery.
- [[yu2026-self-consolidation-f]] — Self-consolidation: distilling textual experience into compact learnable parameters for agent evolution.
- [[zhang2026-memskill]] — MemSkill: learnable and evolvable memory skills with controller-executor-designer architecture.
- [[zhou2024-webarena]] — WebArena: realistic web environment with 4 domains (GPT-4 at 14.41% vs human 78.24%).
- [[zhou2025-memento]] — Memento: memory-augmented MDP for adaptive LLM agents without fine-tuning (87.88% Pass@3 on GAIA).
- [[zhou2026-memento-skills]] — Memento-Skills: generalist continually-learnable agents that autonomously design task-specific agents.

### Semantic Scholar (Web Agent Robustness & Adaptation)
- [[jaglan2025-continual-learning-n]] — ATLAS: dual-agent gradient-free continual learning with persistent learning memory (54.1% on ExCyTIn-Bench).
- [[liu2025-benchmarking-mllm-ba]] — WebRRSBench: reasoning, robustness, and safety benchmark for MLLM-based web understanding (729 websites, 3799 QA pairs).
- [[cuvin2025-decepticon]] — DECEPTICON: dark patterns manipulate web agents in >70% of tasks; larger models more susceptible.
- [[ma2026-embewebagent]] — EmbeWebAgent: embedding web agents into enterprise UIs via ARIA hooks and WebSocket.
- [[dihan2025-weboperator]] — WebOperator: action-aware tree search with safe backtracking for web agents.
- [[bhathal2025-websight]] — WebSight: vision-first multi-agent architecture with LoRA-tuned VLM for robust web navigation.
- [[mughal2025-an-autonomous-rl-age]] — Autonomous RL agent for dynamic web UI testing in BDD framework.
- [[team2026-ui-venus-15-technica]] — UI-Venus-1.5: unified end-to-end GUI agent (2B/8B/30B) for real-world applications.
- [[chen2025-maceval]] — MACEval: multi-agent continual evaluation network for dynamic LLM assessment.
- [[chen2026-stability-oriented-a]] — Stability-oriented agentic RL for web automation under cost and failure constraints.

- [[yu2026-how-do-visual-attributes-influ]] — How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of Use.
- [[prazina2023-methods-for-automatic-web-page]] — Methods for Automatic Web Page Layout Testing and Analysis: A Review.
- [[ye2025-realwebassist]] — RealWebAssist: A Benchmark for Long-Horizon Web Assistance with Real-World Users.
- [[grover2025-self-healing-web-automation]] — SELF-HEALING WEB AUTOMATION: AN EMPIRICAL COMPARISON OF TRADITIONAL SELENIUM FRA.
- [[joseph2026-beyond-llm-based-test-automati]] — Beyond LLM-based test automation: A Zero-Cost Self-Healing Approach Using DOM Ac.
- [[kraus2024-looking-for-change]] — Looking for Change: A Computer Vision Approach for Concept Drift Detection in Pr.
- [[puneetha2025-process-mining-based-approach]] — Process Mining-Based Approach for Incremental and Recurring Concept Drift Detect.
- [[h.2025-driftxminer]] — DriftXMiner: A Resilient Process Intelligence Approach for Safe and Transparent .
- [[alenezi2026-from-prompt-response-to-goal-d]] — From Prompt-Response to Goal-Directed Systems: The Evolution of Agentic AI Softw.

### Drift Detection & Non-Stationary Adaptation
- [[wan2024-online-drift-detecti]] — MCD-DD: unsupervised concept drift detection via maximum concept discrepancy and contrastive learning (KDD 2024).
- [[liu2024-deep-reinforcement-l]] — DRL in nonstationary environments with unknown change points via joint distribution monitoring (IEEE TCYB 2024).
- [[liu2025-learning-latent-and]] — LLCD: model-based RL detecting and adapting to changing dynamics in latent space (IEEE TKDE 2025).
- [[yang2024-risk-aware-constrain]] — RAC: risk-aware constrained RL with non-stationary policies and quantile-level cost conditioning (AAMAS 2024).

### GUI Agent Self-Improvement
- [[wu2025-gui-reflection]] — GUI-Reflection: self-reflection and error correction for GUI agents via online reflection tuning.

### Agent Benchmarks & Security
- [[yan2025-mcpworld]] — MCPWorld: first unified benchmark for API, GUI, and hybrid CUA agents with UI-state-decoupled evaluation.
- [[wang2025-mcpguard]] — MCPGuard: security analysis of MCP agent systems — agent hijacking, web vulnerabilities, supply chain threats.

### Twitter Sources
- [[yiliuli-2026-03-16-introducing-avenir-web-a-]] — Avenir-Web: open-source SOTA multimodal web agent (53.7% on Online-Mind2Web).

### Self-Evolving Web Agents (arXiv)
- [[liu2025-webcoach]] — WebCoach: cross-session memory guidance for self-evolving web agents (47%→61% on WebVoyager).
- [[fang2025-webevolver]] — WebEvolver: co-evolving world model for web agent self-improvement (+10% on Mind2Web-Live, EMNLP 2025).
- [[zheng2025-skillweaver]] — SkillWeaver: autonomous skill-as-API synthesis for web agents (+31.8% WebArena, +54.3% cross-agent transfer).
- [[yang2025-zerogui]] — ZeroGUI: zero-human-cost online GUI learning via VLM task generation + auto reward + two-stage RL.
- [[zhai2025-agentevolver]] — AgentEvolver: self-questioning + self-navigating + self-attributing for efficient agent self-evolution (22 citations).
- [[huang2025-cascade]] — CASCADE: cumulative agentic skill creation through autonomous development and evolution.
- [[atreja2025-alas]] — ALAS: autonomous learning agent pipeline for continual LLM knowledge updating (15%→90% accuracy).
- [[nie2026-synergy]] — Synergy: agentic citizen architecture with lifelong evolution for open agentic web.

### Agent Context & Reward
- [[feng2026-agentswing]] — AgentSwing: adaptive parallel context management routing for long-horizon web agents (3x efficiency).
- [[zhang2026-webarbiter]] — WebArbiter: principle-guided reasoning PRM for web agents (outperforms GPT-5 by 9.1pt on WebPRMBench).
- [[li2026-graph-of-skills]] — Graph of Skills: dependency-aware structural retrieval for massive agent skill libraries (+43.6% reward, -37.8% tokens).

### Agent Safety & Robustness (arXiv)
- [[chen2025-ghostei-bench]] — GhostEI-Bench: first benchmark for mobile agent resilience to environmental injection attacks.
- [[chen2026-comparing-human-over]] — Comparing human oversight strategies for CUAs: plan-based reduces problems but not intervention success.
- [[wu2026-ui-oceanus]] — UI-Oceanus: scaling GUI agents with synthetic environmental dynamics for robustness.

### Foundational Web Agent Benchmarks
- [[liu2018-miniwob-plus]] — MiniWoB++: 100+ web interaction tasks with workflow-guided RL exploration (ICLR 2018, foundational).
- [[deng2023-mind2web]] — Mind2Web: first generalist web agent dataset — 2000+ tasks across 137 real websites, 31 domains (NeurIPS 2023).
- [[lu2024-weblinx]] — WebLINX: 100K interactions, 2300 demonstrations of conversational multi-turn web navigation on 150+ websites.

### Foundational Continual Learning
- [[kirkpatrick2016-overcoming-catastrop]] — EWC: Overcoming catastrophic forgetting via Fisher information regularization (9432 citations, PNAS 2017).
- [[mallya2017-packnet]] — PackNet: Adding multiple tasks to a single network by iterative pruning (1536 citations, CVPR 2018).

### Visual Web Benchmarks
- [[koh2024-visualwebarena]] — VisualWebArena: evaluating multimodal agents on realistic visual web tasks.
- [[he2024-webvoyager]] — WebVoyager: end-to-end web agent with large multimodal models (290 citations, ACL 2024).

### Off-Topic / Quarantined
- [[cli-anything-hub]] — CLI-Anything project (off-topic: terminal agent tool, not web agent drift).
- [[cli-anythingreadme-cnmd-at-main-hkudscli]] — CLI-Anything GitHub README (off-topic).
- [[openarenato-agent-arena]] — OpenArena leaderboard (off-topic: generic agent competition).
- [[probing-llm-social-intelligence-via-were]] — Werewolf game social intelligence (off-topic: game ≠ web agent).
- [[chen2026-shifting-adaptation-from-weigh]] — Medical image segmentation (off-topic: keyword false positive on "adaptation").
- [[abedini2025-a-multi-agent-contin]] — Skin cancer detection (off-topic: medical false positive on "continual learning").
- [[li2026-joint-optimization-o]] — Medical diagnostic agent (off-topic: medical false positive on "agent").

- [[boisvert2024-workarena]] — WorkArena++ compositional planning benchmark for web agents (NeurIPS 2024)
- [[huq2025-cowpilot]] — CowPilot human-agent collaborative web navigation framework (NAACL 2025)
- [[lacoste2026-cube]] — CUBE universal protocol standard for unifying agent benchmarks via MCP+Gym
- [[lai2024-autowebglm]] — AutoWebGLM web navigation agent with curriculum RL training (KDD 2024)
- [[lai2025-androidgen]] — AndroidGen mobile agent framework for data-scarce environments (ACL 2025)
- [[li2025-the-tool-decathlon]] — Toolathlon benchmark: 32 apps, 604 tools, long-horizon agent evaluation
- [[liu2024-autoglm]] — AutoGLM autonomous GUI agents for web and phone with progressive RL
- [[lu2025-deepdive]] — DeepDive deep search agent with knowledge graphs and multi-turn RL
- [[pahuja2025-explorer]] — Explorer scalable web trajectory synthesis for multimodal agents (ACL 2025)
- [[qi2024-webrl]] — WebRL self-evolving curriculum RL for web agents (4.8%→42.4% on WebArena-Lite)
- [[song2024-beyond-browsing]] — API-based web agents outperform browsing-only agents on WebArena (ACL 2024)
- [[xu2024-androidlab]] — AndroidLab training and benchmarking framework for Android agents
- [[xu2024-theagentcompany]] — TheAgentCompany benchmark for LLM agents on real-world workplace tasks

## Concepts

### PEFT Foundations
- [[parameter-efficient-fine-tuning|Parameter-Efficient Fine-Tuning]] — Adapting large models by updating only a small subset of parameters.
- [[low-rank-adaptation|Low-Rank Adaptation]] — LoRA and variants: decomposing weight updates as low-rank matrices.
- [[high-rank-adaptation|High-Rank Adaptation]] — Methods achieving higher effective rank than standard LoRA (MoRA, LoSiA, HD-PiSSA).
- [[effective-rank|Effective Rank]] — Shannon entropy-based measure of matrix rank; diagnostic for LoRA expressivity.
- [[intrinsic-dimensionality|Intrinsic Dimensionality]] — Pre-trained models can be fine-tuned in surprisingly low-dimensional subspaces.

### Adaptation & Preservation Methods
- [[kronecker-product|Kronecker Product]] — Kronecker product adapters (OHoRA) for structured high-rank PEFT.
- [[orthogonal-fine-tuning|Orthogonal Fine-Tuning]] — OFT/COFT/DOC: preserving pre-trained features via orthogonal weight constraints.
- [[singular-value-decomposition|Singular Value Decomposition]] — SVD for LoRA initialization (PiSSA, MiLoRA), spectral analysis, and model merging.
- [[tensor-decomposition|Tensor Decomposition]] — Tensor network factorization for continual learning with compact budgets.

### Theory & Analysis
- [[spectral-analysis|Spectral Analysis]] — SVD-based analysis of weight update matrices; intruder dimensions, redundancy diagnosis.
- [[neural-tangent-kernel|Neural Tangent Kernel]] — Kernel framework for understanding fine-tuning dynamics and PEFT effectiveness.
- [[catastrophic-forgetting|Catastrophic Forgetting]] — Loss of previously learned knowledge during fine-tuning on new tasks.
- [[continual-learning|Continual Learning]] — Sequential task learning without catastrophic forgetting.
- [[task-vectors|Task Vectors]] — Weight-space arithmetic on fine-tuned weight differences for model editing and merging.
- [[base-vs-instruct-models|Base vs Instruct Models]] — Weight-level analysis of differences between base and instruction-tuned LLMs.

### Model Integration
- [[model-merging|Model Merging]] — Combining multiple fine-tuned models: task arithmetic, SVD-based, isotropic merging.

### Agent Architecture & Training
- [[web-agent|Web Agent]] — LLM-powered agents autonomously navigating and interacting with web interfaces.
- [[gui-agent|GUI Agent]] — Agents interacting with graphical user interfaces through visual observation and actions.
- [[terminal-agent|Terminal Agent]] — LLM agents operating in CLI/terminal environments for software engineering.
- [[multi-agent-system|Multi-Agent System]] — Multiple specialized LLM agents collaborating to solve complex tasks.
- [[reinforcement-learning-for-agents|Reinforcement Learning for Agents]] — RL methods for training LLM agents in interactive environments.
- [[test-time-learning|Test-Time Learning]] — Inference-time adaptation without modifying model parameters.
- [[world-model|World Model]] — Environment simulators enabling synthetic training and inference-time planning.

### Drift & Robustness
- [[ui-drift|UI Drift]] — Changes in web/app interfaces over time that cause agent performance degradation.
- [[workflow-drift|Workflow Drift]] — Changes in task procedures and business processes that agents must adapt to.
- [[drift-detection|Drift Detection]] — How agents recognize that environments have changed (reactive vs proactive approaches).
- [[agent-robustness|Agent Robustness]] — How well agents maintain performance under distribution shifts and environmental variations.

### Agent Evolution & Memory
- [[self-evolving-agent|Self-Evolving Agent]] — Agents that autonomously improve from interaction experience.
- [[agent-memory|Agent Memory]] — Memory systems for accumulating and retrieving past experiences.
- [[skill-learning|Skill Learning]] — Discovering, creating, and refining reusable task-solving routines.
- [[agent-benchmark|Agent Benchmark]] — Evaluation environments for measuring LLM agent capabilities.
- [[agent-safety|Agent Safety]] — Evaluating and ensuring agents operate safely within defined policies.

## Synthesis

- [[skill-centric-agent-evolution|Skill-Centric Agent Evolution]] — Skill format spectrum (API/folder/graph), lifecycle (discovery→practice→distillation→retrieval), self-evolution dimension (WebCoach/WebEvolver/AgentEvolver), drift-aware lifecycle management. Synthesizes 13 sources.

- [[drift-response-decision-tree|Drift Response Decision Tree]] — Decision framework mapping drift type, magnitude, frequency, and safety criticality to 10 response strategies (Tolerate→Escalate). Connects detection methods (MCD-DD, LLCD, CGL) to adaptation paradigms (RL, memory, hybrid, meta-learning). Synthesizes 17 sources.

- [[continual-adaptation-web-agents|Continual Adaptation Methods for Web Agents]] — Three adaptation strategies (RL-based, memory-based, hybrid) for web agents facing UI drift and workflow drift. Synthesizes ELL, CGL, WebRL, TimeWarp, AWM.
- [[self-evolving-agent-architectures|Self-Evolving Agent Architectures]] — Four evolution paradigms (gradient-free experience, parametric consolidation, skill/tool discovery, meta-learned adaptation). Synthesizes FLEX, Recon-Act, Memento-Skills, AWM, Meta-TTL, Self-Consolidation.
- [[web-agent-robustness-under-drift|Web Agent Robustness under UI and Workflow Drift]] — Measurement, failure mechanisms, and mitigation strategies for drift impact. Synthesizes TimeWarp, OpenApps, DigiRL, ST-WebAgentBench, DECEPTICON, and 6 new S2 drift papers.
- [[agent-safety-under-drift|Agent Safety and Oversight under Environmental Drift]] — Safety-drift intersection: adversarial attack surfaces (dark patterns, environmental injection, MCP vulnerabilities), safety evaluation frameworks (CuP, VR), defense mechanisms (RAC, human oversight, zero-trust).
- [[benchmark-methodology-adaptive-agents|Benchmark Methodology for Evaluating Adaptive Web Agents]] — Three generations of benchmarks (static→drift-aware→world model), methodological trade-offs, what current benchmarks cannot measure (continuous drift, recovery time, selective retention, safety under drift).

### Recent Additions (Session 7 Sync — Batch 2)
- [[zhang2026-expseek]] — ExpSeek: self-triggered step-level experience seeking for web agents via entropy thresholds (+9.3% on Qwen3-8B).
- [[evtimov2025-wasp]] — WASP: end-to-end web agent security benchmark against prompt injection (86% partial attack success).
- [[l2025-agentrewardbench]] — AgentRewardBench: first benchmark for LLM judges evaluating web agent trajectories (1302 trajectories, 5 benchmarks).
- [[zheng2024-gpt-4vision-is-a-gen]] — SeeAct: GPT-4V as generalist web agent on live websites (ICML 2024, 469 cites). Grounding remains major challenge.
- [[zhai2026-guide]] — GUIDE: hierarchical GUI agent evaluation via trajectory segmentation and subtask diagnosis (+5.35pp).
- [[ramesh2026-websp-eval]] — WebSP-Eval: evaluating web agents on website security and privacy tasks.
- [[cossu2026-a-practical-guide-to]] — Practical guide to streaming continual learning (Neurocomputing 2026).

### Recent Additions (Session 7 Sync)
- [[fang2025-a-comprehensive-surv]] — Comprehensive survey of self-evolving AI agents: unified feedback loop framework, four evolution pathways (model/memory/tool/workflow).
- [[shao2025-your-agent-may-misev]] — Misevolution: emergent risks in self-evolving LLM agents across model, memory, tool, and workflow pathways. First systematic study.
- [[yuan2025-remac]] — REMAC: self-reflective multi-agent planning for robot manipulation with reflection + evolvement modules (+40% success).

<!-- remote-sync: enabled via post-commit rsync hook -->
- [[benchmark-driven-rl-training]] — How web agent benchmarks are repurposed as RL training environments
- [[gui-agent-resilience-under-ui-drift]] — How GUI agents break under UI changes and emerging resilience patterns
