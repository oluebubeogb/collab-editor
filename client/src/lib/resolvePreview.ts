/**
 * DOM-based HTML/CSS resolver for the live preview.
 * Handles <base href>, relative & root-relative paths, CSS url()/@import,
 * and click interception for links created dynamically by JS.
 */

import {
  getQueryAndHash,
  isHtmlFile,
  resolveRelativePath,
  stripQueryAndHash
} from './fileTypes'

/**
 * Rewrite url() and @import inside a CSS string so they point at data URLs
 * or inlined content from the virtual FS.
 */
export function rewriteCss(
  css: string,
  cssPath: string,
  texts: Record<string, string>,
  binaries: Record<string, string>,
  visited: Set<string>
): string {
  css = css.replace(
    /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*;?/gi,
    (match, _q, ref) => {
      const resolved = resolveRelativePath(cssPath, ref)
      if (!resolved) return match
      const file = stripQueryAndHash(resolved)
      if (texts[file] !== undefined) {
        if (visited.has(file)) return `/* circular @import: ${file} */`
        visited.add(file)
        const inlined = rewriteCss(texts[file], file, texts, binaries, visited)
        return `/* @import ${ref} */\n${inlined}\n`
      }
      if (binaries[file] !== undefined) {
        return `@import url("${binaries[file]}");`
      }
      return match
    }
  )

  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _q, ref) => {
    const trimmed = ref.trim()
    if (/^(data:|https?:|\/\/)/i.test(trimmed)) return match
    const resolved = resolveRelativePath(cssPath, trimmed)
    if (!resolved) return match
    const file = stripQueryAndHash(resolved)
    if (binaries[file] !== undefined) {
      return `url("${binaries[file]}")`
    }
    if (texts[file] !== undefined) {
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'
      const encoded = encodeURIComponent(texts[file])
      return `url("data:${mime};charset=utf-8,${encoded}")`
    }
    return match
  })

  return css
}

function buildEarlyScript(query: string): string {
  return `
<script>
(function () {
  function makeStorage() {
    var data = {}
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null },
      setItem: function (k, v) { data[k] = String(v) },
      removeItem: function (k) { delete data[k] },
      clear: function () { data = {} },
      key: function (i) { return Object.keys(data)[i] || null },
      get length() { return Object.keys(data).length }
    }
  }
  try { window.localStorage.getItem('__t') } catch (e) {
    Object.defineProperty(window, 'localStorage', { value: makeStorage(), configurable: true })
  }
  try { window.sessionStorage.getItem('__t') } catch (e) {
    Object.defineProperty(window, 'sessionStorage', { value: makeStorage(), configurable: true })
  }
  ${
    query
      ? `
  var __vfsQuery = ${JSON.stringify(query)}
  try {
    var __OrigUSP = window.URLSearchParams
    window.URLSearchParams = function (init) {
      if (init === undefined || init === '' || init === location.search) {
        return new __OrigUSP(__vfsQuery)
      }
      return new __OrigUSP(init)
    }
    window.URLSearchParams.prototype = __OrigUSP.prototype
  } catch (e) {}
  try { history.replaceState(null, '', location.pathname + __vfsQuery) } catch (e) {}
  `
      : ''
  }
})()
</script>
`
}

/**
 * Late script intercepts ALL anchor clicks (including links injected by JS)
 * and navigates the parent preview when the target is a known HTML file.
 */
function buildLateScript(
  currentPath: string,
  htmlPaths: string[],
  baseHref: string | null
): string {
  return `
<script>
(function () {
  var __vfsHtmlFiles = ${JSON.stringify(htmlPaths)};
  var __vfsCurrentPath = ${JSON.stringify(currentPath)};
  var __vfsBaseHref = ${JSON.stringify(baseHref)};

  function stripQueryHash(p) {
    var i = p.search(/[?#]/);
    return i === -1 ? p : p.slice(0, i);
  }

  function getParentFolder(p) {
    var i = p.lastIndexOf('/');
    return i === -1 ? null : p.slice(0, i);
  }

  function resolveRelative(basePath, ref) {
    var trimmed = (ref || '').trim();
    if (!trimmed) return null;
    if (/^([a-z]+:)?\\/\\//i.test(trimmed)) return null;
    if (/^(data|mailto|tel|javascript):/i.test(trimmed)) return null;
    if (trimmed.startsWith('#')) return null;

    var isRoot = trimmed.startsWith('/');
    var baseFolder = isRoot ? null : getParentFolder(basePath);
    var segments = (baseFolder ? baseFolder.split('/') : []).concat(
      trimmed.split('/').filter(function (s) { return s.length > 0; })
    );
    var resolved = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg === '.') continue;
      if (seg === '..') resolved.pop();
      else resolved.push(seg);
    }
    return resolved.join('/');
  }

  function resolveRef(ref) {
    var trimmed = (ref || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/')) return resolveRelative(__vfsCurrentPath, trimmed);
    if (__vfsBaseHref) {
      var base = __vfsBaseHref.replace(/^\\//, '').replace(/\\/?$/, '');
      var synthetic = base ? base + '/__base__' : '__base__';
      return resolveRelative(synthetic, trimmed);
    }
    return resolveRelative(__vfsCurrentPath, trimmed);
  }

  function isKnownHtml(path) {
    var bare = stripQueryHash(path || '');
    return __vfsHtmlFiles.indexOf(bare) !== -1;
  }

  function navigate(path) {
    window.parent.postMessage({ type: 'vfs-navigate', path: path }, '*');
  }

  // Expose for scripts that want to navigate intentionally
  window.__vfsNavigate = navigate;

  document.addEventListener('click', function (e) {
    var el = e.target.closest('a[href], [data-vfs-nav]');
    if (!el) return;

    // Explicit nav attribute wins
    var forced = el.getAttribute('data-vfs-nav');
    if (forced) {
      e.preventDefault();
      navigate(forced);
      return;
    }

    var href = el.getAttribute('href');
    if (!href) return;
    var resolved = resolveRef(href);
    if (!resolved) return; // external / mailto / etc.
    if (!isKnownHtml(resolved)) return;

    e.preventDefault();
    navigate(resolved);
  }, true);

  window.onerror = function (msg, src, line, col, err) {
    try {
      window.parent.postMessage({
        type: 'vfs-error',
        message: String(msg),
        source: src || '',
        line: line || 0,
        col: col || 0,
        stack: err && err.stack ? String(err.stack) : ''
      }, '*');
    } catch (e) {}
    try {
      document.body.insertAdjacentHTML('beforeend',
        '<pre style="color:#f87171;font-family:monospace;padding:8px;">' + msg + '</pre>');
    } catch (e) {}
    return false;
  };

  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var reason = ev.reason;
      var message = reason && reason.message ? reason.message : String(reason);
      var stack = reason && reason.stack ? String(reason.stack) : '';
      window.parent.postMessage({ type: 'vfs-error', message: 'Unhandled rejection: ' + message, stack: stack }, '*');
    } catch (e) {}
  });

  ;['log','warn','error','info'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        var args = Array.prototype.slice.call(arguments).map(function (a) {
          try {
            if (a instanceof Error) return a.message + (a.stack ? '\\n' + a.stack : '');
            return typeof a === 'string' ? a : JSON.stringify(a);
          } catch (e) { return String(a); }
        });
        var payload = { type: 'vfs-console', level: level, args: args };
        if (level === 'error' && arguments[0] instanceof Error && arguments[0].stack) {
          payload.stack = String(arguments[0].stack);
        }
        window.parent.postMessage(payload, '*');
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  });
})();
</script>
`
}

function resolveRef(
  currentFilePath: string,
  ref: string,
  baseHref: string | null
): string | null {
  const trimmed = ref.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/')) {
    return resolveRelativePath(currentFilePath, trimmed)
  }

  if (baseHref) {
    const base = baseHref.replace(/^\//, '').replace(/\/?$/, '')
    const syntheticFile = base ? `${base}/__base__` : '__base__'
    return resolveRelativePath(syntheticFile, trimmed)
  }

  return resolveRelativePath(currentFilePath, trimmed)
}

/**
 * Build a fully-resolved HTML string for srcDoc from the virtual FS.
 */
export function resolveHtml(
  rawPath: string,
  texts: Record<string, string>,
  binaries: Record<string, string>,
  visited: Set<string> = new Set()
): string {
  const path = stripQueryAndHash(rawPath)
  const query = getQueryAndHash(rawPath)

  if (visited.has(path)) {
    return `<p style="font-family:monospace;color:#f87171;padding:16px">Circular reference detected at ${path}</p>`
  }
  const raw = texts[path]
  if (raw === undefined) {
    return `<p style="font-family:monospace;color:#f87171;padding:16px">File not found: ${path}</p>`
  }
  visited.add(path)

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(raw, 'text/html')
  } catch {
    return raw
  }

  let baseHref: string | null = null
  const baseEl = doc.querySelector('base[href]')
  if (baseEl) {
    const href = baseEl.getAttribute('href') || ''
    if (href && !/^([a-z]+:)?\/\//i.test(href) && !/^(data|mailto):/i.test(href)) {
      baseHref = href
    }
  }

  const resolve = (ref: string) => resolveRef(path, ref, baseHref)

  // stylesheets
  doc.querySelectorAll('link[rel]').forEach((link) => {
    const rel = (link.getAttribute('rel') || '').toLowerCase()
    if (!rel.split(/\s+/).includes('stylesheet')) return
    const href = link.getAttribute('href')
    if (!href) return
    const resolved = resolve(href)
    const file = resolved ? stripQueryAndHash(resolved) : null
    if (file && texts[file] !== undefined) {
      const style = doc.createElement('style')
      style.setAttribute('data-src', href)
      const cssVisited = new Set<string>([file])
      style.textContent = rewriteCss(texts[file], file, texts, binaries, cssVisited)
      link.replaceWith(style)
    }
  })

  doc.querySelectorAll('style').forEach((style) => {
    if (style.hasAttribute('data-src')) return
    style.textContent = rewriteCss(style.textContent || '', path, texts, binaries, new Set())
  })

  // script src → inline (so footer nav JS runs inside the preview)
  doc.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src')
    if (!src) return
    const resolved = resolve(src)
    const file = resolved ? stripQueryAndHash(resolved) : null
    if (file && texts[file] !== undefined) {
      script.removeAttribute('src')
      script.textContent = texts[file]
    }
  })

  const ATTRS = ['src', 'href', 'poster', 'data']
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of ATTRS) {
      if (!el.hasAttribute(attr)) continue
      const value = el.getAttribute(attr)!
      const resolved = resolve(value)
      if (!resolved) continue
      const file = stripQueryAndHash(resolved)

      if (binaries[file] !== undefined) {
        el.setAttribute(attr, binaries[file])
        continue
      }

      if (attr === 'href' && isHtmlFile(file) && texts[file] !== undefined) {
        el.setAttribute('href', '#')
        el.setAttribute('data-vfs-nav', resolved)
      }
    }
  })

  doc.querySelectorAll('[srcset]').forEach((el) => {
    const srcset = el.getAttribute('srcset') || ''
    const rewritten = srcset
      .split(',')
      .map((part) => {
        const bits = part.trim().split(/\s+/)
        const url = bits[0]
        const rest = bits.slice(1).join(' ')
        const resolved = resolve(url)
        if (!resolved) return part
        const file = stripQueryAndHash(resolved)
        if (binaries[file] !== undefined) {
          return `${binaries[file]}${rest ? ' ' + rest : ''}`
        }
        return part
      })
      .join(', ')
    el.setAttribute('srcset', rewritten)
  })

  const htmlPaths = Object.keys(texts).filter((p) => isHtmlFile(p))
  const early = buildEarlyScript(query)
  const late = buildLateScript(path, htmlPaths, baseHref)

  const head = doc.querySelector('head') || doc.documentElement
  head.insertAdjacentHTML('afterbegin', early)

  const body = doc.querySelector('body') || doc.documentElement
  body.insertAdjacentHTML('beforeend', late)

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
}
