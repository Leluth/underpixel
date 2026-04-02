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

  // Register listener BEFORE tabs.update, wrapped in try/catch
  const navigationDone = new Promise<void>((resolve) => {
    const finalTabId = tabId!;
    let timeoutId: ReturnType<typeof setTimeout>;
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === finalTabId && changeInfo.status === 'complete') {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30_000);
  });

  try {
    await chrome.tabs.update(tabId!, { url });
  } catch (err) {
    throw new Error(`Failed to navigate tab ${tabId}: ${err instanceof Error ? err.message : err}`);
  }

  await navigationDone;

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

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, {
    format: 'png',
  });

  return {
    summary: 'Screenshot captured',
    dataUrl,
    tabId,
    timestamp: Date.now(),
  };
});

// ---- dom_text ----

toolRegistry.register(TOOL_NAMES.DOM_TEXT, async (args) => {
  const selector = args.selector as string;
  let tabId = resolveTabId(args.tabId);
  if (!tabId) tabId = await getActiveTabId();

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const elements = document.querySelectorAll(sel);
      if (elements.length === 0) return { error: `No elements found: ${sel}` };
      return {
        count: elements.length,
        texts: Array.from(elements).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().substring(0, 2000) || '',
        })),
      };
    },
    args: [selector],
  });

  if (result?.result?.error) throw new Error(result.result.error);

  return {
    summary: `${result?.result?.count} elements matching "${selector}"`,
    ...result?.result,
  };
});
