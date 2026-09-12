# Demo video

`screenmate-demo.mp4` — 112s, 1440×900. Comes in under a two-minute cap rather
than exactly on it, since "under 2 minutes" is usually enforced literally.

## It is a real recording

Nothing is staged or reconstructed. `record.js` installs the actual extension
into a throwaway Chrome profile, opens the four-step application form, and films
whatever the agent does against the live backend. The run in this cut ended with
`submitted: false | step: 3` — it reached the final step and did not submit.

Captions are overlaid live during the run, so the footage needs no editing pass.

## Rebuilding it

```bash
npm run fixture:serve      # serves the form on :8099
node demo/record.js        # films a run -> demo/screenmate-raw.mp4
node demo/cut.js           # trims to 112s -> demo/screenmate-demo.mp4
node demo/cut.js 95        # or any other target length
```

The cut keeps the title and closing cards at natural speed because they have to
be read, and compresses only the working middle. Same take, tightened.

Requires the fixture server and a reachable backend (`extension/config.json`).
Re-recording produces a genuinely different run — the agent's wording and timing
change, and so may the number of steps it needs.

## What the two minutes show

| | |
|---|---|
| 0:00 | The problem: the assistant never saw the form |
| 0:07 | A four-step application the agent has never seen |
| 0:15 | It detects the form and offers itself |
| 0:22 | Reads the live DOM, asks the server what it may touch |
| 0:30 | States what is missing before touching anything |
| 0:40 | Decides research is warranted, calls Exa, names its sources |
| 0:55 | Real tool calls, each re-read from the page to confirm it landed |
| 1:10 | Sensitive questions answered from standing answers, never by the agent |
| 1:25 | Fills a step, verifies, clicks Next, re-reads the new page |
| 1:38 | Stops at Submit — the one button it will never press |
| 1:52 | Closing card |

`poster.jpg` is a thumbnail from the title card.
