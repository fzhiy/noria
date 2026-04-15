---
title: "Example 2025 — Demonstration Source Page"
type: source
provenance: source-derived
relevance: core
sources: [example2025-demo]
tags: [demo, web-agent, reinforcement-learning]
created: 2025-01-01
updated: 2025-01-01
authors: [Alice Example, Bob Demo]
year: 2025
venue: "Conference on Demonstration"
venue_tier: top-conf
venue_verified: false
venue_verification_source: "auto-unverified"
citation_count: 0
doi: "10.1234/example.2025.001"
institution: [Example University]
github_url: "https://github.com/example/demo-repo"
code_available: true
verification_status: reviewed
claims:
  - text: "The proposed method achieves 85% success rate on the benchmark"
    citekey: example2025-demo
    locator: "sec.4, table.1"
    type: empirical_result
    confidence: high
  - text: "Fine-tuning with LoRA reduces catastrophic forgetting by 40%"
    citekey: example2025-demo
    locator: "sec.3.2"
    type: method_claim
    confidence: medium
---

## Summary

This is a **demonstration source page** showing the expected format for NORIA wiki entries. Each source page corresponds to one paper, report, or document ingested into the knowledge base.

Key contributions:
- Proposed a novel method for web agent adaptation [source: example2025-demo, sec.3]
- Achieved state-of-the-art results on the benchmark [source: example2025-demo, sec.4, table.1]
- Released code and evaluation framework [source: example2025-demo, sec.6]

## Method

The approach uses reinforcement learning with LoRA adapters to enable continual learning without catastrophic forgetting [source: example2025-demo, sec.3.2].

## Results

| Benchmark | Success Rate | Baseline |
|-----------|-------------|----------|
| DemoBench  | 85%         | 62%      |
| TestSuite  | 78%         | 55%      |

[source: example2025-demo, sec.4, table.1]

## Limitations

- Only tested on synthetic benchmarks [source: example2025-demo, sec.5]
- Requires GPU for training [source: example2025-demo, sec.3.1]
