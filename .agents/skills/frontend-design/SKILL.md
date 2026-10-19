---
name: frontend-design
description: Create production-grade, highly crafted frontend interfaces tailored to context, avoiding generic AI-generated aesthetics.
---

# Frontend Design

Create production-grade, distinctive frontend interfaces that match product context, rejecting generic AI templates, predictable gradients, and cliché component patterns.

## Core Directives

1. **Deliberate Aesthetic Direction:**
   - Establish a distinct visual concept before generating code (e.g. brutalist, modern luxury, dark technical fintech, or retro-futuristic).
   - In the case of UPRAIL: Dark luxury obsidian surfaces (`#0A0807`), warm terracotta undertones, hero burnt orange (`#E05326`), NEAR protocol cyan/green, and high-craft typography (`Clash Display`, `Cabinet Grotesk`, `JetBrains Mono`).

2. **Typography Hierarchy:**
   - Pair an expressive display typeface with a crisp, neutral grotesque body font and a technical monospace for financial/intent metadata.
   - Enforce rigorous tracking, line-height balance, and hierarchy.

3. **Color & Surface Depth:**
   - Drive all surfaces via CSS variables or semantic tokens.
   - Use multi-layer depth: ambient blurred backdrops, glassmorphic specular sheens, crisp 1px borders, and tactile inner glows (`inset 0 0 20px rgba(224,83,38,0.2)`).

4. **Hard Quality Gates:**
   - Verified contrast ratios (WCAG AA/AAA).
   - Responsive layouts that never overflow or collapse.
   - Accessible keyboard focus rings and semantic HTML.
