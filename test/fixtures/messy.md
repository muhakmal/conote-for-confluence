---
title: Import Torture Test & Friends
tags: [prd, draft]
aliases: whatever
status: DRAFT
author: Akmal Muhamad
---

# Import Torture Test & Friends

Intro with **bold**, _italic_, ~~strike~~, `code`, ==highlight==, a [link](https://example.com?a=1&b=2), an autolink https://example.org and entities &copy; &nbsp; &rarr; &unknownentity; plus a stray < less-than & ampersand.

Inline HTML: <kbd>Ctrl</kbd>+<kbd>K</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <span style="color:red">red</span>, <mark>marked</mark>, line<br>break, unclosed <b>bold
and a footnote[^1] and another[^note].

Setext heading
--------------

> [!info]- Obsidian callout (folded)
> Body with a [[Wiki Page|wiki link]] and [[Other Page#Section]].

> [!danger] Danger zone
> - item one
> - item two

> Plain blockquote
>> nested quote

1. First
   - nested bullet with `code`
     1. deep numbered
2. Second
	- tab indented

- [x] done task
- [ ] open task

| Col A | Col \| pipe | Right |
|:--|:-:|--:|
| a<br>b | **bold** | 1 |
| `x|y` | [l](http://x.y) | 2 |

<div align="center">
  <p>Centered <strong>HTML</strong> block</p>
  <img src="pixel.png" alt="px">
  <table><tr><td colspan=2>merged</td></tr><tr><td>1<td>2</tr></table>
</div>

<details>
<summary>Click <b>me</b> & see</summary>

Hidden **markdown** inside details.

</details>

![[pixel.png]]
![local](./pixel.png "title")
![missing](nope/missing.png)
![remote](https://example.com/a.png)

```mmd
graph TD
  A-->B
```

```puml
Alice -> Bob : hi
```

```js
if (a < b && c > d) console.log("]]>");
```

~~~
tilde fence <tag>
~~~

<script>alert(1)</script>
<iframe src="https://evil"></iframe>
<!-- html comment -->

Term with emoji :rocket: 🚀 and math $a^2$.

***

[^1]: First footnote.
[^note]: Named footnote with **bold**.
