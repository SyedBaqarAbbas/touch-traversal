---
title: Gesture Thresholds
date: 2026-04-17
theme: learning
tags:
  - gestures
  - input
  - evaluation
sample: true
---

# Gesture Thresholds

## Classification note

A pinch should be treated as a short state transition, not a single-frame distance check. The
fictional prototype enters a candidate state when thumb and index fingertips approach, confirms
selection only after several stable frames, and requires a wider release distance before another
pinch can begin. That hysteresis prevents noisy landmarks from producing repeated clicks.

## Evaluation note

Thresholds should be recorded in normalized hand coordinates and tested across near, middle, and
far camera positions. False activations matter more than shaving a few milliseconds from selection,
but excessive dwell makes the graph feel unresponsive. Results feed into [[Prototype Review]], and
the informal observation in [[Field Note — 24 April 2026]] provides a scenario for replaying a slow,
deliberate pinch followed by an open-palm return.
