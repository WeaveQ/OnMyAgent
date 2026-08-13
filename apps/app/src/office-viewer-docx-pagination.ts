const DOCX_PAGINATION_TOLERANCE = 2;

function docxArticle(page: HTMLElement) {
  return page.querySelector<HTMLElement>(":scope > article");
}

function docxTableRows(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tr, :scope > tbody > tr"));
}

function docxTableContentRows(table: HTMLTableElement) {
  const rows = docxTableRows(table);
  const headerRows = rows.filter(
    (row) => row.dataset.docxRepeatHeader === "true" || row.dataset.docxRepeatedHeader === "true",
  );
  const detectedHeaders = headerRows.length > 0
    ? headerRows
    : rows.filter((row, index) => index === 0 && row.querySelector("th"));
  return rows.filter((row) => !detectedHeaders.includes(row));
}

function docxTableHeaderRows(table: HTMLTableElement) {
  const rows = docxTableRows(table);
  const explicitHeaders = rows.filter(
    (row) => row.dataset.docxRepeatHeader === "true" || row.dataset.docxRepeatedHeader === "true",
  );
  return explicitHeaders.length > 0
    ? explicitHeaders
    : rows.filter((row, index) => index === 0 && row.querySelector("th"));
}

function isDocxPageOverflowing(page: HTMLElement) {
  if (page.clientHeight <= 0) return false;
  if (page.scrollHeight > page.clientHeight + DOCX_PAGINATION_TOLERANCE) return true;

  const pageRect = page.getBoundingClientRect();
  const article = docxArticle(page);
  if (!article) return false;
  const contentBottom = Array.from(article.children).reduce(
    (bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom),
    pageRect.top,
  );
  return contentBottom > pageRect.bottom + DOCX_PAGINATION_TOLERANCE;
}

function appendTableContinuation(
  currentPage: HTMLElement,
  currentArticle: HTMLElement,
  sourceTable: HTMLTableElement,
) {
  const continuation = sourceTable.cloneNode(false) as HTMLTableElement;
  continuation.removeAttribute("id");
  continuation.dataset.docxContinued = "true";
  sourceTable.querySelectorAll<HTMLElement>(":scope > colgroup").forEach((columns) => {
    continuation.append(columns.cloneNode(true));
  });
  docxTableHeaderRows(sourceTable).forEach((row) => {
    const repeatedHeader = row.cloneNode(true) as HTMLTableRowElement;
    repeatedHeader.dataset.docxRepeatedHeader = "true";
    continuation.append(repeatedHeader);
  });
  currentArticle.append(continuation);

  let movedRows = 0;
  for (const row of docxTableContentRows(sourceTable)) {
    const sourceParent = row.parentNode;
    const sourceNextSibling = row.nextSibling;
    continuation.append(row);
    if (isDocxPageOverflowing(currentPage)) {
      sourceParent?.insertBefore(row, sourceNextSibling);
      break;
    }
    movedRows += 1;
  }

  if (movedRows === 0) continuation.remove();
  if (docxTableContentRows(sourceTable).length === 0) sourceTable.remove();
  return movedRows > 0;
}

function moveLeadingBlockToPreviousPage(
  currentPage: HTMLElement,
  currentArticle: HTMLElement,
  nextArticle: HTMLElement,
) {
  const block = nextArticle.firstElementChild;
  if (!(block instanceof HTMLElement)) return false;
  if (block instanceof HTMLTableElement) {
    return appendTableContinuation(currentPage, currentArticle, block);
  }

  const sourceNextSibling = block.nextSibling;
  currentArticle.append(block);
  if (!isDocxPageOverflowing(currentPage)) return true;
  nextArticle.insertBefore(block, sourceNextSibling);
  return false;
}

function removeEmptyDynamicPage(page: HTMLElement) {
  const article = docxArticle(page);
  if (!article || article.children.length > 0 || page.dataset.docxDynamicPage !== "true") return false;
  const frame = page.parentElement;
  if (frame?.classList.contains("docx-page-frame")) frame.remove();
  else page.remove();
  return true;
}

/**
 * The DOCX renderer paginates from the end of an overflowing page. When a
 * multi-row table is not the page's only block, that first pass may move the
 * whole table instead of splitting it. Compact only renderer-created dynamic
 * continuation pages so explicit Word page breaks remain untouched.
 */
export function compactDocxDynamicPages(root: ParentNode) {
  let changed = false;
  let pass = 0;

  while (pass < 200) {
    pass += 1;
    const pages = Array.from(root.querySelectorAll<HTMLElement>("section.docx"));
    let passChanged = false;

    for (let index = 0; index < pages.length - 1; index += 1) {
      const currentPage = pages[index];
      const nextPage = pages[index + 1];
      if (!currentPage || !nextPage || nextPage.dataset.docxDynamicPage !== "true") continue;
      const currentArticle = docxArticle(currentPage);
      const nextArticle = docxArticle(nextPage);
      if (!currentArticle || !nextArticle || isDocxPageOverflowing(currentPage)) continue;

      while (nextArticle.children.length > 0) {
        if (!moveLeadingBlockToPreviousPage(currentPage, currentArticle, nextArticle)) break;
        passChanged = true;
      }
      if (removeEmptyDynamicPage(nextPage)) passChanged = true;
    }

    changed ||= passChanged;
    if (!passChanged) break;
  }

  return changed;
}
