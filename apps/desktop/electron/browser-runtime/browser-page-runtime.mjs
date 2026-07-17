function encoded(value) {
  return JSON.stringify(value ?? null);
}

const queryFunctionSource = `
const query = (selector) => {
  let nodes = [];
  const all = () => Array.from(document.querySelectorAll('*'));
  if (selector.css) nodes = Array.from(document.querySelectorAll(selector.css));
  else if (selector.testId) nodes = all().filter((node) => node.getAttribute('data-testid') === selector.testId);
  else if (selector.placeholder) nodes = all().filter((node) => node.getAttribute('placeholder') === selector.placeholder);
  else if (selector.label) nodes = all().filter((node) => {
    const labelledBy = node.getAttribute('aria-labelledby');
    const aria = node.getAttribute('aria-label');
    const explicit = node.id ? document.querySelector('label[for="' + CSS.escape(node.id) + '"]')?.textContent : '';
    const indirect = labelledBy ? document.getElementById(labelledBy)?.textContent : '';
    return [aria, explicit, indirect].some((value) => String(value || '').trim() === selector.label);
  });
  else if (selector.text) nodes = all().filter((node) => node.children.length === 0 && String(node.textContent || '').trim().includes(selector.text));
  else if (selector.role) nodes = all().filter((node) => {
    const implicit = node.matches('button') ? 'button' : node.matches('a[href]') ? 'link' : '';
    const role = node.getAttribute('role') || implicit;
    const name = node.getAttribute('aria-label') || String(node.textContent || '').trim();
    return role === selector.role && (!selector.name || name === selector.name);
  });
  if (selector.nth !== undefined) nodes = nodes[selector.nth] ? [nodes[selector.nth]] : [];
  return nodes;
};`;

export function locatorObservationExpression(selector) {
  return `(() => { ${queryFunctionSource} const selector = ${encoded(selector)}; return query(selector).map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; return { visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none', editable: node.matches('input,textarea,select,[contenteditable="true"]') && !node.disabled && !node.readOnly, hitTarget: node.contains(document.elementFromPoint(center.x, center.y)), label: node.getAttribute('aria-label') || String(node.textContent || '').trim(), x: center.x, y: center.y }; }); })()`;
}

export function locatorActionExpression(selector, action, input) {
  return `(() => { ${queryFunctionSource} const nodes = query(${encoded(selector)}); if (nodes.length !== 1) throw new Error('locator changed before action'); const node = nodes[0]; const action = ${encoded(action)}; const value = ${encoded(input?.value ?? "")}; node.scrollIntoView({ block: 'center', inline: 'center' }); if (action === 'click') node.click(); else if (action === 'fill') { node.focus(); node.value = value; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); node.dispatchEvent(new Event('change', { bubbles: true })); } else if (action === 'type') { node.focus(); node.value += value; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); } else if (action === 'hover') node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); else if (action === 'check') { node.checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); } else if (action === 'uncheck') { node.checked = false; node.dispatchEvent(new Event('change', { bubbles: true })); } else if (action === 'selectOption') { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); } else if (action === 'press') node.dispatchEvent(new KeyboardEvent('keydown', { key: ${encoded(input?.key ?? "")}, bubbles: true })); return true; })()`;
}

export function domObservationExpression() {
  return `(() => Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')).filter((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; }).slice(0, 500).map((node, index) => { if (!node.dataset.onmyagentDomRef) node.dataset.onmyagentDomRef = String(index + 1); const rect = node.getBoundingClientRect(); return { selector: '[data-onmyagent-dom-ref="' + node.dataset.onmyagentDomRef + '"]', role: node.getAttribute('role') || (node.matches('button') ? 'button' : node.matches('a[href]') ? 'link' : ''), label: node.getAttribute('aria-label') || String(node.textContent || '').trim(), value: 'value' in node ? String(node.value || '') : '', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; }))()`;
}

export function domActionExpression(node, action, input) {
  return `(() => { const node = document.querySelector(${encoded(node.selector)}); if (!node) throw new Error('DOM-CUA ref is stale'); const action = ${encoded(action)}; if (action === 'click') node.click(); else if (action === 'type') { node.focus(); node.value += ${encoded(input?.value ?? "")}; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${encoded(input?.value ?? "")} })); } else if (action === 'scroll') node.scrollBy({ top: ${encoded(input?.deltaY ?? 0)}, behavior: 'instant' }); return true; })()`;
}
