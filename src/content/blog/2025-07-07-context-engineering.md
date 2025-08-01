---
title: Context isn't just for LLMs
pubDate: 2025-07-07
description: A file-based workflow
tags:
  - links
  - git
  - llms
---

[Matt Pocock shares "one weird git thing for local development"](https://x.com/mattpocockuk/status/1941907646161777072)

> The one weird thing I always put in my .gitignore:
>
> \*.local.\*
>
> Makes it super simple to create temporary local scripts (fix-names.local.js)
>
> Or save outputs as json (output.local.json)
>
> Started doing this so many years ago but I guess I only just remembered no-one else does it.

At work, I recently attended a training on Cursor background agents hosted by Anysphere employees. In the demonstration, [Nick Miller](https://x.com/nickwm?lang=en) created a local directory and filled it with context—mockups, an implementation plan, a TODO list—anything relevant to the implementation of some features in his example repo. Of course, this context was fed into an LLM that started implementing features, but this model of development doesn't need to be restricted to LLM usage.

I've recently tried out this pattern for some tasks at work. I'll create a `.local` folder in the repo which is ignored in my global `.gitignore` file, create a file for a Jira ticket, copy in the text, screenshots, and comments into the file, then start annotating my work plan. I'll paste in API calls, TODOs, attempts—anything that might be relevant to the issue. It has really helped me feel more organized in these issues. It also makes the handoff to an LLM easier if I wanted to go that route, but I haven't tried it out yet.

This fits into the larger, recent trend of [context engineering](https://simonwillison.net/2025/Jun/27/context-engineering/). We need to define and shape the area that we are working in. Make the implicit things explicit. If you jump between many issues and projects, that context of implicit definitions and paths and ideas is much more difficult to reenter. These local context files have really helped me jump back into these issues. I also predict that this context sharing will be more and more important as a LLMs become a more common and more capable tool in the repertoire of the modern human.

**Short version:** I like to take notes on my tasks and fill them with as much context as I can. It's helpful for me but also can benefit LLMs if you chose to use them.

**Closing thought:**

> Context is everything, its like feeding cookies to the cookie monster. It’s a way of bootstrapping LLM memory but actually targeted so it works well.

from ["God is hungry for Context: First thoughts on o3 pro" by Alexis Gauba and Ben Hylak of latent.space and raindrop.io](https://www.latent.space/p/o3-pro)
