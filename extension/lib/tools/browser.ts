import { TOOL_NAMES } from 'underpixel-shared';
import { toolRegistry } from './registry';
import { resolveTabId, getActiveTabId } from './tab-utils';

// ---- navigate ----

toolRegistry.register(TOOL_NAMES.NAVIGATE, async (args) => {
  const url = args.url as string;
  const newTab = args.newTab as boolean | undefined;
  let tabId = resolveTabId(args.tabId);

  // Default to new tab unless a specific tabId was given or newTab is explicitly false
  if (newTab === true || (!tabId && newTab !== false)) {
    const tab = await chrome.tabs.create({ url, active: true });
    return {
      summary: `Opened ${url} in new tab`,
      tabId: tab.id,
      url,
    };
  }

  if (!tabId) {
    tabId = await getActiveTabId();
  }

  try {
    await chrome.tabs.update(tabId!, { url });
  } catch {
    // Tab may have been closed — fall back to new tab
    const tab = await chrome.tabs.create({ url, active: true });
    return {
      summary: `Tab ${tabId} was closed, opened ${url} in new tab`,
      tabId: tab.id,
      url,
    };
  }

  // Wait for navigation to complete (only set up after tabs.update succeeds)
  await new Promise<void>((resolve) => {
    const finalTabId = tabId!;
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === finalTabId && changeInfo.status === 'complete') {
        clearTimeout(navTimeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    const navTimeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30_000);
  });

  return {
    summary: `Navigated to ${url}`,
    tabId,
    url,
  };
});

// ---- interact ----

toolRegistry.register(TOOL_NAMES.INTERACT, async (args) => {
  const action = args.action as string;
  const selector = args.selector as string | undefined;
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  switch (action) {
    case 'click': {
      if (!selector) throw new Error('selector required for click action');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return { error: `Element not found: ${sel}` };
          (el as HTMLElement).click();
          return { clicked: sel };
        },
        args: [selector],
      });
      if (result?.result?.error) throw new Error(result.result.error);
      return { summary: `Clicked ${selector}`, ...result?.result };
    }

    case 'fill': {
      if (!selector) throw new Error('selector required for fill action');
      const value = args.value as string;
      if (value === undefined) throw new Error('value required for fill action');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string, val: string) => {
          const el = document.querySelector(sel) as HTMLInputElement;
          if (!el) return { error: `Element not found: ${sel}` };
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { filled: sel, value: val };
        },
        args: [selector, value],
      });
      if (result?.result?.error) throw new Error(result.result.error);
      return { summary: `Filled ${selector} with "${value}"`, ...result?.result };
    }

    case 'scroll': {
      const direction = (args.direction as string) || 'down';
      const amount = direction === 'down' ? 500 : -500;
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (px: number) => window.scrollBy(0, px),
        args: [amount],
      });
      return { summary: `Scrolled ${direction}` };
    }

    case 'type': {
      const text = args.value as string;
      if (!text) throw new Error('value required for type action');
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (t: string) => {
          const el = document.activeElement as HTMLInputElement;
          if (el && 'value' in el) {
            el.value += t;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        },
        args: [text],
      });
      return { summary: `Typed "${text}"` };
    }

    case 'press': {
      const key = args.key as string;
      if (!key) throw new Error('key required for press action');
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (k: string) => {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: k, bubbles: true }),
          );
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keyup', { key: k, bubbles: true }),
          );
        },
        args: [key],
      });
      return { summary: `Pressed ${key}` };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
});

// ---- page_read ----

toolRegistry.register(TOOL_NAMES.PAGE_READ, async (args) => {
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();
  const filter = (args.filter as string) || 'all';

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (filterType: string) => {
      function buildTree(el: Element, depth = 0): string {
        const lines: string[] = [];
        const indent = '  '.repeat(depth);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const label =
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder');

        // Skip hidden elements
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return '';

        const isInteractive =
          ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
          el.getAttribute('tabindex') !== null ||
          role === 'button' ||
          role === 'link';

        if (filterType === 'interactive' && !isInteractive && depth > 0) {
          // Still recurse children to find nested interactive elements
          for (const child of el.children) {
            const childTree = buildTree(child, depth);
            if (childTree) lines.push(childTree);
          }
          return lines.join('\n');
        }

        let desc = `${indent}[${tag}`;
        if (role) desc += ` role=${role}`;
        if (label) desc += ` "${label}"`;
        if (tag === 'a') desc += ` href="${el.getAttribute('href')}"`;
        if (tag === 'input')
          desc += ` type=${(el as HTMLInputElement).type} value="${(el as HTMLInputElement).value}"`;
        const text = el.childNodes[0]?.nodeType === 3 ? el.childNodes[0].textContent?.trim() : '';
        if (text && text.length < 100) desc += ` "${text}"`;
        desc += ']';

        lines.push(desc);

        for (const child of el.children) {
          const childTree = buildTree(child, depth + 1);
          if (childTree) lines.push(childTree);
        }

        return lines.join('\n');
      }

      return buildTree(document.body);
    },
    args: [filter],
  });

  return {
    summary: `Page structure (${filter} elements)`,
    content: result?.result || '',
  };
});

// ---- screenshot ----

toolRegistry.register(TOOL_NAMES.SCREENSHOT, async (args) => {
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  // Ensure the tab is focused for captureVisibleTab
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tabId, { active: true });

  // Small delay to ensure tab is rendered
  await new Promise((r) => setTimeout(r, 200));

  // Use JPEG at reduced quality to keep response size manageable for MCP
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, {
    format: 'jpeg',
    quality: 50,
  });

  // Most viewport JPEG screenshots are 80-120KB = 110-160K base64 chars.
  // Allow up to 200K chars inline (~150KB decoded) to cover the common case.
  const MAX_INLINE_CHARS = 200_000;
  const timestamp = Date.now();
  const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);

  if (dataUrl.length <= MAX_INLINE_CHARS) {
    return {
      summary: `Screenshot captured (${sizeKB}KB)`,
      dataUrl,
      tabId,
      timestamp,
      sizeKB,
    };
  }

  // Too large for inline — store in IndexedDB and return reference
  try {
    const { db } = await import('../storage/db');
    const database = await db();
    const id = crypto.randomUUID();
    await database.put('screenshots', {
      id,
      sessionId: '',
      timestamp,
      dataUrl,
      width: 0,
      height: 0,
      trigger: 'manual' as const,
    });
    return {
      summary: `Screenshot captured (${sizeKB}KB, stored as reference — too large for inline)`,
      screenshotId: id,
      tabId,
      timestamp,
      sizeKB,
      hint: 'Use underpixel_snapshot_at to retrieve this screenshot by timestamp',
    };
  } catch {
    return {
      summary: `Screenshot captured (${sizeKB}KB) but too large to return inline or store`,
      tabId,
      timestamp,
      sizeKB,
    };
  }
});

// ---- dom_text ----

toolRegistry.register(TOOL_NAMES.DOM_TEXT, async (args) => {
  const selector = args.selector as string;
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  let result: { result?: { error?: string; count?: number; texts?: unknown[] } };
  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string) => {
        const elements = document.querySelectorAll(sel);
        if (elements.length === 0) return { error: `No elements found: ${sel}` };

        const MAX_TEXT = 2000;
        const MAX_ELEMENTS = 50;

        // TreeWalker-based extraction: walks text nodes directly, returning
        // nodeValue (always a plain string primitive). No layout reflow, no
        // serialization risk, automatically skips script/style content.
        function walkText(root: Element, limit: number): string {
          const parts: string[] = [];
          let len = 0;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
              const tag = n.parentElement?.tagName;
              if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT')
                return NodeFilter.FILTER_REJECT;
              return (n.nodeValue ?? '').trim()
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            },
          });
          while (walker.nextNode() && len < limit) {
            const t = (walker.currentNode.nodeValue ?? '').trim();
            parts.push(t);
            len += t.length;
          }
          return parts.join(' ');
        }

        const selected = Array.from(elements).slice(0, MAX_ELEMENTS);
        return {
          count: elements.length,
          texts: selected.map((el) => {
            const tag = el.tagName.toLowerCase();
            let text: string;
            try {
              // For small inline elements, textContent is fine and faster.
              // For block-level / body elements, use TreeWalker to avoid
              // serialization failures and huge intermediate strings.
              if (
                tag === 'body' ||
                tag === 'div' ||
                tag === 'section' ||
                tag === 'main' ||
                tag === 'article'
              ) {
                text = walkText(el, MAX_TEXT);
              } else {
                text = (el.textContent || '').trim().substring(0, MAX_TEXT);
              }
            } catch {
              text = '[unreadable]';
            }
            return { tag, text: text.length >= MAX_TEXT ? text + '...' : text };
          }),
        };
      },
      args: [selector],
    });
  } catch (err) {
    // Structured-clone serialization can fail for exotic page content
    throw new Error(`DOM text extraction failed (page content may be unserializable): ${err}`);
  }

  if (result?.result?.error) throw new Error(result.result.error);

  return {
    summary: `${result?.result?.count} elements matching "${selector}"`,
    ...result?.result,
  };
});
