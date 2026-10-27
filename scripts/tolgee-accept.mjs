import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from './localization.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = '/v2/projects/36162';
const own = (object, key) => Object.hasOwn(object ?? {}, key);
const id = value => Number.isSafeInteger(value) && value > 0;
const canonical = value => {
  try { return typeof value === 'string' && Intl.getCanonicalLocales(value)[0] === value; } catch { return false; }
};

/** Only the plain-text subset exported by our i18next source importer is supported.
 * Complex ICU/plural/quoted brace expressions require a person, not a guessed conversion. */
export function fromTolgee(text) {
  if (typeof text !== 'string' || text.length > 12000 || /\{\{|\}\}|'[{}#]/.test(text)) throw Error('unsupported-syntax');
  const result = text.replace(/''/g, "'").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, '{{$1}}');
  parseCatalog(JSON.stringify({ value: result }));
  return result;
}

function tokens(text) {
  return (text.match(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}|https?:\/\/[^\s<>]+|`[^`]+`|\b(?:Xbox|Microsoft|Xodus|Nexus|Tolgee|Steam)\b|--[a-z][a-z0-9-]*/g) ?? []).sort();
}

function scriptMatches(text, tag) {
  const plain = text.replace(/\{\{[^}]+\}\}|https?:\/\/\S+|`[^`]+`/g, '');
  if (!/\p{L}/u.test(plain)) return false;
  const language = tag.split('-')[0];
  const expected = { ar: /\p{Script=Arabic}/u, ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u,
    ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, ko: /\p{Script=Hangul}/u,
    zh: /\p{Script=Han}/u, el: /\p{Script=Greek}/u }[language];
  if (expected) return expected.test(plain);
  // Do not pretend a script check can distinguish e.g. French from Spanish.
  if (['cs', 'sk', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'hu', 'tr', 'pl'].includes(language)) {
    return /\p{Script=Latin}/u.test(plain) && !/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Han}\p{Script=Hangul}]/u.test(plain);
  }
  return false;
}

/** A technical policy, not a claim that wording or meaning has been reviewed. */
export function assess(row, language, english) {
  const cell = row.translations?.[language.tag];
  const result = reason => ({ reason });
  if (language.base || /^en(?:-|$)/i.test(language.tag)) return result('protected-source');
  if (!id(row.keyId) || !own(english, row.keyName) || row.keyNamespace || row.branch) return result('unknown-key-or-scope');
  if (row.keyIsPlural !== false) return result('plural-needs-review');
  if (!cell || cell.text != null && cell.text !== '' || cell.state !== 'UNTRANSLATED') return result('existing-translation');
  if (cell.outdated !== false || cell.unresolvedCommentCount !== 0 || (cell.qaIssueCount ?? 0) !== 0) return result('flagged-translation');
  if (cell.activeSuggestionCount !== 1) return result('competing-suggestions');
  const suggestions = cell.suggestions?.filter(value => value.state === 'ACTIVE');
  if (suggestions?.length !== 1 || !id(suggestions[0].id) || suggestions[0].isPlural !== false) return result('incomplete-suggestion');
  const suggestion = suggestions[0];
  let source, translated;
  try {
    source = fromTolgee(row.translations.en?.text);
    translated = fromTolgee(suggestion.translation);
    parseCatalog(JSON.stringify({ [row.keyName]: translated }), english);
  } catch { return result('invalid-text-or-parameters'); }
  if (source !== english[row.keyName]) return result('source-not-synchronized');
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translated))) return result('changed-protected-token');
  if (translated.trim() !== translated || translated.normalize('NFC') !== translated || /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(translated)) return result('suspicious-format');
  if (translated === source || !scriptMatches(translated, language.tag)) return result('language-needs-review');
  if (translated.length > Math.max(160, source.length * 4) || source.length > 80 && translated.length < source.length / 5) return result('suspicious-length');
  if (Number.isInteger(row.keyMaxCharLimit) && row.keyMaxCharLimit > 0 && translated.length > row.keyMaxCharLimit) return result('character-limit');
  return { reason: 'eligible', suggestion, translated };
}

/** Never follow response-provided links, redirects, or print response bodies/tokens. */
export function createApi(key, fetcher = fetch) {
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw Error('Set TOLGEE_REVIEW_API_KEY to a project-scoped review key.');
  return async (route, method = 'GET') => {
    if (!route.startsWith(`${project}/`) || route.includes('..') || /[\\#\r\n]/.test(route) || !['GET', 'PUT'].includes(method)) throw Error('Invalid API operation.');
    let response;
    try {
      response = await fetcher(`https://app.tolgee.io${route}`, {
        method, headers: { 'X-API-Key': key, accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { throw Error(`Tolgee ${method} transport failed. No automatic retry; check the report before rerunning.`); }
    if (!response.ok) { await response.body?.cancel(); throw Error(`Tolgee ${method} failed (HTTP ${response.status}). No automatic retry.`); }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Missing Tolgee response.');
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw Error('Response too large.'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw Error('Invalid or oversized Tolgee response. No automatic retry.'); }
  };
}

async function pages(api, route, collection, limit) {
  const all = []; const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const value = await api(`${route}${route.includes('?') ? '&' : '?'}size=100&page=${page}`);
    const rows = value._embedded?.[collection] ?? (value.page?.totalElements === 0 ? [] : undefined);
    if (!Array.isArray(rows) || !Number.isInteger(value.page?.totalPages) || value.page.totalPages < 0 || value.page.totalPages > 100 || value.page.number !== page) throw Error('Invalid Tolgee pagination.');
    for (const row of rows) {
      const identity = collection === 'keys' ? row.keyId : row.id;
      if (!id(identity) || seen.has(identity) || all.length >= limit) throw Error('Duplicate or excessive Tolgee records.');
      seen.add(identity); all.push(row);
    }
    if (page + 1 >= value.page.totalPages) return all;
    if (!rows.length) throw Error('Incomplete Tolgee pagination.');
  }
  throw Error('Too many Tolgee pages.');
}

function viewRoute(tags, keyId) {
  const query = new URLSearchParams();
  for (const tag of tags) query.append('languages', tag);
  query.set('sort', 'keyId,asc');
  if (keyId) query.set('filterKeyId', String(keyId));
  return `${project}/translations?${query}`;
}

export async function acceptSuggestions({ api, english, apply = false, reviewed = false, tags = [], report = {} }) {
  if (reviewed && !apply) throw Error('Reviewed mode requires explicit apply.');
  Object.assign(report, { project: 36162, mode: apply ? reviewed ? 'accept-and-review' : 'accept' : 'preview',
    linguisticReview: false, entries: [], accepted: 0, reviewed: 0 });
  const languages = await pages(api, `${project}/languages`, 'languages', 200);
  if (languages.filter(value => value.base).length !== 1 || !languages.find(value => value.base && value.tag === 'en') ||
      languages.some(value => !canonical(value.tag)) || new Set(languages.map(value => value.tag)).size !== languages.length) throw Error('Unexpected project languages or base language.');
  for (const tag of tags) if (!canonical(tag) || /^en(?:-|$)/i.test(tag) || !languages.some(value => value.tag === tag)) throw Error('Invalid target language.');
  const targets = languages.filter(value => !value.base && !/^en(?:-|$)/i.test(value.tag) && (!tags.length || tags.includes(value.tag)));
  if (!targets.length) throw Error('No target languages selected.');
  // Snapshot all pages before mutation, never paginate a shrinking suggestion filter.
  const rows = await pages(api, viewRoute(['en', ...targets.map(value => value.tag)]), 'keys', 10000);
  const pending = [];
  for (const row of rows) for (const language of targets) {
    const cell = row.translations?.[language.tag];
    if (!cell?.activeSuggestionCount) continue;
    const decision = assess(row, language, english);
    const entry = { key: own(english, row.keyName) ? row.keyName : '(unknown)', language: language.tag, status: decision.reason };
    report.entries.push(entry);
    if (decision.reason === 'eligible') pending.push({ row, language, decision, entry });
  }
  if (!apply) return report;
  for (const { row, language, decision, entry } of pending) {
    // Tolgee has no conditional/transactional accept endpoint. Minimize, but cannot
    // eliminate, races with a human editing the same translation during this run.
    const fresh = await pages(api, viewRoute(['en', language.tag], row.keyId), 'keys', 1);
    const next = fresh.length === 1 ? assess(fresh[0], language, english) : {};
    if (fresh[0]?.keyId !== row.keyId || next.reason !== 'eligible' || next.suggestion.id !== decision.suggestion.id || next.suggestion.translation !== decision.suggestion.translation) {
      entry.status = 'changed-before-accept'; continue;
    }
    const route = `${project}/languages/${language.id}/key/${row.keyId}/suggestion`;
    const active = await pages(api, `${route}?filterState=ACTIVE`, 'suggestions', 100);
    if (active.length !== 1 || active[0].id !== decision.suggestion.id || active[0].languageId !== language.id || active[0].keyId !== row.keyId || active[0].translation !== decision.suggestion.translation || active[0].state !== 'ACTIVE' || active[0].isPlural !== false) {
      entry.status = 'changed-before-accept'; continue;
    }
    entry.status = 'accept-outcome-unknown';
    const receipt = await api(`${route}/${decision.suggestion.id}/accept?declineOther=false`, 'PUT');
    const accepted = receipt.accepted;
    if (accepted?.id !== decision.suggestion.id || accepted.languageId !== language.id || accepted.keyId !== row.keyId || accepted.state !== 'ACCEPTED' || accepted.translation !== decision.suggestion.translation || !Array.isArray(receipt.declined) || receipt.declined.length) throw Error('Unexpected acceptance receipt; stopped without retry.');
    report.accepted++; entry.status = 'accepted';
    const after = await pages(api, viewRoute(['en', language.tag], row.keyId), 'keys', 1);
    const target = after[0]?.translations?.[language.tag];
    if (after[0]?.keyId !== row.keyId || after[0]?.keyName !== row.keyName || fromTolgee(after[0]?.translations?.en?.text) !== english[row.keyName] || target?.text !== decision.suggestion.translation || !id(target?.id) || target.outdated !== false) throw Error('Accepted translation could not be verified; stopped.');
    if (reviewed) {
      entry.status = 'accepted-review-outcome-unknown';
      const state = await api(`${project}/translations/${target.id}/set-state/REVIEWED`, 'PUT');
      if (state.id !== target.id || state.text !== decision.suggestion.translation || state.state !== 'REVIEWED' || state.outdated !== false) throw Error('Reviewed translation could not be verified; stopped.');
      entry.status = 'accepted-and-reviewed'; report.reviewed++;
    }
  }
  return report;
}

export function argumentsFor(argv) {
  const result = { apply: false, reviewed: false, tags: [] };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (seen.has(option)) throw Error('Duplicate option.');
    seen.add(option);
    if (option === '--apply') result.apply = true;
    else if (option === '--reviewed') result.reviewed = true;
    else if (option === '--languages') {
      result.tags = (argv[++index] ?? '').split(',');
      if (!result.tags.every(canonical) || new Set(result.tags).size !== result.tags.length) throw Error('Invalid languages.');
    } else throw Error('Usage: npm run i18n:accept -- [--languages fr,es] [--apply [--reviewed]]');
  }
  if (result.reviewed && !result.apply) throw Error('--reviewed requires --apply.');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = {};
  try {
    const options = argumentsFor(process.argv.slice(2));
    const english = parseCatalog(await fs.readFile(path.join(root, 'assets/locales/en.json'), 'utf8'));
    await acceptSuggestions({ ...options, english, report, api: createApi(process.env.TOLGEE_REVIEW_API_KEY) });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    console.log(JSON.stringify(report, null, 2));
  }
}
