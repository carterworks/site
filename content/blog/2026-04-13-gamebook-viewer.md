---
title: "New Experiment: Gamebook Viewer"
pubDate: 2026-04-13
draft: false
---

The theme for my book club this month is "choose your own adventure" books. Turns out, Choose Your Own Adventure™ is a trademark of Random House. The generic name for the is gamebooks. It's a larger genre than I thought it might be. We're reading [_Neil Patrick Harris: Choose Your Own Autobiography_](https://fable.co/book/neil-patrick-harris-choose-your-own-autobiography-by-neil-patrick-harris-Rrnh6Z6qpY) ([Goodreads](https://www.goodreads.com/book/show/20170296-neil-patrick-harris)).

Someone in the group said that it might be fun to have everyone record their path and then we can compare and see how many people ended up where so I vibe coded a little web app to enable that. I am calling it the [Gamebook Viewer](/experiments/gamebook-viewer).

The most fun part was coming up with the domain specific language to describe the branching paths of a game book. It's pretty simple, but I did come up with a whole Backus-Naur form grammer to harken back to my college days.

```
<file> ::= <event> | <event> <newline> <file>
<event> ::= <eventid> <divider> <description> <newline> <choice-list>
<choice-list> ::= <choice> | <choice> <newline> <choice-list>
<choice> ::= <choiceid> <divider> <description>
<choiceid> ::= <choicemarker> "(" <eventid> ")"
<eventid> ::= <positive-integer>
<positive-integer> ::= <nonzero-digit> | <nonzero-digit> <digits>
<digits> ::= <digit> | <digit> <digits>
<digit> ::= "0" | <nonzero-digit>
<nonzero-digit> ::= "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
<choicemarker> ::= <uppercase-letter>
<uppercase-letter> ::= "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
                   | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"
<divider> ::= ". "
<description> ::= <text>
<text> ::= "" | <character> <text>
<character> ::= any character except newline
<newline> ::= "\n"
```

In practice, it looks like this:

```
1. You, Neil Patrick Harris, are born in Albuquerque, New Mexico, on June 15, 1973, at what you're pretty sure is St. Joseph's Hospital, although it's har...
A(3). If you would like to experience a happy childhood, go HERE .
B(2). If you would prefer to experience a miserable childhood that later in life you can claim to have heroically overcome, go HERE .

2. You, Neil Patrick Harris, are born in Albuquerque, New Mexico, on June 15, 1973. You're pretty sure it's in the backseat of a taxicab, but you can't be...
A(3). If you would like to experience a more wholesome childhood, go HERE .
B(94). If you are eager to meet your own children, skip ahead thirty years and go HERE .
```

With a setup like that, you can just write down your choices like `ABAACAB` to record your path. And then the webapp will just show them on the map. It'll even let you input multiple paths and you can see how many people made the same choices and ended up with the same ending.
