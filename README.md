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

Then open up `index.html` and it should display the new statistics.
