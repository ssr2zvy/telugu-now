#!/usr/bin/env python3
"""A resumable, auditable Telugu Wikipedia corpus collector. Python 3.10+, stdlib only."""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import html.parser
import io
import json
import math
from pathlib import Path
import re
import sqlite3
import sys
import time
import unicodedata as ud
import urllib.error
import urllib.parse
import urllib.request
import zipfile

VERSION = "1.0"
BASE = Path(__file__).resolve().parent
TE_API = "https://te.wikipedia.org/w/api.php"
EN_API = "https://en.wikipedia.org/w/api.php"
JOINERS = "\u200c\u200d"
CONNECTORS = "_-'’‐‑"
USER_AGENT = "TeluguCorpusCollector/1.0 (100-article educational frequency study; Python urllib)"


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def is_lexical(c):
    return ud.category(c)[0] in "LMN" or c in JOINERS or c == "_"


def clean_word(raw):
    """Return a normalized Telugu-only token, or None. Never extract a substring."""
    word = ud.normalize("NFC", raw).translate({ord(c): None for c in JOINERS})
    if not word or ud.category(word[0])[0] != "L":
        return None
    if all("\u0c00" <= c <= "\u0c7f" and ud.category(c)[0] in "LM" for c in word):
        return word
    return None


def token_spans(text):
    """Yield raw lexical candidates, including rejected mixed-script/number tokens."""
    i = 0
    while i < len(text):
        if not is_lexical(text[i]):
            i += 1
            continue
        start = i
        i += 1
        while i < len(text):
            if is_lexical(text[i]):
                i += 1
            elif text[i] in CONNECTORS and i + 1 < len(text) and is_lexical(text[i + 1]):
                i += 1
            else:
                break
        raw = text[start:i]
        yield start, i, raw, clean_word(raw)


ABBREVIATIONS = {"డా", "డాక్టర్", "ప్రొ", "శ్రీ", "చి", "క్రీ", "శ", "సం", "ఉదా", "Dr", "Prof", "Mr", "Mrs", "St", "e.g", "i.e"}


def sentence_spans(paragraph):
    """Punctuation heuristic; preserve exact paragraph offsets and final fragments."""
    start = 0
    for match in re.finditer(r"[.!?।॥]+[\"'”’\)\]]*(?=\s|$)", paragraph):
        prefix = paragraph[start:match.start()].rstrip()
        last = prefix.split()[-1] if prefix.split() else ""
        if match.group().startswith(".") and (
            last in ABBREVIATIONS or (len(last) <= 3 and sum(ud.category(c)[0] == "L" for c in last) == 1)
        ):
            continue
        end = match.end()
        while start < end and paragraph[start].isspace():
            start += 1
        if start < end:
            yield start, end, paragraph[start:end]
        start = end
    while start < len(paragraph) and paragraph[start].isspace():
        start += 1
    if start < len(paragraph):
        yield start, len(paragraph), paragraph[start:]


class Node:
    def __init__(self, tag="root", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []


class TreeParser(html.parser.HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


EXCLUDED_TAGS = {"table", "figure", "figcaption", "script", "style", "noscript", "nav", "aside", "sup", "math", "svg", "ol", "ul"}
EXCLUDED_CLASSES = {"infobox", "navbox", "vertical-navbox", "sidebar", "hatnote", "metadata", "ambox", "tmbox", "ombox", "fmbox", "mbox-small", "thumb", "gallery", "reflist", "references", "reference", "mw-editsection", "mw-empty-elt", "shortdescription", "noprint", "sistersitebox", "authority-control", "mw-authority-control", "mw-cite-backlink"}
EXCLUDED_SECTIONS = {"మూలాలు", "వనరులు", "మూలాలు, వనరులు", "మూలాలు మరియు వనరులు", "ఇవి కూడా చూడండి", "ఇవి కూడా చూడండి.", "బయటి లింకులు", "బాహ్య లింకులు", "బయటి లంకెలు", "బాహ్య లంకెలు", "ఇతర లింకులు", "సూచనలు", "గ్రంథసూచి", "గ్రంథాలు", "నోట్స్", "references", "external links", "see also", "bibliography", "further reading", "notes"}


def excluded(node):
    classes = set((node.attrs.get("class") or "").split())
    style = (node.attrs.get("style") or "").replace(" ", "").lower()
    return node.tag in EXCLUDED_TAGS or bool(classes & EXCLUDED_CLASSES) or "display:none" in style or node.attrs.get("aria-hidden") == "true"


def node_text(node):
    if isinstance(node, str):
        return node
    if excluded(node):
        # Keep removed inline content from gluing together surrounding words.
        return " "
    if node.tag == "br":
        return " "
    return "".join(node_text(child) for child in node.children)


def extract_paragraphs(markup):
    parser = TreeParser()
    parser.feed(markup)
    headings = {}
    skip_level = None
    paragraphs = []

    def walk(node):
        nonlocal skip_level
        if isinstance(node, str) or excluded(node):
            return
        if re.fullmatch(r"h[1-6]", node.tag):
            level = int(node.tag[1])
            title = " ".join(node_text(node).split())
            headings.update({level: title})
            for k in list(headings):
                if k > level:
                    del headings[k]
            if skip_level is not None and level <= skip_level:
                skip_level = None
            if title.casefold() in EXCLUDED_SECTIONS:
                skip_level = level
            return
        if node.tag == "p":
            text = " ".join(node_text(node).split())
            if text and skip_level is None:
                paragraphs.append({"section": " / ".join(headings[k] for k in sorted(headings)), "text": text})
            return
        for child in node.children:
            walk(child)

    walk(parser.root)
    return paragraphs


class APIError(RuntimeError):
    pass


class WikiClient:
    def __init__(self, cache, delay=1.0, user_agent=USER_AGENT):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.delay, self.user_agent, self.last_request = delay, user_agent, 0.0

    def request(self, endpoint, **params):
        params.update(format="json", formatversion=2, maxlag=5)
        url = endpoint + "?" + urllib.parse.urlencode(sorted(params.items()))
        key = hashlib.sha256(url.encode()).hexdigest()
        path = self.cache / (key + ".json.gz")
        if path.exists():
            with gzip.open(path, "rt", encoding="utf-8") as f:
                return json.load(f)
        for attempt in range(4):
            wait = max(0, self.delay - (time.monotonic() - self.last_request))
            if wait:
                time.sleep(wait)
            self.last_request = time.monotonic()
            req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "application/json", "Accept-Encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=45) as response:
                    raw = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                data = json.loads(raw)
                if "error" in data:
                    code = data["error"].get("code")
                    if code in {"maxlag", "ratelimited", "readonly"} and attempt < 3:
                        time.sleep(5 * (attempt + 1))
                        continue
                    raise APIError(str(data["error"]))
                envelope = {"request_url": url, "retrieved_at": utcnow(), "payload_sha256": hashlib.sha256(raw).hexdigest(), "data": data, "cache_file": path.name}
                temporary = path.with_suffix(".tmp")
                with gzip.open(temporary, "wt", encoding="utf-8") as f:
                    json.dump(envelope, f, ensure_ascii=False)
                temporary.replace(path)
                return envelope
            except urllib.error.HTTPError as exc:
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 3:
                    raise
                retry = exc.headers.get("Retry-After", "")
                seconds = float(retry) if retry.isdigit() else 2 ** (attempt + 1)
                if seconds > 30:
                    raise APIError(f"Server requested a {seconds}s pause; rerun later to resume") from exc
                time.sleep(seconds)
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
        raise APIError("Retry limit reached")


def discover(client, seeds, out):
    path = out / "selection.json"
    seed_hash = hashlib.sha256(json.dumps(seeds, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    previous = None
    previous_hashes = []
    if path.exists():
        selection = json.loads(path.read_text(encoding="utf-8"))
        if selection["seed_sha256"] == seed_hash:
            return selection
        if list(seeds) != list(selection["groups"]) or any(
            seeds[topic][:len(items)] != [item["seed_title"] for item in items]
            for topic, items in selection["groups"].items()
        ):
            raise ValueError("Only appending candidates to existing subjects is allowed when resuming. Use a new directory for other seed changes.")
        previous = selection
        previous_hashes = selection.get("previous_seed_sha256s", []) + [selection["seed_sha256"]]
        save_json(out / ("selection-" + selection["seed_sha256"][:12] + ".json"), selection)
    titles = list(dict.fromkeys(t for group in seeds.values() for t in group))
    links, aliases = {}, {}
    if previous:
        known = {}
        for items in previous["groups"].values():
            for item in items:
                known[item["seed_title"]] = item
                aliases[item["seed_title"]] = item["resolved_english_title"]
                if item["telugu_title"]:
                    links[item["resolved_english_title"]] = item["telugu_title"]
        titles = [title for title in titles if title not in known]
    for offset in range(0, len(titles), 40):
        batch = titles[offset:offset + 40]
        continuation = {}
        while True:
            data = client.request(EN_API, action="query", titles="|".join(batch), prop="langlinks", lllang="te", lllimit=500, redirects=1, **continuation)["data"]
            query = data["query"]
            for item in query.get("normalized", []) + query.get("redirects", []):
                aliases[item["from"]] = item["to"]
            for page in query["pages"]:
                for link in page.get("langlinks", []):
                    links[page["title"]] = link["title"]
            if "continue" not in data:
                break
            continuation = data["continue"]
        print(f"Resolved language links: {min(offset + 40, len(titles))}/{len(titles)} candidates", flush=True)
    groups = {}
    for topic, candidates in seeds.items():
        groups[topic] = []
        for title in candidates:
            resolved = title
            seen = set()
            while resolved in aliases and resolved not in seen:
                seen.add(resolved)
                resolved = aliases[resolved]
            groups[topic].append({"seed_title": title, "resolved_english_title": resolved, "telugu_title": links.get(resolved)})
    selection = {"created_at": utcnow(), "method": "fixed candidate order; append-only replacements for subject shortfalls; equal article quota per subject; not a random population sample", "seed_sha256": seed_hash, "previous_seed_sha256s": previous_hashes, "groups": groups}
    save_json(path, selection)
    return selection


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (
 page_id INTEGER PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, seed_title TEXT NOT NULL,
 url TEXT NOT NULL, revision_id INTEGER NOT NULL, permanent_url TEXT NOT NULL, history_url TEXT NOT NULL,
 retrieved_at TEXT NOT NULL, payload_sha256 TEXT NOT NULL, cache_file TEXT NOT NULL,
 accepted_tokens INTEGER NOT NULL, rejected_tokens INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paragraphs (
 id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES sources(page_id), ordinal INTEGER NOT NULL,
 section TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(page_id, ordinal)
);
CREATE TABLE IF NOT EXISTS sentences (
 id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES sources(page_id),
 paragraph_id INTEGER NOT NULL REFERENCES paragraphs(id), ordinal INTEGER NOT NULL,
 start_char INTEGER NOT NULL, end_char INTEGER NOT NULL, text TEXT NOT NULL,
 UNIQUE(paragraph_id, ordinal)
);
CREATE TABLE IF NOT EXISTS occurrences (
 id INTEGER PRIMARY KEY, word TEXT NOT NULL, page_id INTEGER NOT NULL REFERENCES sources(page_id),
 sentence_id INTEGER NOT NULL REFERENCES sentences(id), token_index INTEGER NOT NULL,
 start_char INTEGER NOT NULL, end_char INTEGER NOT NULL, raw_token TEXT NOT NULL,
 UNIQUE(sentence_id, token_index)
);
CREATE INDEX IF NOT EXISTS occurrences_word ON occurrences(word);
CREATE INDEX IF NOT EXISTS occurrences_page ON occurrences(page_id);
CREATE TABLE IF NOT EXISTS ngram_occurrences (
 id INTEGER PRIMARY KEY, n INTEGER NOT NULL, item TEXT NOT NULL,
 page_id INTEGER NOT NULL REFERENCES sources(page_id), sentence_id INTEGER NOT NULL REFERENCES sentences(id),
 first_occurrence_id INTEGER NOT NULL REFERENCES occurrences(id), last_occurrence_id INTEGER NOT NULL REFERENCES occurrences(id)
);
CREATE INDEX IF NOT EXISTS ngram_item ON ngram_occurrences(n,item);
CREATE VIEW IF NOT EXISTS word_frequencies AS
 SELECT word, COUNT(*) frequency, COUNT(DISTINCT page_id) document_frequency,
 COUNT(DISTINCT sentence_id) sentence_frequency FROM occurrences GROUP BY word;
"""


def connect_db(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def ingest_page(db, envelope, topic, seed_title, paragraphs):
    page = envelope["data"]["parse"]
    page_id = page["pageid"]
    if db.execute("SELECT 1 FROM sources WHERE page_id=?", (page_id,)).fetchone():
        return 0
    accepted = sum(w is not None for p in paragraphs for _, _, _, w in token_spans(p["text"]))
    rejected = sum(w is None for p in paragraphs for _, _, _, w in token_spans(p["text"]))
    title_url = urllib.parse.quote(page["title"].replace(" ", "_"), safe="")
    with db:
        db.execute("INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            page_id, page["title"], topic, seed_title, "https://te.wikipedia.org/wiki/" + title_url,
            page["revid"], f"https://te.wikipedia.org/w/index.php?oldid={page['revid']}",
            f"https://te.wikipedia.org/w/index.php?title={title_url}&action=history", envelope["retrieved_at"],
            envelope["payload_sha256"], envelope["cache_file"], accepted, rejected))
        for p_number, paragraph in enumerate(paragraphs):
            pid = db.execute("INSERT INTO paragraphs(page_id,ordinal,section,text) VALUES (?,?,?,?)", (page_id, p_number, paragraph["section"], paragraph["text"])).lastrowid
            for s_number, (p_start, p_end, sentence) in enumerate(sentence_spans(paragraph["text"])):
                sid = db.execute("INSERT INTO sentences(page_id,paragraph_id,ordinal,start_char,end_char,text) VALUES (?,?,?,?,?,?)", (page_id, pid, s_number, p_start, p_end, sentence)).lastrowid
                run = []
                for token_index, (start, end, raw, word) in enumerate(token_spans(sentence)):
                    if word is None:
                        run = []
                        continue
                    oid = db.execute("INSERT INTO occurrences(word,page_id,sentence_id,token_index,start_char,end_char,raw_token) VALUES (?,?,?,?,?,?,?)", (word, page_id, sid, token_index, start, end, raw)).lastrowid
                    if run and not sentence[run[-1][2]:start].isspace():
                        run = []
                    run.append((word, oid, end))
                    run = run[-3:]
                    for n in (2, 3):
                        if len(run) >= n:
                            seq = run[-n:]
                            db.execute("INSERT INTO ngram_occurrences(n,item,page_id,sentence_id,first_occurrence_id,last_occurrence_id) VALUES (?,?,?,?,?,?)", (n, " ".join(x[0] for x in seq), page_id, sid, seq[0][1], seq[-1][1]))
    actual = db.execute("SELECT COUNT(*) FROM occurrences WHERE page_id=?", (page_id,)).fetchone()[0]
    if actual != accepted:
        raise AssertionError(f"Token conservation failed: {actual} vs {accepted}")
    return accepted


def write_csv(path, headers, rows):
    with Path(path).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def export_data(db, out):
    total = db.execute("SELECT COUNT(*) FROM occurrences").fetchone()[0]
    rows = list(db.execute("SELECT * FROM word_frequencies ORDER BY frequency DESC, word"))
    write_csv(out / "word_frequencies.csv", ["rank", "word", "frequency", "document_frequency", "sentence_frequency", "per_million_valid_tokens"], ((i, *tuple(row), round(row["frequency"] * 1e6 / total, 6)) for i, row in enumerate(rows, 1)))
    for n, label in ((2, "bigram"), (3, "trigram")):
        data = list(db.execute("SELECT item,COUNT(*) frequency,COUNT(DISTINCT page_id) document_frequency FROM ngram_occurrences WHERE n=? GROUP BY item ORDER BY frequency DESC,item", (n,)))
        write_csv(out / (label + "_frequencies.csv"), ["rank", "item", "frequency", "document_frequency"], ((i, *tuple(row)) for i, row in enumerate(data, 1)))
    sources = db.execute("SELECT * FROM sources ORDER BY topic,seed_title")
    write_csv(out / "sources.csv", [x[0] for x in sources.description], sources)
    with (out / "sentences.jsonl").open("w", encoding="utf-8") as f:
        for row in db.execute("SELECT s.*,p.section FROM sentences s JOIN paragraphs p ON p.id=s.paragraph_id ORDER BY s.id"):
            f.write(json.dumps(dict(row), ensure_ascii=False) + "\n")
    occurrences = db.execute("SELECT * FROM occurrences ORDER BY id")
    write_csv(out / "occurrences.csv", [x[0] for x in occurrences.description], occurrences)
    topics = [dict(row) for row in db.execute("SELECT topic,COUNT(*) pages,SUM(accepted_tokens) tokens FROM sources GROUP BY topic ORDER BY topic")]
    summary = {"collector_version": VERSION, "generated_at": utcnow(), "pages": db.execute("SELECT COUNT(*) FROM sources").fetchone()[0], "paragraphs": db.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0], "sentences": db.execute("SELECT COUNT(*) FROM sentences").fetchone()[0], "valid_tokens": total, "unique_words": len(rows), "rejected_candidates": db.execute("SELECT COALESCE(SUM(rejected_tokens),0) FROM sources").fetchone()[0], "topics": topics, "top_words": [dict(row) for row in rows[:30]]}
    save_json(out / "corpus_summary.json", summary)
    return summary


def collect(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seeds = json.loads(Path(args.seeds).read_text(encoding="utf-8"))
    if args.pages < len(seeds):
        raise ValueError("Use at least one article per subject, or supply a smaller seed manifest.")
    if args.delay < 0:
        raise ValueError("Delay must be nonnegative")
    client = WikiClient(out / "raw", args.delay, args.user_agent)
    selection = discover(client, seeds, out)
    db = connect_db(out / "corpus.sqlite")
    config = json.dumps({"version": VERSION, "seed_sha256": selection["seed_sha256"], "min_words": args.min_words}, sort_keys=True)
    previous = db.execute("SELECT value FROM meta WHERE key='config'").fetchone()
    if previous and previous[0] != config:
        old_config = json.loads(previous[0])
        if old_config.get("version") != VERSION or old_config.get("min_words") != args.min_words or old_config.get("seed_sha256") not in selection.get("previous_seed_sha256s", []):
            raise ValueError("Collector configuration changed. Use a new output directory.")
    with db:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('config',?)", (config,))
    audit_path = out / "collection_log.jsonl"
    for group_index, (topic, candidates) in enumerate(selection["groups"].items()):
        target = args.pages // len(seeds) + (group_index < args.pages % len(seeds))
        existing = db.execute("SELECT COUNT(*) FROM sources WHERE topic=?", (topic,)).fetchone()[0]
        if existing > target:
            raise ValueError("Output already contains more pages than this target; use a new directory.")
        for candidate in candidates:
            if existing >= target:
                break
            title = candidate["telugu_title"]
            record = {"at": utcnow(), "topic": topic, **candidate}
            if not title:
                record["status"] = "no_telugu_article"
            elif db.execute("SELECT 1 FROM sources WHERE seed_title=?", (candidate["seed_title"],)).fetchone():
                continue
            else:
                try:
                    envelope = client.request(TE_API, action="parse", page=title, prop="text|revid|properties", redirects=1, disableeditsection=1, disablelimitreport=1)
                    page = envelope["data"]["parse"]
                    record.update(page_id=page["pageid"], title=page["title"], revision_id=page["revid"])
                    if "disambiguation" in page.get("properties", {}):
                        record["status"] = "disambiguation"
                    elif db.execute("SELECT 1 FROM sources WHERE page_id=?", (page["pageid"],)).fetchone():
                        record["status"] = "duplicate_page"
                    else:
                        paragraphs = extract_paragraphs(page["text"])
                        count = sum(w is not None for p in paragraphs for _, _, _, w in token_spans(p["text"]))
                        record["valid_tokens"] = count
                        if count < args.min_words:
                            record["status"] = "too_short"
                        else:
                            ingest_page(db, envelope, topic, candidate["seed_title"], paragraphs)
                            record["status"] = "collected"
                            existing += 1
                            done = db.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
                            print(f"[{done}/{args.pages}] {topic}: {page['title']} — {count:,} valid tokens", flush=True)
                except (APIError, urllib.error.URLError, TimeoutError) as exc:
                    record.update(status="fetch_error", error=str(exc))
                    print(f"Fetch failed: {title}: {exc}", file=sys.stderr, flush=True)
            with audit_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        if existing < target:
            print(f"Subject shortfall: {topic}: {existing}/{target}", file=sys.stderr, flush=True)
    summary = export_data(db, out)
    db.close()
    print(json.dumps({k: summary[k] for k in ("pages", "valid_tokens", "unique_words", "sentences")}, ensure_ascii=False), flush=True)
    if summary["pages"] != args.pages:
        raise SystemExit("Collection incomplete. Inspect collection_log.jsonl; rerun to resume transient failures.")


def average_ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i], reverse=True)
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        mean_rank = (start + 1 + end) / 2
        for i in order[start:end]:
            ranks[i] = mean_rank
        start = end
    return ranks


def spearman(a, b):
    if len(a) < 3:
        return None
    a, b = average_ranks(a), average_ranks(b)
    mean_a, mean_b = sum(a) / len(a), sum(b) / len(b)
    numerator = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    denominator = math.sqrt(sum((x - mean_a)**2 for x in a) * sum((y - mean_b)**2 for y in b))
    return numerator / denominator if denominator else None


REFERENCE_FILES = {
    "193442": ("Exact word forms", 1, True),
    "193509": ("Base forms / lemmas", 1, False),
    "193537": ("Adjectives", 1, False),
    "193601": ("Adverbs", 1, False),
    "193616": ("Conjunctions", 1, False),
    "193636": ("Nouns", 1, False),
    "193657": ("Numerals", 1, False),
    "193721": ("Pronouns", 1, False),
    "193918": ("Bigrams", 2, True),
    "194020": ("Trigrams", 3, True),
}


def read_references(path):
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            for name in sorted(archive.namelist()):
                if name.endswith(".csv") and not name.startswith("__MACOSX/"):
                    yield Path(name).name, archive.read(name).decode("utf-8-sig")
    else:
        for file in sorted(path.glob("*.csv")):
            yield file.name, file.read_text(encoding="utf-8-sig")


def compare(args):
    out = Path(args.out)
    db = connect_db(out / "corpus.sqlite")
    corpus = {1: [(r[0], r[1]) for r in db.execute("SELECT word,frequency FROM word_frequencies ORDER BY frequency DESC,word")]}
    for n in (2, 3):
        corpus[n] = [(r[0], r[1]) for r in db.execute("SELECT item,COUNT(*) frequency FROM ngram_occurrences WHERE n=? GROUP BY item ORDER BY frequency DESC,item", (n,))]
    results = []
    dest = out / "comparisons"
    dest.mkdir(exist_ok=True)
    for filename, text in read_references(args.reference):
        suffix = Path(filename).stem[-6:]
        if suffix not in REFERENCE_FILES:
            continue
        label, n, comparable = REFERENCE_FILES[suffix]
        rows = list(csv.reader(io.StringIO(text)))
        header_index = next(i for i, row in enumerate(rows) if row[:2] == ["Item", "Frequency"])
        data = rows[header_index + 1:]
        cleaned, original_rows = collections.Counter(), {}
        rejected = 0
        for original_rank, row in enumerate(data, 1):
            parts = row[0].split()
            normalized = [clean_word(p) for p in parts]
            if len(parts) != n or any(w is None for w in normalized):
                rejected += 1
                continue
            word = " ".join(normalized)
            cleaned[word] += int(row[1])
            original_rows.setdefault(word, []).append(original_rank)
        baseline = sorted(cleaned.items(), key=lambda x: (-x[1], x[0]))
        collected = dict(corpus[n])
        corpus_ranks = {word: i for i, (word, _) in enumerate(corpus[n], 1)}
        baseline_ranks = {word: i for i, (word, _) in enumerate(baseline, 1)}
        overlap = set(cleaned) & set(collected)
        common = sorted(overlap)
        top_overlap = {}
        for k in (20, 50, 100, 500):
            if min(len(baseline), len(corpus[n])) >= k:
                top_overlap[str(k)] = len({w for w, _ in baseline[:k]} & {w for w, _ in corpus[n][:k]})
        result = {"filename": filename, "label": label, "n": n, "direct_comparison": comparable, "interpretation": "surface-token comparison; tokenization and genre may differ" if comparable else "surface-string diagnostic only: lemma/POS counts are not directly comparable to untagged word forms", "reference_rows": len(data), "valid_reference_items": len(baseline), "excluded_reference_rows": rejected, "observed_reference_items": len(overlap), "unobserved_reference_items": len(baseline) - len(overlap), "corpus_vocabulary": len(corpus[n]), "top_k_overlap": top_overlap, "spearman_shared_items": spearman([cleaned[w] for w in common], [collected[w] for w in common]) if comparable else None, "corpus_token_coverage_by_reference": sum(collected[w] for w in overlap) / sum(collected.values()) if collected else 0.0}
        results.append(result)
        union = set(cleaned) | set(collected) if comparable else set(cleaned)
        ordered = sorted(union, key=lambda w: (corpus_ranks.get(w, 10**12), baseline_ranks.get(w, 10**12), w))
        write_csv(dest / (suffix + "_comparison.csv"), ["item", "corpus_rank", "corpus_frequency", "reference_filtered_rank", "reference_frequency", "reference_original_rows", "rank_change_reference_minus_corpus", "comparison_status"], ((w, corpus_ranks.get(w, ""), collected.get(w, 0), baseline_ranks.get(w, ""), cleaned.get(w, ""), ";".join(map(str, original_rows.get(w, []))), baseline_ranks[w] - corpus_ranks[w] if w in overlap else "", "shared" if w in overlap else "not_in_reference_top_export" if w in collected else "not_observed_in_sample") for w in ordered))
    if not results:
        raise ValueError("No recognized frequency exports found")
    save_json(dest / "summary.json", results)
    write_csv(dest / "summary.csv", ["list", "valid_reference_items", "observed_reference_items", "top_100_overlap", "spearman_shared_items", "direct_comparison"], ((r["label"], r["valid_reference_items"], r["observed_reference_items"], r["top_k_overlap"].get("100", ""), r["spearman_shared_items"], r["direct_comparison"]) for r in results))
    print(json.dumps(results, ensure_ascii=False, indent=2))
    db.close()


def trace(args):
    db = sqlite3.connect(Path(args.out) / "corpus.sqlite")
    db.row_factory = sqlite3.Row
    word = clean_word(args.word)
    if word is None:
        raise ValueError("Query must be a Telugu-only word")
    count = db.execute("SELECT COUNT(*) FROM occurrences WHERE word=?", (word,)).fetchone()[0]
    print(json.dumps({"word": word, "total_occurrences": count, "offset": args.offset, "limit": args.limit}, ensure_ascii=False))
    query = """SELECT o.id occurrence_id,o.raw_token,o.start_char,o.end_char,o.sentence_id,
       s.text sentence,p.section,p.text paragraph,src.title,src.topic,src.url,src.permanent_url,src.revision_id
       FROM occurrences o JOIN sentences s ON s.id=o.sentence_id
       JOIN paragraphs p ON p.id=s.paragraph_id JOIN sources src ON src.page_id=o.page_id
       WHERE o.word=? ORDER BY o.id LIMIT ? OFFSET ?"""
    for row in db.execute(query, (word, args.limit, args.offset)):
        print(json.dumps(dict(row), ensure_ascii=False))
    db.close()


def verify(args):
    db = sqlite3.connect(Path(args.out) / "corpus.sqlite")
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not list(db.execute("PRAGMA foreign_key_check"))
    total = db.execute("SELECT COUNT(*) FROM occurrences").fetchone()[0]
    assert total == db.execute("SELECT COALESCE(SUM(accepted_tokens),0) FROM sources").fetchone()[0]
    assert total == db.execute("SELECT COALESCE(SUM(frequency),0) FROM word_frequencies").fetchone()[0]
    for word, raw, start, end, text in db.execute("SELECT o.word,o.raw_token,o.start_char,o.end_char,s.text FROM occurrences o JOIN sentences s ON s.id=o.sentence_id"):
        assert text[start:end] == raw, (word, raw)
        assert clean_word(raw) == word
    for start, end, text, paragraph in db.execute("SELECT s.start_char,s.end_char,s.text,p.text FROM sentences s JOIN paragraphs p ON p.id=s.paragraph_id"):
        assert paragraph[start:end] == text
    print(json.dumps({"verified_occurrences": total, "checks": ["database integrity", "foreign keys", "frequency conservation", "every token's exact sentence offsets", "Telugu-only tokens", "sentence-to-paragraph offsets"]}))
    db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("collect", help="Collect article prose; safe to rerun and resume")
    p.add_argument("--out", default=str(BASE / "run"))
    p.add_argument("--seeds", default=str(BASE / "seeds.json"))
    p.add_argument("--pages", type=int, default=100)
    p.add_argument("--min-words", type=int, default=150)
    p.add_argument("--delay", type=float, default=1.0)
    p.add_argument("--user-agent", default=USER_AGENT)
    p.set_defaults(function=collect)
    p = commands.add_parser("compare", help="Compare against the user's frequency CSV archive")
    p.add_argument("--out", default=str(BASE / "run"))
    p.add_argument("--reference", default=str(BASE / "reference" / "original-frequency-lists.zip"))
    p.set_defaults(function=compare)
    p = commands.add_parser("trace", help="Print individual occurrences with full source sentences")
    p.add_argument("word")
    p.add_argument("--out", default=str(BASE / "run"))
    p.add_argument("--limit", type=int, default=20, help="-1 prints every occurrence")
    p.add_argument("--offset", type=int, default=0)
    p.set_defaults(function=trace)
    p = commands.add_parser("verify", help="Verify all token provenance and counts")
    p.add_argument("--out", default=str(BASE / "run"))
    p.set_defaults(function=verify)
    args = parser.parse_args()
    args.function(args)


if __name__ == "__main__":
    main()
