#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUTPUT = path.resolve(ROOT, process.argv[2] || 'artifacts/lpbot/2026-08-13');
const BASELINE_DOC = path.join(ROOT, 'docs/research/public-surface.md');
const ALLOWED_ORIGINS = new Set(['https://www.lpbot.cc', 'https://api.lpbot.cc']);
const USER_AGENT = 'LPBotBaselineFreezer/1.0 (read-only artifact capture)';
const REQUEST_TIMEOUT_MS = 60_000;
const STARTED_AT = new Date().toISOString();

const fetched = new Map();
const queued = new Set();
const queue = [];
const discoveries = new Map();
const importEdges = [];
const externalReferences = [];
const failures = [];
const invalidResponses = [];
const methodsUsed = new Set();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeUrl(value, base) {
  const url = new URL(value, base);
  url.hash = '';
  return url;
}

function assertAllowed(url) {
  if (!ALLOWED_ORIGINS.has(url.origin)) {
    throw new Error(`Origin is outside the read-only capture allowlist: ${url.origin}`);
  }
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(value.replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`Unsafe artifact path: ${value}`);
  }
  return normalized;
}

function defaultLocalPath(url) {
  const pathname = decodeURIComponent(url.pathname);
  if (url.origin === 'https://api.lpbot.cc') {
    if (pathname === '/api/docs') return 'api-docs.md';
    if (pathname === '/api/docs.json') return 'api-docs.json';
    return safeRelativePath(`api${pathname}`);
  }
  if (pathname === '/') return 'index.html';
  return safeRelativePath(pathname);
}

function recordDiscovery(url, source) {
  const key = url.href;
  if (!discoveries.has(key)) discoveries.set(key, new Set());
  discoveries.get(key).add(source);
}

function enqueue(value, base, source, edgeType = 'static-resource') {
  let url;
  try {
    url = normalizeUrl(value, base);
  } catch {
    return;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (!ALLOWED_ORIGINS.has(url.origin)) {
    externalReferences.push({
      url: url.href,
      discoveredBy: source,
      referenceType: edgeType,
      captured: false,
      reason: 'outside first-party capture allowlist',
    });
    return;
  }

  recordDiscovery(url, source);
  if (queued.has(url.href) || fetched.has(url.href)) return;
  queued.add(url.href);
  queue.push({ url, localPath: defaultLocalPath(url), kind: edgeType });
}

async function fetchFollowingAllowedRedirects(initialUrl) {
  let url = initialUrl;
  const redirects = [];

  for (let index = 0; index < 5; index += 1) {
    assertAllowed(url);
    methodsUsed.add('GET');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          Accept: '*/*',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location from ${url.href}`);
      const next = normalizeUrl(location, url);
      assertAllowed(next);
      redirects.push({ status: response.status, from: url.href, to: next.href });
      url = next;
      continue;
    }

    return { response, finalUrl: url, redirects };
  }

  throw new Error(`Too many redirects for ${initialUrl.href}`);
}

function responseLooksInvalid(item, contentType, body) {
  const { localPath, kind } = item;
  const prefix = body.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  const moduleKinds = new Set(['dynamic-import', 'static-import', 'vite-map-dependency']);
  if (moduleKinds.has(kind) && !/\.(?:m?js|css)$/i.test(localPath)) return true;
  if (/\.(?:m?js)$/i.test(localPath)) {
    return !/(?:javascript|ecmascript)/i.test(contentType) || prefix.startsWith('<!doctype html');
  }
  if (/\.css$/i.test(localPath)) {
    return !contentType.includes('text/css') || prefix.startsWith('<!doctype html');
  }
  if (/\.json$/i.test(localPath)) {
    try {
      JSON.parse(body.toString('utf8'));
    } catch {
      return true;
    }
  }
  return false;
}

async function captureResource(item) {
  const fetchedAt = new Date().toISOString();
  try {
    const { response, finalUrl, redirects } = await fetchFollowingAllowedRedirects(item.url);
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const metadata = {
      url: item.url.href,
      finalUrl: finalUrl.href,
      localPath: item.localPath,
      kind: item.kind,
      fetchedAt,
      method: 'GET',
      status: response.status,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType: contentType || null,
      contentLengthHeader: response.headers.get('content-length'),
      cacheControl: response.headers.get('cache-control'),
      bytes: body.length,
      sha256: sha256(body),
      redirects,
      discoveredBy: [...(discoveries.get(item.url.href) || [])].sort(),
    };

    if (!response.ok) {
      failures.push({ ...metadata, error: `HTTP ${response.status}` });
      return null;
    }

    if (responseLooksInvalid(item, contentType, body)) {
      invalidResponses.push({
        ...metadata,
        url: item.url.href,
        localPath: item.localPath,
        status: response.status,
        contentType,
        reason: 'response body does not match the expected static asset type',
      });
      return null;
    }

    await mkdir(path.dirname(path.join(OUTPUT, item.localPath)), { recursive: true });
    await writeFile(path.join(OUTPUT, item.localPath), body);
    const result = { metadata, body };
    fetched.set(item.url.href, result);
    return result;
  } catch (error) {
    failures.push({
      url: item.url.href,
      localPath: item.localPath,
      kind: item.kind,
      fetchedAt,
      method: 'GET',
      error: error instanceof Error ? error.message : String(error),
      discoveredBy: [...(discoveries.get(item.url.href) || [])].sort(),
    });
    return null;
  }
}

function addImportEdge(sourceUrl, specifier, referenceType) {
  let resolved;
  try {
    const base = specifier.startsWith('assets/')
      ? new URL('/', sourceUrl)
      : new URL(sourceUrl);
    resolved = normalizeUrl(specifier, base);
  } catch {
    return;
  }

  const edge = {
    sourceUrl,
    specifier,
    referenceType,
    resolvedUrl: resolved.href,
    firstParty: ALLOWED_ORIGINS.has(resolved.origin),
  };
  importEdges.push(edge);
  enqueue(resolved.href, sourceUrl, sourceUrl, referenceType);
}

function isLocalModuleSpecifier(specifier) {
  return /^(?:\.\.?\/|\/|assets\/)[A-Za-z0-9_@.+,~!$&'();=:%/-]+\.(?:m?js|css)$/i.test(specifier);
}

function discoverHtml(text, sourceUrl) {
  const attributePattern = /\b(src|href)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of text.matchAll(attributePattern)) {
    const value = match[3].trim();
    if (!value || value.startsWith('#') || value.startsWith('data:')) continue;
    enqueue(value, sourceUrl, sourceUrl, `html-${match[1].toLowerCase()}`);
  }
}

function discoverManifest(text, sourceUrl) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return;
  }

  const visit = (value, key = '') => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === 'src' && typeof childValue === 'string') {
        enqueue(childValue, sourceUrl, sourceUrl, 'manifest-resource');
      } else {
        visit(childValue, childKey);
      }
    }
  };
  visit(manifest);
}

function discoverJavaScript(text, sourceUrl) {
  const modulePatterns = [
    { type: 'dynamic-import', pattern: /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g },
    { type: 'static-import', pattern: /\bfrom\s*(["'])([^"']+)\1/g },
    { type: 'static-import', pattern: /\bimport\s*(["'])([^"']+)\1/g },
  ];

  for (const { type, pattern } of modulePatterns) {
    for (const match of text.matchAll(pattern)) {
      if (isLocalModuleSpecifier(match[2])) addImportEdge(sourceUrl, match[2], type);
    }
  }

  const viteDependency = /(["'])(assets\/[^"'?#]+\.(?:m?js|css))\1/g;
  for (const match of text.matchAll(viteDependency)) {
    if (isLocalModuleSpecifier(match[2])) addImportEdge(sourceUrl, match[2], 'vite-map-dependency');
  }

  const localAsset = /(["'])((?:\.\.?\/|\/)?assets\/[^"'?#]+\.(?:m?js|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf))\1/g;
  for (const match of text.matchAll(localAsset)) {
    addImportEdge(sourceUrl, match[2], 'javascript-asset-reference');
  }

  const serviceWorker = /serviceWorker[\s\S]{0,160}?\.register\s*\(\s*(["'])([^"']+)\1/g;
  for (const match of text.matchAll(serviceWorker)) {
    if (/^(?:\.\.?\/|\/)[A-Za-z0-9_@.+,~!$&'();=:%/-]+\.(?:m?js)$/i.test(match[2])) {
      addImportEdge(sourceUrl, match[2], 'service-worker');
    }
  }
}

function discoverCss(text, sourceUrl) {
  const importPattern = /@import\s+(?:url\()?\s*(["']?)([^"')\s;]+)\1\s*\)?/gi;
  for (const match of text.matchAll(importPattern)) {
    addImportEdge(sourceUrl, match[2], 'css-import');
  }

  const urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  for (const match of text.matchAll(urlPattern)) {
    const value = match[2].trim();
    if (!value || value.startsWith('data:') || value.startsWith('#')) continue;
    addImportEdge(sourceUrl, value, 'css-resource');
  }
}

function discoverReferences(result) {
  const { metadata, body } = result;
  const text = body.toString('utf8');
  if (metadata.localPath === 'index.html') discoverHtml(text, metadata.finalUrl);
  if (metadata.localPath === 'manifest.json') discoverManifest(text, metadata.finalUrl);
  if (/\.(?:m?js)$/i.test(metadata.localPath)) discoverJavaScript(text, metadata.finalUrl);
  if (/\.css$/i.test(metadata.localPath)) discoverCss(text, metadata.finalUrl);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function section(markdown, startHeading, endHeading) {
  const start = markdown.indexOf(startHeading);
  const end = endHeading ? markdown.indexOf(endHeading, start + startHeading.length) : markdown.length;
  return start >= 0 ? markdown.slice(start, end >= 0 ? end : markdown.length) : '';
}

function stripMarkdown(value) {
  return value
    .trim()
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/<br\s*\/?>/gi, '\n');
}

function markdownCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(stripMarkdown);
}

function parseBaseline(markdown) {
  const apiText = section(markdown, '## 9. ', '## 10. ');
  const apiEndpoints = [];
  let category = null;
  for (const line of apiText.split('\n')) {
    const heading = line.match(/^###\s+(.+)/);
    if (heading) category = heading[1].trim();
    const endpoint = line.match(/^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`\s*\|/);
    if (endpoint) apiEndpoints.push({ method: endpoint[1], path: endpoint[2], category });
  }

  const routeText = section(markdown, '### 4.1 ', '### 4.2 ');
  const routes = [];
  for (const line of routeText.split('\n')) {
    if (!/^\|\s*`/.test(line)) continue;
    const cells = markdownCells(line);
    if (cells.length >= 4 && cells[0] !== '路由') {
      routes.push({
        path: cells[0],
        access: cells[1],
        behavior: cells[2],
        interactions: cells[3],
      });
    }
  }

  const gateText = section(markdown, '### 6.2 ', '## 7. ');
  const featureGates = [];
  for (const line of gateText.split('\n')) {
    if (!/^\|/.test(line) || /^\|\s*(?:---|\u80fd\u529b)/.test(line)) continue;
    const cells = markdownCells(line);
    if (cells.length >= 5) {
      featureGates.push({
        feature: cells[0],
        user: cells[1],
        pro: cells[2],
        admin: cells[3],
        evidenceAndStatus: cells[4],
      });
    }
  }

  const chainText = section(markdown, '## 7. ', '## 8. ');
  const chains = [];
  for (const line of chainText.split('\n')) {
    const match = line.match(/^\|\s*`(\d+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (match) {
      chains.push({
        chainId: Number(match[1]),
        name: stripMarkdown(match[2]),
        protocols: stripMarkdown(match[3]).split(/\u3001/).map((item) => item.trim()),
      });
    }
  }

  const hashes = {};
  const hashLabels = {
    '主站 HTML': 'index.html',
    '主入口 JS': 'mainBundle',
    '主 CSS': 'mainCss',
    'API Markdown': 'api-docs.md',
    'API JSON': 'api-docs.json',
  };
  for (const [label, key] of Object.entries(hashLabels)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = markdown.match(new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*\u0060([a-f0-9]{64})\u0060`));
    if (match) hashes[key] = match[1];
  }

  const entryBundle = markdown.match(/https:\/\/www\.lpbot\.cc\/(assets\/index-[A-Za-z0-9_-]+\.js)/)?.[1] || null;
  const entryCss = markdown.match(/https:\/\/www\.lpbot\.cc\/(assets\/index-[A-Za-z0-9_-]+\.css)/)?.[1] || null;
  const documentedChunks = [...markdown.matchAll(/\|\s*`([^`]+\.js)`\s*\|/g)].map((match) => match[1]);

  return {
    date: '2026-08-13',
    source: 'docs/research/public-surface.md',
    apiEndpoints,
    routes,
    featureGates,
    chains,
    hashes,
    entryBundle,
    entryCss,
    documentedChunks,
  };
}

function extractJsStrings(text) {
  const tokens = [];
  for (let index = 0; index < text.length; index += 1) {
    const quote = text[index];
    if (!['"', "'", '`'].includes(quote)) continue;
    const start = index;
    let raw = '';
    let escaped = false;
    index += 1;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        raw += `\\${character}`;
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        break;
      } else {
        raw += character;
      }
    }
    tokens.push({ raw, start, end: index + 1 });
  }
  return tokens;
}

function compactSnippet(text, start, end, radius = 180) {
  return text
    .slice(Math.max(0, start - radius), Math.min(text.length, end + radius))
    .replace(/\s+/g, ' ')
    .slice(0, radius * 2 + 80);
}

function collectBundleCorpus() {
  const files = [];
  for (const { metadata, body } of fetched.values()) {
    if (/\.(?:m?js)$/i.test(metadata.localPath)) {
      const text = body.toString('utf8');
      files.push({ localPath: metadata.localPath, url: metadata.finalUrl, text, tokens: extractJsStrings(text) });
    }
  }
  return files.sort((a, b) => a.localPath.localeCompare(b.localPath));
}

function evidenceFor(corpus, term, maximum = 8) {
  const result = [];
  let count = 0;
  for (const file of corpus) {
    let offset = 0;
    while (offset < file.text.length) {
      const index = file.text.indexOf(term, offset);
      if (index < 0) break;
      count += 1;
      if (result.length < maximum) {
        result.push({
          file: file.localPath,
          offset: index,
          snippet: compactSnippet(file.text, index, index + term.length),
        });
      }
      offset = index + Math.max(1, term.length);
    }
  }
  return { term, occurrenceCount: count, evidence: result };
}

function exactLiteralEvidenceFor(corpus, literal, maximum = 8) {
  const evidence = [];
  let occurrenceCount = 0;
  for (const file of corpus) {
    for (const quote of ['"', "'", '`']) {
      const needle = `${quote}${literal}${quote}`;
      let offset = 0;
      while (offset < file.text.length) {
        const index = file.text.indexOf(needle, offset);
        if (index < 0) break;
        occurrenceCount += 1;
        if (evidence.length < maximum) {
          evidence.push({
            file: file.localPath,
            offset: index + 1,
            snippet: compactSnippet(file.text, index, index + needle.length),
          });
        }
        offset = index + needle.length;
      }
    }
  }
  return { literal, occurrenceCount, evidence };
}

function regexEvidenceFor(corpus, label, pattern, maximum = 8) {
  const evidence = [];
  let occurrenceCount = 0;
  for (const file of corpus) {
    const regex = new RegExp(pattern, 'g');
    for (const match of file.text.matchAll(regex)) {
      occurrenceCount += 1;
      if (evidence.length < maximum) {
        evidence.push({
          file: file.localPath,
          offset: match.index,
          matched: match[0],
          snippet: compactSnippet(file.text, match.index, match.index + match[0].length),
        });
      }
    }
  }
  return { label, pattern, occurrenceCount, evidence };
}

function currentEntryPaths(indexHtml) {
  const moduleScript = [...indexHtml.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi)].at(-1)?.[1]
    || [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/gi)].at(-1)?.[1]
    || null;
  const css = [...indexHtml.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+\.css)["']/gi)].at(-1)?.[1]
    || [...indexHtml.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*\brel=["']stylesheet["']/gi)].at(-1)?.[1]
    || null;
  return {
    bundle: moduleScript ? safeRelativePath(new URL(moduleScript, 'https://www.lpbot.cc/').pathname) : null,
    css: css ? safeRelativePath(new URL(css, 'https://www.lpbot.cc/').pathname) : null,
  };
}

function normalizeOfficialApi(apiDocs) {
  const endpoints = [];
  for (const apiSection of apiDocs.sections || []) {
    for (const endpoint of apiSection.endpoints || []) {
      if (!endpoint.method || !endpoint.path) continue;
      endpoints.push({
        ...endpoint,
        method: String(endpoint.method).toUpperCase(),
        path: endpoint.path,
        category: apiSection.title || null,
      });
    }
  }
  return uniqueBy(endpoints, (item) => `${item.method} ${item.path}`)
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function bundleApiCandidates(corpus) {
  const excludedLibraryPaths = /^\/api\/(?:WagmiProvider(?:\/|$)|glossary(?:\/|#)|human(?:\/|#))/i;
  const firstPartyOrigins = new Set(['https://api.lpbot.cc', 'https://m.lpbot.cc']);
  const candidates = [];
  for (const file of corpus) {
    for (const token of file.tokens) {
      const value = token.raw.replace(/\\\//g, '/');
      let origin = 'https://api.lpbot.cc';
      let pathValue = null;
      let fullUrl = null;
      if (/^https?:\/\//i.test(value)) {
        try {
          const parsed = new URL(value);
          if (!firstPartyOrigins.has(parsed.origin)) continue;
          origin = parsed.origin;
          pathValue = parsed.pathname;
          fullUrl = value;
        } catch {
          continue;
        }
      } else {
        const apiOffset = value.indexOf('/api/');
        if (apiOffset >= 0) pathValue = value.slice(apiOffset);
      }
      if (!pathValue || excludedLibraryPaths.test(pathValue)) continue;
      if (/\s/.test(pathValue) || pathValue.length > 300) continue;
      const queryOffset = pathValue.indexOf('?');
      const pathTemplate = queryOffset >= 0 ? pathValue.slice(0, queryOffset) : pathValue;
      const queryTemplate = queryOffset >= 0 ? pathValue.slice(queryOffset + 1) : null;
      const context = compactSnippet(file.text, token.start, token.end, 220);
      const functionBoundary = file.text.indexOf('}async function', token.end);
      const forwardEnd = functionBoundary >= 0 && functionBoundary - token.end < 800
        ? functionBoundary
        : Math.min(file.text.length, token.end + 500);
      const forwardContext = file.text.slice(token.end, forwardEnd);
      const methodMatch = forwardContext.match(/method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/i);
      const method = methodMatch?.[1]?.toUpperCase() || 'GET';
      candidates.push({
        method,
        methodEvidence: methodMatch ? 'explicit request option in the same client function' : 'client default GET (no method option before next client function)',
        origin,
        pathTemplate,
        queryTemplate,
        rawLiteral: value,
        fullUrl,
        file: file.localPath,
        offset: token.start,
        snippet: context,
      });
    }
  }
  return uniqueBy(candidates, (item) => `${item.method}\u0000${item.origin}\u0000${item.pathTemplate}\u0000${item.file}\u0000${item.offset}`)
    .sort((a, b) => `${a.origin} ${a.pathTemplate} ${a.method} ${a.file} ${a.offset}`.localeCompare(`${b.origin} ${b.pathTemplate} ${b.method} ${b.file} ${b.offset}`));
}

function observedRoutes(corpus, baselineRoutes, entryBundle) {
  const expectedPaths = [...baselineRoutes.map((route) => route.path), '/monitors'];
  const rows = [];
  for (const routePath of expectedPaths) {
    const evidence = [];
    for (const file of corpus) {
      for (const quote of ['"', "'", '`']) {
        const needle = `${quote}${routePath}${quote}`;
        let offset = 0;
        while (offset < file.text.length) {
          const index = file.text.indexOf(needle, offset);
          if (index < 0) break;
          const before = file.text.slice(Math.max(0, index - 40), index);
          const contextType = /path\s*:\s*$/.test(before)
            ? 'route-declaration'
            : /to\s*:\s*$/.test(before)
              ? 'redirect-target'
              : /(?:navigate|pathname|startsWith|===|!==)\s*\(?\s*$/.test(before)
                ? 'route-control-flow'
                : 'route-reference';
          evidence.push({
            file: file.localPath,
            offset: index + 1,
            contextType,
            snippet: compactSnippet(file.text, index, index + needle.length),
          });
          offset = index + needle.length;
        }
      }
    }
    const contextRank = { 'route-declaration': 0, 'redirect-target': 1, 'route-control-flow': 2, 'route-reference': 3 };
    evidence.sort((a, b) => (contextRank[a.contextType] - contextRank[b.contextType])
      || (a.file === entryBundle ? -1 : b.file === entryBundle ? 1 : 0)
      || a.file.localeCompare(b.file)
      || a.offset - b.offset);
    rows.push({
      path: routePath,
      observed: evidence.length > 0,
      occurrenceCount: evidence.length,
      declarationCount: evidence.filter((item) => item.contextType === 'route-declaration').length,
      evidence: evidence.slice(0, 12),
    });
  }
  return rows;
}

function extractChainRegistry(corpus, chains) {
  return chains.map((chain) => {
    const pattern = new RegExp(`(?:^|[,{])${chain.chainId}:\\{id:${chain.chainId},name:["']([^"']+)["'],displayName:["']([^"']+)["'][\\s\\S]{0,16000}?supportedPlatforms:\\[([^\\]]+)\\]`, 'g');
    const evidence = [];
    for (const file of corpus) {
      for (const match of file.text.matchAll(pattern)) {
        evidence.push({
          file: file.localPath,
          offset: match.index,
          registryName: match[1],
          displayName: match[2],
          supportedPlatformSymbols: uniqueBy(
            [...match[3].matchAll(/\.([A-Z][A-Z0-9_]+)/g)].map((item) => item[1]),
            (item) => item,
          ),
          snippet: compactSnippet(file.text, match.index, match.index + Math.min(match[0].length, 500), 260),
        });
      }
    }
    return { ...chain, observed: evidence.length > 0, evidence };
  });
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full, relative));
    else files.push(relative);
  }
  return files;
}

async function fileRecord(relativePath) {
  const full = path.join(OUTPUT, relativePath);
  const body = await readFile(full);
  const info = await stat(full);
  return {
    path: relativePath,
    bytes: info.size,
    sha256: sha256(body),
  };
}

async function writeJson(relativePath, value) {
  await writeFile(path.join(OUTPUT, relativePath), json(value));
}

async function main() {
  try {
    await access(OUTPUT);
    throw new Error(`Output directory already exists; refusing to mix snapshots: ${OUTPUT}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(OUTPUT, { recursive: true });

  const baselineMarkdown = await readFile(BASELINE_DOC, 'utf8');
  const baseline = parseBaseline(baselineMarkdown);

  const initial = [
    ['https://www.lpbot.cc/', 'index.html', 'homepage'],
    ['https://api.lpbot.cc/api/docs', 'api-docs.md', 'official-api-docs'],
    ['https://api.lpbot.cc/api/docs.json', 'api-docs.json', 'official-api-json'],
  ];
  for (const [urlValue, localPath, kind] of initial) {
    const url = normalizeUrl(urlValue);
    recordDiscovery(url, 'capture-root');
    queued.add(url.href);
    const result = await captureResource({ url, localPath, kind });
    if (result) discoverReferences(result);
  }

  while (queue.length > 0) {
    const item = queue.shift();
    const result = await captureResource(item);
    if (result) discoverReferences(result);
  }

  const indexHtml = await readFile(path.join(OUTPUT, 'index.html'), 'utf8');
  const apiDocsJson = JSON.parse(await readFile(path.join(OUTPUT, 'api-docs.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(OUTPUT, 'manifest.json'), 'utf8'));
  const corpus = collectBundleCorpus();
  const entries = currentEntryPaths(indexHtml);
  const officialApi = normalizeOfficialApi(apiDocsJson);
  const bundleCandidates = bundleApiCandidates(corpus);
  const routeEvidence = observedRoutes(corpus, baseline.routes, entries.bundle);
  const observedRouteSet = new Set(routeEvidence.filter((item) => item.observed).map((item) => item.path));

  const importValidation = uniqueBy(importEdges, (edge) => `${edge.sourceUrl}\u0000${edge.specifier}\u0000${edge.referenceType}`)
    .map((edge) => {
      const captured = fetched.get(edge.resolvedUrl);
      const invalid = invalidResponses.some((item) => item.url === edge.resolvedUrl);
      return {
        ...edge,
        localPath: captured?.metadata.localPath || null,
        status: !edge.firstParty ? 'external-excluded' : captured && !invalid ? 'captured' : invalid ? 'invalid-response' : 'missing',
        sha256: captured?.metadata.sha256 || null,
      };
    })
    .sort((a, b) => `${a.sourceUrl} ${a.specifier} ${a.referenceType}`.localeCompare(`${b.sourceUrl} ${b.specifier} ${b.referenceType}`));
  const moduleImports = importValidation.filter((edge) => ['static-import', 'dynamic-import', 'vite-map-dependency'].includes(edge.referenceType));
  const missingModuleImports = moduleImports.filter((edge) => edge.firstParty && edge.status !== 'captured');

  const baselineApiKeys = new Set(baseline.apiEndpoints.map((item) => `${item.method} ${item.path}`));
  const currentApiKeys = new Set(officialApi.map((item) => `${item.method} ${item.path}`));
  const addedApi = [...currentApiKeys].filter((key) => !baselineApiKeys.has(key)).sort();
  const removedApi = [...baselineApiKeys].filter((key) => !currentApiKeys.has(key)).sort();

  const mainHash = entries.bundle ? (await fileRecord(entries.bundle)).sha256 : null;
  const cssHash = entries.css ? (await fileRecord(entries.css)).sha256 : null;
  const currentHashes = {
    'index.html': (await fileRecord('index.html')).sha256,
    mainBundle: mainHash,
    mainCss: cssHash,
    'api-docs.md': (await fileRecord('api-docs.md')).sha256,
    'api-docs.json': (await fileRecord('api-docs.json')).sha256,
  };
  const hashComparison = Object.entries(baseline.hashes).map(([name, expected]) => ({
    artifact: name,
    expected,
    actual: currentHashes[name] || null,
    matches: currentHashes[name] === expected,
  }));

  const roles = ['user', 'pro', 'admin'].map((role) => ({
    id: role,
    source: 'docs/research/public-surface.md sections 6.1-6.2',
    liveBundleEvidence: exactLiteralEvidenceFor(corpus, role),
  }));
  const chainAccessLevels = [
    { id: 'off', semantics: 'blocks new creation while monitoring/removal remains available according to the documented baseline' },
    { id: 'pro', semantics: 'available to Pro users and administrators according to the documented baseline' },
    { id: 'all', semantics: 'available to ordinary, Pro, and administrator roles according to the documented baseline' },
  ].map((level) => ({
    ...level,
    source: 'docs/FUNCTION_MATRIX.md AUTH-10 and docs/research/public-surface.md section 6',
    liveBundleEvidence: exactLiteralEvidenceFor(corpus, level.id),
  }));
  const gateTerms = [
    { label: 'allowedChains property', pattern: '\\ballowedChains\\b' },
    { label: 'tier compared to pro', pattern: '\\btier(?:\\?\\.)?\\s*={2,3}\\s*["\']pro["\']' },
    { label: 'administrator flag', pattern: '\\bisAdmin\\b' },
    { label: 'fee hook API', pattern: '\\/api\\/(?:pools\\/)?(?:create-fee-hook|fee-hook(?:-lp)?|fee-hooks)' },
    { label: 'chain access configuration API', pattern: '\\/api\\/system-config\\/chains' },
  ];

  const routesJson = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      date: baseline.date,
      source: baseline.source,
      routes: baseline.routes,
      documentedRedirect: { from: '/monitors', to: '/pools' },
    },
    observed: {
      evidence: routeEvidence,
      uniquePaths: [...observedRouteSet].sort(),
    },
    comparison: {
      expectedCount: baseline.routes.length,
      missingExpectedRoutes: baseline.routes.map((item) => item.path).filter((route) => !observedRouteSet.has(route)),
      additionalCandidates: [...observedRouteSet].filter((route) => !baseline.routes.some((item) => item.path === route) && route !== '/monitors').sort(),
      note: 'A route is observed when its exact quoted path literal exists in the captured bundle. contextType distinguishes route declarations from references.',
    },
  };

  const apiCallsJson = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    officialPublicApi: {
      source: 'https://api.lpbot.cc/api/docs.json',
      sectionCount: (apiDocsJson.sections || []).length,
      endpointCount: officialApi.length,
      expectedBaselineCount: baseline.apiEndpoints.length,
      countStill59: officialApi.length === 59,
      endpoints: officialApi,
    },
    documentedBaseline: {
      source: baseline.source,
      endpointCount: baseline.apiEndpoints.length,
      endpoints: baseline.apiEndpoints,
    },
    comparison: { added: addedApi, removed: removedApi },
    bundleCandidates: {
      count: bundleCandidates.length,
      calls: bundleCandidates,
      caveat: 'These are LPBot first-party client call candidates. GET is the client default when no explicit method option appears before the next client function. Presence does not prove server availability or authorization.',
    },
  };

  const featureGatesJson = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceBoundary: 'Role and access semantics come from the frozen documentation baseline; live evidence records client-bundle occurrences only.',
    roles,
    chainAccessLevels,
    observedPredicates: {
      allowedChainsFilter: regexEvidenceFor(corpus, 'allowedChains filters chain registry', 'allowedChains[\\s\\S]{0,240}\\.filter\\([^)]{0,180}\\.has\\(', 8),
      proTier: regexEvidenceFor(corpus, 'Pro tier comparison', '\\btier(?:\\?\\.)?\\s*={2,3}\\s*["\']pro["\']', 12),
      administrator: regexEvidenceFor(corpus, 'administrator flag', '\\bisAdmin\\b', 12),
      proOrAdminFeeHook: regexEvidenceFor(corpus, 'admin or Pro fee-hook UI condition', '\\bisAdmin\\b[\\s\\S]{0,240}\\btier(?:\\?\\.)?\\s*={2,3}\\s*["\']pro["\']|\\btier(?:\\?\\.)?\\s*={2,3}\\s*["\']pro["\'][\\s\\S]{0,240}\\bisAdmin\\b', 12),
      chainAccessConfigApi: regexEvidenceFor(corpus, 'chain access config read/write client', '\\/api\\/system-config\\/chains', 12),
      feeHookApi: regexEvidenceFor(corpus, 'fee-hook client calls', '\\/api\\/(?:pools\\/)?(?:create-fee-hook|fee-hook(?:-lp)?|fee-hooks)', 12),
    },
    featureMatrix: baseline.featureGates,
    liveGateTerms: gateTerms.map(({ label, pattern }) => regexEvidenceFor(corpus, label, pattern, 12)),
  };

  const liveChainRegistry = extractChainRegistry(corpus, baseline.chains);
  const chainsJson = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      date: baseline.date,
      source: baseline.source,
      chains: baseline.chains,
      platformIds: [
        { id: 1, protocol: 'Uniswap V3' },
        { id: 2, protocol: 'PancakeSwap V3' },
        { id: 4, protocol: 'Uniswap V4' },
        { id: 5, protocol: 'PancakeSwap V4' },
      ],
    },
    liveBundleVerification: liveChainRegistry,
    caveat: 'Live records are parsed from chain registry objects containing id, name, displayName, and supportedPlatforms in the captured bundle.',
  };

  const pwaConfig = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifestUrl: 'https://www.lpbot.cc/manifest.json',
    manifest,
    htmlReferences: {
      manifest: [...indexHtml.matchAll(/<link\b[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]),
      icons: [...indexHtml.matchAll(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]),
      themeColorLiterals: uniqueBy([...indexHtml.matchAll(/#[a-fA-F0-9]{6}/g)].map((match) => match[0]), (item) => item),
    },
    serviceWorkerEvidence: evidenceFor(corpus, 'serviceWorker', 20),
  };

  const currentAssetNames = [...fetched.values()]
    .map((item) => item.metadata.localPath)
    .filter((item) => item.startsWith('assets/'))
    .sort();
  const baselineDiff = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baselineDate: baseline.date,
    baselineSource: baseline.source,
    hasDifferences: hashComparison.some((item) => !item.matches)
      || baseline.entryBundle !== entries.bundle
      || baseline.entryCss !== entries.css
      || addedApi.length > 0
      || removedApi.length > 0,
    contentHashes: hashComparison,
    entryAssets: {
      bundle: { expected: baseline.entryBundle, actual: entries.bundle, changed: baseline.entryBundle !== entries.bundle },
      css: { expected: baseline.entryCss, actual: entries.css, changed: baseline.entryCss !== entries.css },
    },
    publicApi: {
      expectedCount: baseline.apiEndpoints.length,
      actualCount: officialApi.length,
      countStill59: officialApi.length === 59,
      added: addedApi,
      removed: removedApi,
      severity: addedApi.length || removedApi.length ? 'P1' : null,
    },
    routes: routesJson.comparison,
    gates: {
      expectedRoles: roles.map((item) => item.id),
      expectedChainAccessLevels: chainAccessLevels.map((item) => item.id),
      missingVocabularyInBundle: [
        ...roles.filter((item) => item.liveBundleEvidence.occurrenceCount === 0).map((item) => item.id),
        ...chainAccessLevels.filter((item) => item.liveBundleEvidence.occurrenceCount === 0).map((item) => item.id),
      ],
      semanticComparison: 'No prior machine-readable gate artifact exists; this capture preserves the documented matrix and live client evidence separately.',
    },
    chains: {
      expectedChainIds: baseline.chains.map((item) => item.chainId),
      missingChainIdVocabularyInBundle: baseline.chains
        .filter((chain) => evidenceFor(corpus, String(chain.chainId), 0).occurrenceCount === 0)
        .map((chain) => chain.chainId),
      semanticComparison: 'No prior machine-readable chain artifact exists; exact vocabulary presence is reported without inferring server enablement.',
    },
    documentedChunkNames: {
      expected: baseline.documentedChunks,
      missingExactNames: baseline.documentedChunks.filter((name) => !currentAssetNames.includes(`assets/${name}`)),
      note: 'Hashed chunk filename changes are expected after a rebuild; import-graph completeness is validated independently.',
    },
    notes: [
      'The existing research documents were not modified.',
      'Hash changes can include build-only changes; API method/path additions are reported separately as semantic drift.',
    ],
  };

  const uniqueExternal = uniqueBy(externalReferences, (item) => `${item.url}\u0000${item.discoveredBy}\u0000${item.referenceType}`)
    .sort((a, b) => `${a.url} ${a.discoveredBy}`.localeCompare(`${b.url} ${b.discoveredBy}`));
  const missingResources = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    failedRequests: failures,
    invalidResponses,
    unresolvedFirstPartyModuleImports: missingModuleImports,
    externalReferencesExcluded: uniqueExternal,
    summary: {
      failedRequestCount: failures.length,
      invalidResponseCount: invalidResponses.length,
      unresolvedFirstPartyModuleImportCount: missingModuleImports.length,
      excludedExternalReferenceCount: uniqueExternal.length,
    },
  };

  const captureComplete = failures.length === 0 && invalidResponses.length === 0 && missingModuleImports.length === 0;
  const captureReport = {
    schemaVersion: 1,
    task: 'P00-01 freeze LPBot production baseline',
    startedAt: STARTED_AT,
    completedAt: new Date().toISOString(),
    command: `node scripts/freeze-lpbot-baseline.mjs ${path.relative(ROOT, OUTPUT)}`,
    requestPolicy: {
      allowedMethods: ['GET'],
      methodsActuallyUsed: [...methodsUsed].sort(),
      allowedOrigins: [...ALLOWED_ORIGINS].sort(),
      credentials: 'omit',
      formsSubmitted: 0,
      productionWriteApiCalls: 0,
      signatures: 0,
      transactionsBroadcast: 0,
    },
    counts: {
      fetchedResources: fetched.size,
      javascriptFiles: corpus.length,
      cssFiles: [...fetched.values()].filter((item) => item.metadata.localPath.endsWith('.css')).length,
      firstPartyModuleImportEdges: moduleImports.filter((edge) => edge.firstParty).length,
      officialApiEndpoints: officialApi.length,
      bundleApiCandidates: bundleCandidates.length,
      routesWithEvidence: observedRouteSet.size,
      featureGateRows: baseline.featureGates.length,
      chains: baseline.chains.length,
    },
    validations: {
      readOnlyRequestsOnly: { pass: methodsUsed.size === 1 && methodsUsed.has('GET'), actual: [...methodsUsed] },
      publicApiCountStill59: { pass: officialApi.length === 59, expected: 59, actual: officialApi.length },
      allFirstPartyModuleImportsCaptured: { pass: missingModuleImports.length === 0, missing: missingModuleImports.length },
      allResponsesValid: { pass: failures.length === 0 && invalidResponses.length === 0, failures: failures.length, invalid: invalidResponses.length },
      machineReadableOutputs: { pass: true, files: ['routes.json', 'api-calls.json', 'feature-gates.json', 'chains.json'] },
      captureComplete: { pass: captureComplete },
      baselineMatches: { pass: !baselineDiff.hasDifferences },
    },
    checksumVerificationCommand: `cd ${path.relative(ROOT, OUTPUT)} && sha256sum --check sha256sums.txt`,
  };

  await writeJson('asset-imports.json', {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    edges: importValidation,
    summary: {
      totalEdges: importValidation.length,
      firstPartyModuleImports: moduleImports.filter((edge) => edge.firstParty).length,
      unresolvedFirstPartyModuleImports: missingModuleImports.length,
    },
  });
  await writeJson('routes.json', routesJson);
  await writeJson('api-calls.json', apiCallsJson);
  await writeJson('feature-gates.json', featureGatesJson);
  await writeJson('chains.json', chainsJson);
  await writeJson('pwa-config.json', pwaConfig);
  await writeJson('baseline-diff.json', baselineDiff);
  await writeJson('missing-resources.json', missingResources);
  await writeJson('capture-report.json', captureReport);
  await mkdir(path.join(OUTPUT, 'tools'), { recursive: true });
  await writeFile(
    path.join(OUTPUT, 'tools/freeze-lpbot-baseline.mjs'),
    await readFile(path.join(ROOT, 'scripts/freeze-lpbot-baseline.mjs')),
  );
  await writeFile(
    path.join(OUTPUT, 'commands.txt'),
    [
      `$ node scripts/freeze-lpbot-baseline.mjs ${path.relative(ROOT, OUTPUT)}`,
      `$ cd ${path.relative(ROOT, OUTPUT)}`,
      '$ sha256sum --check sha256sums.txt',
      '$ for file in *.json; do jq empty "$file"; done',
      '$ find . -type f -print | LC_ALL=C sort',
      '',
    ].join('\n'),
  );

  const plannedFileList = [
    ...(await listFiles(OUTPUT)),
    'artifact-manifest.json',
    'file-list.txt',
    'sha256sums.txt',
  ].sort();
  await writeFile(path.join(OUTPUT, 'file-list.txt'), `${uniqueBy(plannedFileList, (item) => item).join('\n')}\n`);

  const sourceRecords = [...fetched.values()]
    .map((item) => item.metadata)
    .sort((a, b) => a.localPath.localeCompare(b.localPath));
  const preManifestFiles = (await listFiles(OUTPUT)).filter((item) => !['artifact-manifest.json', 'sha256sums.txt'].includes(item));
  const fileRecords = await Promise.all(preManifestFiles.map(fileRecord));
  const sourceByPath = new Map(sourceRecords.map((item) => [item.localPath, item]));
  const artifactManifest = {
    schemaVersion: 1,
    task: 'P00-01',
    target: 'LPBot public production surface',
    baselineDate: '2026-08-13',
    capturedAt: captureReport.completedAt,
    timezone: 'Asia/Shanghai',
    requestPolicy: captureReport.requestPolicy,
    entrypoints: {
      homepage: 'index.html',
      mainBundle: entries.bundle,
      mainCss: entries.css,
      webManifest: 'manifest.json',
      apiDocs: 'api-docs.md',
      apiDocsJson: 'api-docs.json',
    },
    validations: captureReport.validations,
    sources: sourceRecords,
    files: fileRecords.map((record) => ({
      ...record,
      kind: sourceByPath.has(record.path) ? 'remote-capture' : 'derived',
      sourceUrl: sourceByPath.get(record.path)?.url || null,
    })),
  };
  await writeJson('artifact-manifest.json', artifactManifest);

  const checksumFiles = (await listFiles(OUTPUT)).filter((item) => item !== 'sha256sums.txt');
  const checksumRecords = await Promise.all(checksumFiles.map(fileRecord));
  const checksumText = checksumRecords.map((record) => `${record.sha256}  ${record.path}`).join('\n') + '\n';
  await writeFile(path.join(OUTPUT, 'sha256sums.txt'), checksumText);

  process.stdout.write(json({
    output: path.relative(ROOT, OUTPUT),
    captureComplete,
    fetchedResources: fetched.size,
    assets: currentAssetNames.length,
    javascriptFiles: corpus.length,
    cssFiles: captureReport.counts.cssFiles,
    moduleImports: moduleImports.length,
    missingModuleImports: missingModuleImports.length,
    apiEndpoints: officialApi.length,
    apiCountStill59: officialApi.length === 59,
    apiAdded: addedApi,
    apiRemoved: removedApi,
    checksumEntries: checksumRecords.length,
  }));

  if (!captureComplete) process.exitCode = 1;
}

await main();
