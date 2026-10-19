---
name: uprail-motion-design
description: Design, craft, and render world-class motion graphics, 3D interactive video cards, and AI-augmented brand assets for UPRAIL (app.uprail.world).
---

# UPRAIL Motion Design & Studio Pipeline

This skill guides the creation of studio-grade motion graphics, interactive video cards, kinetic typography, and generative AI assets tailored to the **UPRAIL** brand identity.

---

## 1. Brand Identity & Visual Language

UPRAIL delivers **confidential payments to X (Twitter) handles, claimed with hardware passkeys (Touch ID / Face ID) and settled on NEAR via NEAR Intents**.

### Color Tokens
* **Hero Primary:** `#E05326` (Burnt Orange 500) — High-energy brand signature.
* **Secondary Flame:** `#FF5722` (Flame 500) — Dynamic accents, glow highlights.
* **Deep Obsidian:** `#0A0807` (Base Background), `#120E0C` (Elevated Surface), `#181310` (Card Chassis).
* **Protocol Accents:** `#00EC97` (NEAR Green — Success, Shield Active), `#00C1DE` (NEAR Cyan — Solver & Routing).
* **Typography:** Display (`"Clash Display"`, `Syne`), Sans (`"Cabinet Grotesk"`, `"Space Grotesk"`), Mono (`"JetBrains Mono"`).

---

## 2. Studio Motion Physics (Non-Negotiable Principles)

World-class motion design avoids linear or basic cubic-bezier tweens:

1. **Spring Physics Over Easing Curves:**
   * **Card Entrances / Snaps:** `{ mass: 0.8, stiffness: 140, damping: 14 }`
   * **Micro-Pops & Badges:** `{ mass: 0.4, stiffness: 220, damping: 12 }`
   * **Camera Parallax & 3D Tilt:** `{ mass: 1.2, stiffness: 90, damping: 20 }`
2. **The 3-Layer Depth Rule for Video Cards:**
   * **Layer 1 (Deep Plate):** Looping particle fog, obsidian mesh, or blurred AI cinematic plate.
   * **Layer 2 (Chassis):** Glassmorphic card surface (`backdrop-filter: blur(28px)`), 1px border (`#2C221D` or glowing `#E05326`), dynamic specular sheen.
   * **Layer 3 (Foreground):** High-contrast kinetic typography, passkey lock glyphs, currency values, and live status ping.
3. **Finishing Layers:**
   * 2-3% film grain overlay (`mix-blend-mode: overlay`).
   * Subtle edge chromatic aberration or burnt-orange glow (`0 0 45px -5px rgba(224, 83, 38, 0.45)`).

---

## 3. Generative AI Prompting Guidelines

When generating visual assets for UPRAIL:

* **3D Glassmorphic Cards (Image Gen / Flux):**
  > "Dark luxury fintech aesthetic, floating 3D holographic payment card made of dark smoked glass with burnt orange edge lighting and near cyan micro-accents, obsidian background, clean minimalist studio lighting, high fidelity octane render 8k."
* **Vector Icons & Badges (Recraft V3):**
  > "Minimalist modern biometric fingerprint glyph, clean geometric vector lines, transparent background, studio icon design."
* **Atmospheric Video Loops (Kling / Runway):**
  > "Slow cinematic camera pan across dark volcanic obsidian mineral surface with subtle glowing liquid orange embers, high contrast, 60fps."
