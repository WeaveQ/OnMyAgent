function encoded(value) {
  return JSON.stringify(value ?? null);
}

const queryFunctionSource = `
const resolveRoot = (selector) => {
  let root = document;
  if (selector && selector.frameSelector) {
    const parts = String(selector.frameSelector).split('>>').map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const frame = root.querySelector(part);
      if (!frame) return null;
      try {
        root = frame.contentDocument || frame.contentWindow?.document || null;
      } catch {
        return null;
      }
      if (!root) return null;
    }
  }
  return root;
};
const matchNodes = (root, selector) => {
  if (!root || !selector) return [];
  const all = () => Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []);
  if (selector.css) return Array.from(root.querySelectorAll(selector.css));
  if (selector.testId) return all().filter((node) => node.getAttribute('data-testid') === selector.testId);
  if (selector.placeholder) return all().filter((node) => node.getAttribute('placeholder') === selector.placeholder);
  if (selector.label) return all().filter((node) => {
    const labelledBy = node.getAttribute('aria-labelledby');
    const aria = node.getAttribute('aria-label');
    const doc = root.ownerDocument || root;
    const explicit = node.id ? doc.querySelector('label[for="' + CSS.escape(node.id) + '"]')?.textContent : '';
    const indirect = labelledBy ? doc.getElementById?.(labelledBy)?.textContent : '';
    return [aria, explicit, indirect].some((value) => String(value || '').trim() === selector.label);
  });
  if (selector.text) return all().filter((node) => node.children.length === 0 && String(node.textContent || '').trim().includes(selector.text));
  if (selector.role) return all().filter((node) => {
    const implicit = node.matches('button') ? 'button' : node.matches('a[href]') ? 'link' : node.matches('input,textarea,select') ? 'textbox' : '';
    const role = node.getAttribute('role') || implicit;
    const name = node.getAttribute('aria-label') || String(node.textContent || '').trim();
    return role === selector.role && (!selector.name || name === selector.name || name.includes(selector.name));
  });
  return [];
};
const queryInRoot = (root, selector) => {
  if (!root || !selector) return [];
  let nodes = [];
  if (selector.parent) {
    const parents = queryInRoot(root, selector.parent);
    const childSelector = Object.assign({}, selector);
    delete childSelector.parent;
    delete childSelector.frameSelector;
    delete childSelector.nth;
    nodes = parents.flatMap((parent) => matchNodes(parent, childSelector));
  } else {
    nodes = matchNodes(root, selector);
  }
  if (selector.nth !== undefined) {
    const index = Number(selector.nth);
    if (index < 0) nodes = nodes.length ? [nodes[nodes.length + index]] : [];
    else nodes = nodes[index] ? [nodes[index]] : [];
  }
  return nodes.filter(Boolean);
};
const query = (selector) => {
  const root = resolveRoot(selector);
  if (!root) return [];
  return queryInRoot(root, selector);
};`;

export function locatorObservationExpression(selector) {
  return `(() => { ${queryFunctionSource} const selector = ${encoded(selector)}; return query(selector).map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; const hit = document.elementFromPoint(center.x, center.y); return { visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none', editable: node.matches('input,textarea,select,[contenteditable="true"]') && !node.disabled && !node.readOnly, hitTarget: Boolean(hit) && (node === hit || node.contains(hit)), label: node.getAttribute('aria-label') || String(node.textContent || '').trim(), x: center.x, y: center.y }; }); })()`;
}

export function locatorActionExpression(selector, action, input) {
  return `(() => {
    ${queryFunctionSource}
    const selector = ${encoded(selector)};
    const action = ${encoded(action)};
    const value = ${encoded(input?.value ?? "")};
    const key = ${encoded(input?.key ?? "")};
    const attrName = ${encoded(input?.name ?? input?.attribute ?? "")};
    let nodes = query(selector);
    if (action === 'count') return nodes.length;
    if (action === 'isVisible' || action === 'isEnabled' || action === 'waitFor') {
      const node = nodes[0];
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      if (action === 'isVisible') return visible;
      if (action === 'isEnabled') return !node.disabled && visible;
      return visible;
    }
    if (nodes.length !== 1) throw new Error('locator changed before action');
    const node = nodes[0];
    if (action === 'textContent') return node.textContent;
    if (action === 'innerText') return node.innerText;
    if (action === 'getAttribute') {
      if (!attrName) throw new Error('getAttribute requires name');
      return node.getAttribute(attrName);
    }
    node.scrollIntoView({ block: 'center', inline: 'center' });
    if (action === 'click') node.click();
    else if (action === 'fill') {
      node.focus();
      if ('value' in node) node.value = '';
      node.value = value;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (action === 'type') {
      node.focus();
      node.value = (node.value || '') + value;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else if (action === 'hover') node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    else if (action === 'check') { node.checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (action === 'uncheck') { node.checked = false; node.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (action === 'selectOption') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.index !== undefined) node.selectedIndex = Number(value.index);
        else if (value.label !== undefined) {
          const option = Array.from(node.options || []).find((item) => item.label === value.label || item.textContent === value.label);
          if (option) node.value = option.value;
        } else if (value.value !== undefined) node.value = value.value;
      } else {
        node.value = value;
      }
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }
    else if (action === 'press') {
      node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      if (key === 'Enter' || key === 'ENTER') {
        node.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        if (typeof node.form?.requestSubmit === 'function') node.form.requestSubmit();
        else node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    } else throw new Error('unsupported locator action: ' + action);
    return true;
  })()`;
}

export function domObservationExpression() {
  return `(() => Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')).filter((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; }).slice(0, 500).map((node, index) => { if (!node.dataset.onmyagentDomRef) node.dataset.onmyagentDomRef = String(index + 1); const rect = node.getBoundingClientRect(); return { selector: '[data-onmyagent-dom-ref="' + node.dataset.onmyagentDomRef + '"]', role: node.getAttribute('role') || (node.matches('button') ? 'button' : node.matches('a[href]') ? 'link' : ''), label: node.getAttribute('aria-label') || String(node.textContent || '').trim(), value: 'value' in node ? String(node.value || '') : '', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; }))()`;
}

export function domActionExpression(node, action, input) {
  return `(() => {
    const node = document.querySelector(${encoded(node.selector)});
    if (!node) throw new Error('DOM-CUA ref is stale');
    const action = ${encoded(action)};
    if (action === 'click' || action === 'doubleClick') {
      node.click();
      if (action === 'doubleClick') node.click();
      return true;
    }
    if (action === 'type') {
      node.focus();
      node.value += ${encoded(input?.value ?? "")};
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${encoded(input?.value ?? "")} }));
      return true;
    }
    if (action === 'scroll') {
      node.scrollBy({ top: ${encoded(input?.deltaY ?? 0)}, behavior: 'instant' });
      return true;
    }
    if (action === 'keypress') {
      const key = ${encoded(input?.key ?? "")};
      node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      return true;
    }
    if (action === 'downloadMedia') {
      const url = node.currentSrc || node.src || node.href || node.getAttribute('src') || node.getAttribute('href') || '';
      if (!url) throw new Error('downloadMedia target has no media URL');
      return { url: String(url) };
    }
    throw new Error('unsupported DOM-CUA action: ' + action);
  })()`;
}

export function domSnapshotExpression() {
  return `(() => {
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const roleOf = (node) => {
      const explicit = node.getAttribute('role');
      if (explicit) return explicit;
      if (node.matches('h1,h2,h3,h4,h5,h6')) return 'heading';
      if (node.matches('button,input[type="button"],input[type="submit"]')) return 'button';
      if (node.matches('a[href]')) return 'link';
      if (node.matches('input[type="checkbox"]')) return 'checkbox';
      if (node.matches('input[type="radio"]')) return 'radio';
      if (node.matches('select')) return 'combobox';
      if (node.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="password"],input[type="url"],input[type="tel"],input[type="number"]')) return 'textbox';
      if (node.matches('img')) return 'img';
      if (node.matches('label')) return 'label';
      return node.tagName.toLowerCase();
    };
    const nameOf = (node) => {
      const labelledBy = node.getAttribute('aria-labelledby');
      const fromLabelledBy = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
        : '';
      const candidates = [
        node.getAttribute('aria-label'),
        fromLabelledBy,
        node.getAttribute('alt'),
        node.getAttribute('placeholder'),
        node.getAttribute('title'),
        node.matches('input,textarea,select') ? '' : String(node.textContent || '').replace(/\\s+/g, ' ').trim(),
        node.getAttribute('name'),
        node.getAttribute('value'),
      ];
      return candidates.map((value) => String(value || '').replace(/\\s+/g, ' ').trim()).find(Boolean) || '';
    };
    const selectorHint = (node) => {
      if (node.id) return '#' + CSS.escape(node.id);
      const testId = node.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
      const href = node.getAttribute('href');
      if (href) return node.tagName.toLowerCase() + '[href="' + href.replace(/"/g, '\\\\"') + '"]';
      return node.tagName.toLowerCase();
    };
    const interesting = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,h1,h2,h3,h4,h5,h6,img[alt],[role],[contenteditable="true"],label,[data-testid]'
    )).filter(isVisible).slice(0, 400);
    const lines = interesting.map((node, index) => {
      const role = roleOf(node);
      const name = nameOf(node);
      const href = node.getAttribute('href');
      const level = node.matches('h1,h2,h3,h4,h5,h6') ? Number(node.tagName.slice(1)) : undefined;
      const checked = node.matches('input[type="checkbox"],input[type="radio"]') ? Boolean(node.checked) : undefined;
      const parts = [
        String(index + 1),
        role + (level ? '(level=' + level + ')' : ''),
        name ? JSON.stringify(name) : '',
        href ? 'href=' + href : '',
        checked === undefined ? '' : (checked ? 'checked' : 'unchecked'),
        'css=' + selectorHint(node),
      ].filter(Boolean);
      return parts.join(' ');
    });
    return {
      url: location.href,
      title: document.title,
      snapshot: lines.join('\\n'),
      count: lines.length,
    };
  })()`;
}

export function elementInfoExpression(selector) {
  return `(() => {
    ${queryFunctionSource}
    const selector = ${encoded(selector)};
    const nodes = query(selector);
    if (nodes.length !== 1) {
      return { matchCount: nodes.length, elements: [] };
    }
    const node = nodes[0];
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const attrs = {};
    for (const attr of Array.from(node.attributes || []).slice(0, 40)) {
      attrs[attr.name] = attr.value;
    }
    return {
      matchCount: 1,
      element: {
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || '',
        id: node.id || '',
        name: node.getAttribute('name') || '',
        label: node.getAttribute('aria-label') || String(node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
        text: String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
        value: 'value' in node ? String(node.value || '') : '',
        href: node.getAttribute('href') || '',
        src: node.currentSrc || node.getAttribute('src') || '',
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        enabled: !node.disabled,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        attributes: attrs,
      },
    };
  })()`;
}

export function elementBoundsExpression(selector) {
  return `(() => {
    ${queryFunctionSource}
    const selector = ${encoded(selector)};
    const nodes = query(selector);
    if (nodes.length !== 1) throw new Error('elementScreenshot expected exactly 1 match, got ' + nodes.length);
    const node = nodes[0];
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      dpr,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  })()`;
}

export function playwrightEvaluateExpression(pageFunction, arg, selector = null) {
  if (selector && typeof selector === "object") {
    return `(() => {
      ${queryFunctionSource}
      const nodes = query(${encoded(selector)});
      if (nodes.length !== 1) throw new Error('locator.evaluate expected exactly 1 element, got ' + nodes.length);
      const __pageFn = (${pageFunction});
      const __arg = ${encoded(arg)};
      return __pageFn(nodes[0], __arg);
    })()`;
  }
  return `(() => {
    const __pageFn = (${pageFunction});
    const __arg = ${encoded(arg)};
    return __pageFn(__arg);
  })()`;
}

export function exportContentExpression(type) {
  return `(() => {
    const type = ${encoded(type)};
    if (type === 'html') {
      return { type: 'html', html: document.documentElement.outerHTML, text: document.body?.innerText || '' };
    }
    if (type === 'markdown' || type === 'md') {
      const text = document.body?.innerText || '';
      return { type: 'markdown', text, title: document.title, url: location.href };
    }
    return {
      type: 'text',
      text: document.body?.innerText || document.documentElement.innerText || '',
      title: document.title,
      url: location.href,
    };
  })()`;
}

export function mediaUrlExpression(input) {
  return `(() => {
    ${queryFunctionSource}
    const input = ${encoded(input ?? {})};
    if (input.url) return { url: String(input.url) };
    if (input.selector) {
      const nodes = query(input.selector);
      if (nodes.length !== 1) throw new Error('downloadMedia selector matched ' + nodes.length + ' elements');
      const node = nodes[0];
      const url = node.currentSrc || node.src || node.href || node.getAttribute('src') || node.getAttribute('href') || '';
      if (!url) throw new Error('downloadMedia target has no media URL');
      return { url: String(url) };
    }
    if (input.x !== undefined && input.y !== undefined) {
      const node = document.elementFromPoint(Number(input.x), Number(input.y));
      if (!node) throw new Error('downloadMedia found no element at point');
      const media = node.closest?.('img,video,audio,a,source') || node;
      const url = media.currentSrc || media.src || media.href || media.getAttribute?.('src') || media.getAttribute?.('href') || '';
      if (!url) throw new Error('downloadMedia target has no media URL');
      return { url: String(url) };
    }
    throw new Error('downloadMedia requires url, selector, or coordinates');
  })()`;
}
