---
title: "New Experiment: Claude Code Buddy Creator"
pubDate: 2026-03-30
description:
draft: false
tags:
  - llms
---

Correctly packaging an `npm` package is hard. It's certainly something that I've struggled with at work and spent many hours on. So it's understandable that even Anthropic and Claude could do it wrong. Xitter user @fried_rice [noticed that Anthropic accidentally distributed the source map.](https://x.com/Fried_rice/status/2038894956459290963). Revealed in the source code were lots of interesting things, including leaks to upcoming model with fun animal-themed code names and the full list of verbs that Claude Code may show when "reticulating".

But m my favorite is Anthropic's upcoming April Fool's Day project: buddies. You run `/buddy` in Claude Code and a little ASCII friend is generated for you. He has a name, a personality, some stats, a species, a hat, some eyes, and a rarity. they can even be shiny, just like Pokémon.

I wanted to see all the permutations, so I copied the source code and vibed a new little experiment. It uses [Cheng Lou's incredible `pretext` library](https://github.com/chenglou/pretext) for some rendering.

[Go make a buddy!](/experiments/claude-code-buddy-creator) I will probably update this a little bit. once the buddy feature is officially released. But for now you can share your buddy as a URL or copy it as ASCII text. Or you can just screenshot it.

![](assets/Pasted%20image%2020260331123901.png)
DDRRAMS–a certified lil' guy.

Update 2026-04-01: the official `/buddy` cards are out now, so I refreshed this experiment to match the new card contents as close as possible

My buddy:

```
╭──────────────────────────────────────╮
│                                      │
│  ★ COMMON                       OWL  │
│                                      │
│     /\  /\                           │
│    ((×)(×))                          │
│    (  ><  )                          │
│     `----´                           │
│                                      │
│  Cobblewick                          │
│                                      │
│  "A methodical night-shifter with a  │
│   steel-wool tongue, quick to point  │
│   out logical gaps but patient       │
│  enough to sit through your entire   │
│  rubber-duck session without flying  │
│   off."                              │
│                                      │
│  DEBUGGING  █░░░░░░░░░   8           │
│  PATIENCE   ███████░░░  67           │
│  CHAOS      ███░░░░░░░  33           │
│  WISDOM     ██░░░░░░░░  22           │
│  SNARK      ████░░░░░░  36           │
│                                      │
╰──────────────────────────────────────╯
```
