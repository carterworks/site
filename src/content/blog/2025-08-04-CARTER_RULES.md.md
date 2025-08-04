---
title: CARTER_RULES.md
pubDate: 2025-08-04
tags:
  - style
  - programming
  - css
---

_Last updated: 2025-08-04._

_Like a `.cursor/rules.md` or `CLAUDE.md` file, but for me._

_I thought it might an interesting meditation to try and figure out what rules I personally follow when writing code. This is a _strong opinions, loosely held_ approach to things—I'll do what I think is best, but I'm pretty easily convinced to pick something else, especially if you seem like you care. I don't know—Convince me there's a better approach 😜._

## Coding style related.
* Use [`oklch`](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) for colors. It is easier to adjust the colors than `rgb`.
* Tabs vs. spaces? Doesn't matter. Use whatever the convention on the project/language is.
* Pure functions are ideal. (Are pure functions+closures just classes?)
* Return early to avoid indentation

```js
// ❌ bad
function foo(bar) {
  if (bar) {
    // blah blah blah
    // blah blah blah
    // blah blah blah
  }
  return true;
}

// ✅ good
function foo(bar) {
  if (!bar) return true;
  // blah blah blah
  // blah blah blah
}
```

* Documentation and code should live as close as possible to what they are documenting/describing.
* Tailwind is a good base for design tokens.
* Tailwind is not a design system.
* Prefer many simple functions that [complect together](https://www.infoq.com/presentations/Simple-Made-Easy/) over a few complex functions.
* Microservices are a solution to a people-organization problem, not a technical one.
* Start with a simple, bad solution and keep it until the shortcomings are obvious.
* DRY is overrated. It's okay to repeat yourself, maybe four or five times even.
  * [Dan Abramov, "The WET Codebase"](https://overreacted.io/the-wet-codebase/) aka sometimes the subtle differences between branches are worth the duplication.
  * [shadcn/ui](https://ui.shadcn.com/docs) has a principle of "open code" because of "full transparency and easy customization".
* [Make bad states impossible](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) as much as possible.

## Coding architecture and ecosystem related.
* Unit tests are mostly useless. They provide quick feedback, sure, but the also tightly couple your code to the test framework and to whatever your current implementation is. Prefer integration and end-to-end tests, mocking as little as possible and only at the boundaries of your codebase.
* Rules are useless unless enforced. Enforcement should be automated.
* [Choose boring technology](https://boringtechnology.club/). 
  * If your goal is to build a cool app, spend your time building the cool app, not inventing a new design system or coming up with the perfect build system paradigm. 
  * Said differently, "do what makes you money." aka do what differentiates you from your competitors.
  * Said tangentially, if you find yourself [bikeshedding](https://en.wikipedia.org/wiki/Law_of_triviality), you're just avoiding real work. Go find real work that motivates you. But also if coming up with new design systems is your favorite thing, have fun and don't worry about having a place to put it yet.
* Carter's rules of project naming:
  * Names set the vibe/tone for the project.
  * A name should be:
    * Easily pronouncable in your main language (so you can talk about it out loud).
    * Easily internet-searchable (so users can find it).
  * Uniqueness does not matter, but proximity does matter. It's okay if you want to write a new programming language and call it "frosted-flakes" because no one will confuse the programming language with the cereal. It's not okay if you want to call your new programming language "gopherlang" because that's too close to "golang". Use the American standard of "would this confuse the reasonable consumer?"
  * Apollo is a bad name. So are most Greek mythology names. (Guilty.)
* "Ease of use" (including "ease of maintenance") is a very high priority.
* Convention over configuration. Most people don't want to read, they want to get things done. Not to say that "[ricing](https://www.reddit.com/r/unixporn)" (term used broadly) is a bad hobby (it's a good hobby!) but configuration can get in the way.
* In our age of LLMs, if you are going to use one to write a message to send to me, just send me what you told the LLM.


## Not coding related.
* Be honest, even with yourself, about what your goals are. 
* If you have an expectation, make it explicit and communicate it as early as possible.
* [There is no silver bullet.](https://en.wikipedia.org/wiki/No_Silver_Bullet).
* Do what helps you sleep best at night.
* Waiting for consenus sucks. Document your decisions and reasoning and move forward as best you can, then be flexible. This does not mean you should be a cowboy/rockstar coder and be insensitive to the needs of others. It means that it's okay to have confidence in your decision and move forward. 
* Humility and confidence are not mutually exclusive.
* "It's about finding the right balance." is always true, but is only the start of something useful.
* Instead of saying "sorry", say "thank you".
* Ask "what do you need right now?" often.
* Don't let perfect be the enemy of good enough.
* [It's cool to be nice](https://catskull.net/its-cool-to-be-nice.html). Root for everyone (except for the overconfident).
* [The 80/20 rule](https://en.wikipedia.org/wiki/Pareto_principle) is often useful (80% of the time?). Pick something that will get you 80% of the way there quickly.
* Em-dashes are cool.
* Know when to stop selling. Stop talking after you've already won.
* “We suffer more often in imagination than in reality.”—Seneca, _Letter 13, On groundless fears_
* "A ship in harbor is safe, but that is not what ships are built for."—John A. Shedd, _Salt from My Attic_
* Metaphors are cool.
* Resist the urge to read the comments. At least, resist the urge to read the comments first.
* "God, grant me the serenity to accept the things I cannot change, the courage to change the things I can, and the wisdom to know the difference."—[Reinhold Niebuhr](https://en.wikipedia.org/wiki/Serenity_Prayer)
  * aka spend your time on the things you have the power to change.
