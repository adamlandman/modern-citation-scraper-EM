Scholar Scraper
===============

This tool was created based on the work of Allison McCoy at Vanderbilt University Medical Center and Jimmy Lin at University of Waterloo.  It scrapes citation statistics of researcher profiles on [Google Scholar](http://scholar.google.com/), and began with a list of information retrieval researchers, then was expanded to informatics, and now emergency medicine.

**Editorial note**: This list contains only researchers who have a Google Scholar profile; names were identified by snowball sampling and various other *ad hoc* techniques. If you wish to see a name added, please email me or send a pull request. I will endeavor to periodically run the crawl to gather updated statistics. Of course, scholarly achievement is only partially measured by citation counts, which are known to be flawed in many ways. Evaluations of scholars should include comprehensive examination of their research contributions.

Rerunning the Scraper
---------------------

Assuming you have [node.js](http://nodejs.org/) installed, rerun the scraper as follows:

```
$ npm install request cheerio async
$ node scrape.js ./people-bmi.json > stats-bmi.js

Each run also adds a dated snapshot of every person's citations, h-index and i10-index to `history-bmi.js` (rerunning on the same day replaces that day's snapshot). `index.html` uses it to show an h-index trend line and the change since each person's earliest snapshot. Commit `history-bmi.js` along with `stats-bmi.js` so the history is kept.

To backfill history from an older stats file:

```
$ node history.js ./stats-bmi.js ./history-bmi.js
```

Then open up `index.html` and it should display the new statistics.

Fetching from OpenAlex
----------------------

`fetch-openalex.js` gets the same statistics from the free [OpenAlex](https://openalex.org/) API instead of scraping Scholar (Node 18+, no dependencies):

```
$ node fetch-openalex.js ./people-bmi.json > stats-openalex.js
$ node compare-openalex.js stats-bmi.js stats-openalex.js
```

It writes the OpenAlex author records it picked for each person to `openalex-matches.json`. To correct a match, list the right IDs in `openalex-ids.json`, e.g. `{ "Adam Landman": ["A5002790663"] }`. Set `OPENALEX_API_KEY` to avoid rate limits. The `OpenAlex fetch` GitHub workflow runs both scripts and attaches the results.

Automatic weekly updates
------------------------

The `Update citation data` GitHub workflow runs every Monday (and on demand from the Actions tab). It runs `node update-openalex.js ./people-bmi.json`, which fetches everyone from OpenAlex, rewrites `stats-openalex.js`, adds a dated snapshot to `history-openalex.js`, and commits both to `main`. GitHub Pages serves `index.html` from `main`, so that commit is what publishes the new numbers. If fewer than 90% of people come back, nothing is written and the run fails, so a bad week never replaces good data.

`index.html` shows the OpenAlex files when they exist and otherwise falls back to the Google Scholar `stats-bmi.js`.
