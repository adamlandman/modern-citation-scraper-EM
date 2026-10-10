// Fetches citation statistics for each person from the OpenAlex API
// (https://docs.openalex.org) instead of scraping Google Scholar.
//
// Usage:
//   node fetch-openalex.js ./people-bmi.json > stats-openalex.js
//
// Writes a stats file in the same shape as stats-bmi.js to stdout, and a
// matching report (which OpenAlex author records were picked for whom, and
// why) to openalex-matches.json. Pin or fix a match by listing OpenAlex
// author IDs in openalex-ids.json, e.g. { "Adam Landman": ["A5012345678"] }.
//
// Optional environment variables:
//   OPENALEX_API_KEY  sent as api_key (raises rate limits)
//   OPENALEX_MAILTO   sent as mailto (OpenAlex "polite pool")

const fs = require('fs');
const path = require('path');

const API = 'https://api.openalex.org';
const HERE = __dirname;
const OVERRIDES_FILE = path.join(HERE, 'openalex-ids.json');
const MATCHES_FILE = path.join(HERE, 'openalex-matches.json');

// An OpenAlex author record counts as "ours" when one of its institutions
// matches one of these (case-insensitive substrings).
const LOCAL_INSTITUTIONS = [
  'harvard', 'brigham', 'massachusetts general', 'mass general', 'faulkner',
  'boston', 'beth israel', 'spaulding', 'mclean',
];

// Scholar's second column is "since <year>": citations received in the last
// five calendar years plus the current one.
const SINCE_YEAR = new Date().getFullYear() - 5;

// OpenAlex allows a few requests per second; stay well under it.
const REQUEST_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(pathAndQuery) {
  const url = new URL(API + pathAndQuery);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO) url.searchParams.set('mailto', process.env.OPENALEX_MAILTO);

  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_DELAY_MS);
    const resp = await fetch(url);
    if (resp.ok) return resp.json();
    if ((resp.status === 429 || resp.status >= 500) && attempt < 6) {
      const retryAfter = Number(resp.headers && resp.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`OpenAlex ${resp.status} for ${url.pathname}${url.search.replace(/api_key=[^&]+/, 'api_key=***')}`);
  }
}

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "Carlos A Camargo, Jr." -> { first: "carlos", last: "camargo" }
function nameParts(name) {
  const tokens = normalize(name.replace(/,?\s*(jr|sr|ii|iii)\.?$/i, ''))
    .split(' ').filter((t) => t.length > 1);
  return { first: tokens[0], last: tokens[tokens.length - 1], tokens };
}

// Compares against display_name only: OpenAlex's display_name_alternatives
// often contain co-authors' names. A middle initial, when both sides have
// one, must agree ("Joshua W Joseph" is not "Joshua J. Joseph").
function nameMatches(person, author) {
  const { first, last, tokens } = nameParts(person);
  const t = normalize(author.display_name).split(/[\s-]+/).filter(Boolean);
  const lastAt = t.lastIndexOf(last);
  if (lastAt < 0) return false;
  const others = t.filter((_, i) => i !== lastAt);
  const firstAt = others.findIndex((x) => x === first || (x.length === 1 && x === first[0]));
  if (firstAt < 0) return false;
  const ourMiddles = tokens.slice(1, -1).concat(
    normalize(person).split(' ').filter((x) => x.length === 1)).map((x) => x[0]);
  const theirMiddles = others.filter((_, i) => i !== firstAt).map((x) => x[0]);
  if (ourMiddles.length && theirMiddles.length) {
    return theirMiddles.some((m) => ourMiddles.includes(m));
  }
  return true;
}

function institutions(author) {
  const names = new Set();
  (author.last_known_institutions || []).forEach((i) => names.add(i.display_name));
  (author.affiliations || []).forEach((a) => a.institution && names.add(a.institution.display_name));
  return [...names].filter(Boolean);
}

const local = (names) => names.some((i) => LOCAL_INSTITUTIONS.some((k) => i.toLowerCase().includes(k)));

// "current" when the author's most recent institution is local, "past" when
// only an earlier affiliation was.
function localness(author) {
  if (local((author.last_known_institutions || []).map((i) => i.display_name))) return 'current';
  return local(institutions(author)) ? 'past' : null;
}

const isLocal = (author) => localness(author) !== null;

const doesEmergencyMedicine = (author) => (author.topics || [])
  .some((t) => /emergenc|trauma|toxicolog|resuscitat|critical care/i.test(
    [t.display_name, t.subfield && t.subfield.display_name].join(' ')));

function score(person, author) {
  return (nameMatches(person, author) ? 1 : 0)
    + ({ current: 3, past: 1 }[localness(author)] || 0)
    + (doesEmergencyMedicine(author) ? 1 : 0);
}

// Searches the name as written, then "First Last" only if that finds no one.
async function searchAuthors(name) {
  const { first, last } = nameParts(name);
  const queries = [...new Set([name.replace(/,?\s*Jr\.?$/i, ''), `${first} ${last}`])];
  const seen = new Map();
  for (const q of queries) {
    const res = await api(`/authors?search=${encodeURIComponent(q)}&per_page=25`);
    res.results.forEach((a) => seen.set(a.id, a));
    if ([...seen.values()].some((a) => nameMatches(name, a) && isLocal(a))) break;
  }
  return [...seen.values()];
}

// Picks the OpenAlex author records for one person. OpenAlex often splits a
// person's work across several records, so besides the best match, every
// record that matches the name and is currently at a local institution is
// kept too.
async function matchPerson(name, overrides) {
  if (overrides[name]) {
    const ids = overrides[name].map((id) => id.replace(/^https?:\/\/openalex\.org\//, ''));
    const res = await api(`/authors?filter=openalex:${ids.join('|')}&per_page=${ids.length}`);
    return { authors: res.results, method: 'override', candidates: [] };
  }

  const candidates = (await searchAuthors(name))
    .map((a) => ({ author: a, score: score(name, a) }))
    .sort((x, y) => y.score - x.score || y.author.cited_by_count - x.author.cited_by_count);

  const named = candidates.filter((c) => nameMatches(name, c.author) && isLocal(c.author));
  const accepted = named.filter((c, i) => i === 0 || localness(c.author) === 'current');
  return {
    authors: accepted.map((c) => c.author),
    // "check": the best record only had a local affiliation in the past.
    method: !accepted.length ? 'unmatched'
      : localness(accepted[0].author) === 'current' ? 'search' : 'check',
    candidates: candidates.slice(0, 5).map((c) => ({
      id: c.author.id, name: c.author.display_name, score: c.score,
      works: c.author.works_count, citations: c.author.cited_by_count,
      institutions: institutions(c.author).slice(0, 3),
    })),
  };
}

async function fetchWorks(authorIds) {
  const works = [];
  let cursor = '*';
  const filter = `author.id:${authorIds.join('|')}`;
  while (cursor) {
    const res = await api(`/works?filter=${filter}&select=id,cited_by_count,counts_by_year,publication_year&per_page=200&cursor=${encodeURIComponent(cursor)}`);
    works.push(...res.results);
    cursor = res.meta.next_cursor;
  }
  return works;
}

function hIndex(counts) {
  const sorted = counts.slice().sort((a, b) => b - a);
  let h = 0;
  while (h < sorted.length && sorted[h] >= h + 1) h++;
  return h;
}

// Computes Scholar-style [all time, since SINCE_YEAR] pairs from works.
function statsFromWorks(works) {
  const all = works.map((w) => w.cited_by_count);
  const recent = works.map((w) => (w.counts_by_year || [])
    .filter((c) => c.year >= SINCE_YEAR)
    .reduce((sum, c) => sum + c.cited_by_count, 0));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const i10 = (xs) => xs.filter((x) => x >= 10).length;
  return {
    citations: [String(sum(all)), String(sum(recent))],
    hindex: [String(hIndex(all)), String(hIndex(recent))],
    i10index: [String(i10(all)), String(i10(recent))],
  };
}

async function main() {
  const people = require(path.resolve(process.argv[2] || './people-bmi.json'));
  const overrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {};
  const data = [];
  const matches = {};

  for (const name of Object.keys(people)) {
    // We're output to stdout, so log to stderr
    console.error(`Fetching ${name}...`);
    try {
      const match = await matchPerson(name, overrides);
      matches[name] = {
        method: match.method,
        ids: match.authors.map((a) => a.id),
        candidates: match.candidates,
      };
      if (!match.authors.length) {
        console.error(`  no OpenAlex match for ${name}`);
        data.push({});
        continue;
      }

      const ids = match.authors.map((a) => a.id.replace('https://openalex.org/', ''));
      const works = await fetchWorks(ids);
      const primary = match.authors[0];
      const years = works.map((w) => w.publication_year).filter(Boolean);
      data.push({
        name,
        url: primary.id,
        affiliation: (primary.last_known_institutions || []).map((i) => i.display_name).join('; '),
        keywords: (primary.topics || []).slice(0, 4).map((t) => t.display_name),
        stats: statsFromWorks(works),
        year: years.length ? String(Math.min(...years)) : '',
        openalex_ids: ids,
        openalex_match: match.method,
      });
    } catch (err) {
      console.error(`  error with ${name}: ${err.message}`);
      matches[name] = { method: 'error', error: err.message, ids: [] };
      data.push({});
    }
  }

  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2) + '\n');
  console.log('var date = "' + new Date() + '"');
  console.log('var source = "OpenAlex"');
  console.log('var since = ' + SINCE_YEAR);
  console.log('var data = ' + JSON.stringify(data, null, 2) + ';');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { nameParts, nameMatches, isLocal, localness, hIndex, statsFromWorks };
