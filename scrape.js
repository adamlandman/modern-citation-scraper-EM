// Originally based on http://blog.miguelgrinberg.com/post/easy-web-scraping-with-nodejs
//
// Usage: node scrape.js ./people-bmi.json [stats-bmi.js]
//
// With an output path, the file is only written when at least one profile was
// scraped, so a run that gets blocked by Google Scholar keeps the old stats.
// Without one, output goes to stdout as before. Progress and errors go to stderr.

var fs = require('fs');
var path = require('path');
var cheerio = require('cheerio');

var MAX_ATTEMPTS = 3;
var DELAY_MS = 1000;
var USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';

var sleep = function(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

// Errors we should not retry: a captcha or a page that isn't a profile won't
// get better by asking again right away.
var FatalError = function(message) {
  this.name = 'FatalError';
  this.message = message;
};
FatalError.prototype = Object.create(Error.prototype);

var isBlocked = function(resp, body) {
  return resp.status === 429 ||
         /\/sorry\//.test(resp.url) ||
         /gs_captcha|recaptcha|unusual traffic/i.test(body);
};

var fetchProfile = async function(url) {
  var lastErr;
  for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      var resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(30000)
      });
      var body = await resp.text();
      if (isBlocked(resp, body)) throw new FatalError('blocked by captcha / rate limit (HTTP ' + resp.status + ')');
      if (resp.status === 404) throw new FatalError('profile not found (HTTP 404)');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return body;
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        var wait = DELAY_MS * Math.pow(2, attempt);
        console.error('  attempt ' + attempt + ' failed (' + err.message + '), retrying in ' + wait / 1000 + 's');
        await sleep(wait);
      }
    }
  }
  throw new Error('failed after ' + MAX_ATTEMPTS + ' attempts: ' + lastErr.message);
};

var parseProfile = function(person, url, body) {
  var $ = cheerio.load(body);

  var statsTable = $('#gsc_rsb_st');
  if (statsTable.length === 0) throw new FatalError('no citation table on page (not a public profile?)');

  // Rows are Citations, h-index, i10-index; columns are "All" and "Since <year>".
  var rows = statsTable.find('tbody tr').toArray().map(function(tr) {
    return $(tr).find('td.gsc_rsb_std').toArray().map(function(td) { return $(td).text().trim(); });
  });
  if (rows.length < 3 || rows.some(function(r) { return r.length < 2; })) {
    throw new FatalError('citation table has an unexpected layout');
  }

  var keywords = $('#gsc_prf_int a').toArray().map(function(a) { return $(a).text().trim(); });

  return {
    'name' : person,
    'url': url,
    'affiliation' : $('.gsc_prf_il', '#gsc_prf_i').first().text(),
    'keywords' : keywords,
    'stats' : {
      'citations' : rows[0].slice(0, 2),
      'hindex'    : rows[1].slice(0, 2),
      'i10index'  : rows[2].slice(0, 2)
    },
    'year' : $('.gsc_md_hist_b').children().first().text().trim()
  };
};

var main = async function() {
  if (!process.argv[2]) {
    console.error('Usage: node scrape.js ./people.json [output.js]');
    process.exit(2);
  }
  var people = require(path.resolve(process.argv[2]));
  var outFile = process.argv[3];

  var names = Object.keys(people);
  var results = [];
  var failures = [];

  for (var i = 0; i < names.length; i++) {
    var person = names[i];
    var url = people[person];
    console.error('Scraping ' + person + ' (' + (i + 1) + '/' + names.length + ')...');
    try {
      var body = await fetchProfile(url);
      results.push(parseProfile(person, url, body));
    } catch (err) {
      console.error('  SKIPPED ' + person + ': ' + err.message);
      failures.push({ name: person, url: url, error: err.message });
    }
    // Regulate scraping speed.
    if (i < names.length - 1) await sleep(DELAY_MS);
  }

  console.error('\nScraped ' + results.length + ' of ' + names.length + ' profiles.');
  if (failures.length > 0) {
    console.error('Skipped ' + failures.length + ':');
    failures.forEach(function(f) { console.error('  - ' + f.name + ': ' + f.error + ' (' + f.url + ')'); });
  }

  var output = 'var date = "' + new Date() + '"\n' +
               'var data = ' + JSON.stringify(results, null, 2) + ';\n';

  if (outFile) {
    if (results.length === 0) {
      console.error('No profiles scraped; leaving ' + outFile + ' unchanged.');
      process.exit(1);
    }
    fs.writeFileSync(outFile, output);
    console.error('Wrote ' + outFile);
  } else {
    process.stdout.write(output);
    if (results.length === 0) process.exit(1);
  }
};

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
