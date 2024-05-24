# [carter.works](carter.works)

Favicon 🚘 from [Twitter's Twemoji](https://twemoji.twitter.com/).
👋 and ‹ from [Google's Noto Emoji](https://fonts.google.com/noto/specimen/Noto+Emoji).

# Blog post format

Blog posts are `/src/content/blog/*.mdx`. They are `[slug].mdx`. `title`, `pubDate`, and `description` are required frontmatter fields. `pubDate` is a string in the format `YYYY-MM-DD`. The `FormattedDate` component is used to format the date in the post.


```mdx
---
title: "Hello world!"
pubDate: 2024-01-02
description: "Why are there so many hello world posts and not more hello country posts? Start small, dummy."
---

import FormattedDate from "../../components/FormattedDate.astro";

# {frontmatter.title}

<FormattedDate date={frontmatter.pubDate} />

*{frontmatter.description}*

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Eleifend mi in nulla posuere sollicitudin aliquam ultrices. Luctus venenatis lectus magna fringilla urna porttitor rhoncus dolor. Suspendisse in est ante in nibh. Eros in cursus turpis massa tincidunt dui ut ornare. Porta lorem mollis aliquam ut porttitor leo. Eu volutpat odio facilisis mauris sit amet massa vitae. Amet nisl purus in mollis nunc sed id semper. Consequat id porta nibh venenatis cras sed felis. Purus faucibus ornare suspendisse sed nisi lacus sed. Maecenas volutpat blandit aliquam etiam erat velit scelerisque in. Penatibus et magnis dis parturient montes nascetur ridiculus mus. Lacus luctus accumsan tortor posuere. At auctor urna nunc id cursus. Risus nullam eget felis eget nunc lobortis mattis. Fringilla phasellus faucibus scelerisque eleifend. Imperdiet nulla malesuada pellentesque elit eget. Orci nulla pellentesque dignissim enim sit amet. Pellentesque diam volutpat commodo sed egestas.

![A 800 placeholder image saying "Hello world!"](https://placehold.co/600x400/10252C/DDD8CA?text=Hello+World "Hello world, but which world?")
_The image caption goes here lorem ipsum_

```
