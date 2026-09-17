import assert from 'node:assert/strict';
import test from 'node:test';
import { findCc4License, readSerperKey, searchSerperCc4Images } from '../server/src/services/serper-image-search-service';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);

function response(bytes: string | Buffer, contentType: string, headers: Record<string, string> = {}): Response {
  return new Response(typeof bytes === 'string' ? bytes : new Uint8Array(bytes), {
    status: 200, headers: { 'Content-Type': contentType, ...headers },
  });
}

const ccBy = { Link: '<https://creativecommons.org/licenses/by/4.0/>; rel="license"' };
const ccBySa = { Link: '<https://creativecommons.org/licenses/by-sa/4.0/>; rel="license"' };

test('Serper key is read only from the server environment and trimmed', () => {
  const original = process.env.serper_api_key;
  try {
    process.env.serper_api_key = '  fixture-key  ';
    assert.equal(readSerperKey(), 'fixture-key');
    delete process.env.serper_api_key;
    assert.equal(readSerperKey(), '');
  } finally {
    if (original === undefined) delete process.env.serper_api_key;
    else process.env.serper_api_key = original;
  }
});

test('CC 4.0 detection accepts exact attribution licenses and rejects broad or older licenses', () => {
  assert.deepEqual(findCc4License('<a rel="license" href="https://creativecommons.org/licenses/by/4.0/">license</a>'), {
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  });
  assert.deepEqual(findCc4License('<meta property="license" content="http://creativecommons.org/licenses/by-sa/4.0">'), {
    license: 'CC BY-SA 4.0', licenseUrl: 'http://creativecommons.org/licenses/by-sa/4.0',
  });
  assert.equal(findCc4License('<a href="https://creativecommons.org/licenses/by/3.0/">license</a>'), null);
  assert.equal(findCc4License('<p>Creative Commons licensed</p>'), null);
});

test('Serper image search requests India and Telugu and emits each verified image as it resolves', async () => {
  let releaseSecond = () => {};
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const calls: string[] = [];
  let searchBody: Record<string, unknown> | undefined;
  const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://google.serper.dev/images') {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-API-KEY'], 'fixture-key');
      searchBody = JSON.parse(String(init?.body));
      return Response.json({ images: [
        { title: 'First', imageUrl: 'https://images.example/first.png', link: 'https://source.example/first', source: 'First source' },
        { title: 'Second', imageUrl: 'https://images.example/second.jpg', link: 'https://source.example/second', domain: 'source.example' },
      ] });
    }
    if (url === 'https://images.example/second.jpg') {
      await secondGate;
      return response(jpeg, 'image/jpeg', ccBySa);
    }
    if (url === 'https://images.example/first.png') return response(png, 'image/png', ccBy);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const accepted: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let notifyFirst = () => {};
  const firstAccepted = new Promise<void>(resolve => { notifyFirst = resolve; });
  let completed = false;
  const task = searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(), image => {
    accepted.push(image.title);
    if (accepted.length === 1) notifyFirst();
    return true;
  }, { request: request as typeof fetch, assertPublicUrl: async () => {}, maxPages: 1, log: event => logs.push(event) }).then(count => {
    completed = true;
    return count;
  });

  await firstAccepted;
  assert.deepEqual(accepted, ['First']);
  assert.equal(completed, false);
  assert.deepEqual(searchBody, { q: 'చెట్టు', gl: 'in', hl: 'te', page: 1, tbs: 'sur:cl' });
  releaseSecond();
  assert.equal(await task, 2);
  assert.deepEqual(new Set(accepted), new Set(['First', 'Second']));
  assert.ok(calls.includes('https://images.example/first.png'));
  assert.equal(calls.some(url => url.startsWith('https://source.example/')), false);
  assert.ok(logs.some(event => event.event === 'page' && event.returned === 2));
  assert.ok(logs.some(event => event.event === 'complete' && event.accepted === 2));
  assert.doesNotMatch(JSON.stringify(logs), /fixture-key|images\.example/);
});

test('Wikimedia images use image metadata instead of an oversized Wikipedia article', async () => {
  const calls: string[] = [];
  const request = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://google.serper.dev/images') return Response.json({ images: [{
      title: 'President Barack Obama',
      imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/1280px-President_Barack_Obama.jpg',
      link: 'https://en.wikipedia.org/wiki/Barack_Obama',
      source: 'Wikipedia',
    }] });
    if (url.startsWith('https://commons.wikimedia.org/w/api.php?')) return response(JSON.stringify({ query: { pages: [{
      imageinfo: [{ extmetadata: { LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }],
    }] } }), 'application/json');
    if (url.startsWith('https://thumb.wikimedia.org/')) return response(png, 'image/png');
    throw new Error(`Unexpected URL: ${url}`);
  };
  const accepted: string[] = [];
  const count = await searchSerperCc4Images('అధ్యక్షుడు', 'fixture-key', new Set(), image => {
    accepted.push(image.title);
    return true;
  }, { request: request as typeof fetch, assertPublicUrl: async () => {}, maxPages: 1, log: () => {} });
  assert.equal(count, 1);
  assert.deepEqual(accepted, ['President Barack Obama']);
  assert.equal(calls.includes('https://en.wikipedia.org/wiki/Barack_Obama'), false);
});

test('Serper image search stops after eight qualifying results from a page', async () => {
  const candidates = Array.from({ length: 12 }, (_value, index) => ({
    title: `Image ${index}`,
    imageUrl: `https://images.example/${index}.png`,
    link: `https://source.example/${index}`,
  }));
  const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://google.serper.dev/images') {
      assert.equal('num' in (JSON.parse(String(init?.body)) as Record<string, unknown>), false);
      return Response.json({ images: candidates });
    }
    if (url.startsWith('https://images.example/')) return response(png, 'image/png', ccBy);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const accepted: string[] = [];
  const count = await searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(), image => {
    accepted.push(image.title);
    return true;
  }, { request: request as typeof fetch, assertPublicUrl: async () => {}, log: () => {} });
  assert.equal(count, 8);
  assert.equal(accepted.length, 8);
});

test('Serper image search continues across pages until eight images qualify', async () => {
  const pages: number[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://google.serper.dev/images') {
      const page = (JSON.parse(String(init?.body)) as { page: number }).page;
      pages.push(page);
      return Response.json({ images: Array.from({ length: 4 }, (_value, index) => ({
        title: `Page ${page} image ${index}`,
        imageUrl: `https://images.example/${page}-${index}.png`,
        link: `https://source.example/${page}-${index}`,
      })) });
    }
    if (url.startsWith('https://images.example/')) return response(png, 'image/png', ccBy);
    throw new Error(`Unexpected URL: ${url}`);
  };
  let nextPage = 0;
  const count = await searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(), () => true, {
    request: request as typeof fetch,
    assertPublicUrl: async () => {},
    log: () => {},
    onComplete: summary => { nextPage = summary.nextPage; },
  });
  assert.equal(count, 8);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(nextPage, 3);
});

test('Serper image search caps a batch at ten pages when fewer than eight qualify', async () => {
  const pages: number[] = [];
  let summary: { accepted: number; candidatesSeen: number; pagesSearched: number; nextPage: number } | undefined;
  const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://google.serper.dev/images') {
      const page = (JSON.parse(String(init?.body)) as { page: number }).page;
      pages.push(page);
      return Response.json({ images: [{ title: `Image ${page}`, imageUrl: `https://images.example/${page}.png`, link: `https://source.example/${page}` }] });
    }
    if (url.startsWith('https://images.example/')) return response(png, 'image/png', {
      Link: '<https://creativecommons.org/licenses/by/3.0/>; rel="license"',
    });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const count = await searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(), () => true, {
    request: request as typeof fetch, assertPublicUrl: async () => {}, log: () => {}, onComplete: value => { summary = value; },
  });
  assert.equal(count, 0);
  assert.equal(pages.length, 10);
  assert.deepEqual(summary, { accepted: 0, candidatesSeen: 10, pagesSearched: 10, nextPage: 11 });
});

test('Serper image search honors the batch duration cap before another page request', async () => {
  let requests = 0;
  let summary: { accepted: number; candidatesSeen: number; pagesSearched: number; nextPage: number } | undefined;
  const count = await searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(), () => true, {
    request: async () => { requests += 1; return Response.json({ images: [] }); },
    assertPublicUrl: async () => {},
    maxDurationMs: 0,
    log: () => {},
    onComplete: value => { summary = value; },
  });
  assert.equal(count, 0);
  assert.equal(requests, 0);
  assert.deepEqual(summary, { accepted: 0, candidatesSeen: 0, pagesSearched: 0, nextPage: 1 });
});

test('Serper image search excludes repeats and images without exact CC 4.0 evidence', async () => {
  const request = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url === 'https://google.serper.dev/images') return Response.json({ images: [
      { title: 'Repeat', imageUrl: 'https://images.example/repeat.png', link: 'https://source.example/repeat' },
      { title: 'Old license', imageUrl: 'https://images.example/old.png', link: 'https://source.example/old' },
    ] });
    if (url === 'https://images.example/old.png') return response(png, 'image/png', {
      Link: '<https://creativecommons.org/licenses/by/3.0/>; rel="license"',
    });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const accepted: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const rejected: Array<{ imageUrl: string; reason: string }> = [];
  const count = await searchSerperCc4Images('చెట్టు', 'fixture-key', new Set(['https://images.example/repeat.png']),
    image => { accepted.push(image.title); return true; }, {
      request: request as typeof fetch, assertPublicUrl: async () => {}, maxPages: 1, log: event => logs.push(event),
      onRejected: rejection => rejected.push(rejection),
    });
  assert.equal(count, 0);
  assert.deepEqual(accepted, []);
  assert.ok(logs.some(event => event.event === 'rejected' && event.reason === 'no-image-level-cc4-license'));
  assert.ok(logs.some(event => event.event === 'complete'
    && (event.rejected as Record<string, number>)['no-image-level-cc4-license'] === 1));
  assert.deepEqual(rejected, [{ imageUrl: 'https://images.example/old.png', reason: 'no-image-level-cc4-license' }]);
});
