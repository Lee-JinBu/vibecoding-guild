/// <reference types="vite/client" />
import "./style.css";

type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "break" }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };
type BlockNode =
  | { type: "heading" | "paragraph"; level?: number; children: InlineNode[] }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "list"; ordered: boolean; items: BlockNode[][] }
  | { type: "codeBlock"; value: string; language: string }
  | { type: "divider" };
type Message = { id: string; author: string; github: string; url: string; body: BlockNode[] };
type ElementTag = keyof HTMLElementTagNameMap;

const USERNAME = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;

function el<K extends ElementTag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const glyphs = { arrow: "↗", github: "GH", search: "⌕", spark: "✦", sword: "╱", book: "▤", check: "✓" } as const;
function icon(name: keyof typeof glyphs, className = "icon") { return el("span", className, glyphs[name]); }
function safeHref(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
}
function renderInline(nodes: InlineNode[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const item of nodes) {
    if (item.type === "text") fragment.append(document.createTextNode(item.value));
    else if (item.type === "break") fragment.append(document.createElement("br"));
    else if (item.type === "code") { const code = el("code", "inline-code"); code.textContent = item.value; fragment.append(code); }
    else if (item.type === "link") {
      const href = safeHref(item.href);
      if (!href) { fragment.append(renderInline(item.children)); continue; }
      const link = el("a", "message-link"); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.append(renderInline(item.children)); fragment.append(link);
    } else {
      const wrapper = document.createElement(item.type === "strong" ? "strong" : item.type === "em" ? "em" : "del");
      wrapper.append(renderInline(item.children)); fragment.append(wrapper);
    }
  }
  return fragment;
}
function renderBlocks(blocks: BlockNode[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of blocks) {
    if (block.type === "heading") {
      const level = Math.max(2, Math.min(6, block.level ?? 3));
      const heading = document.createElement(`h${level}`); heading.append(renderInline(block.children)); fragment.append(heading);
    } else if (block.type === "paragraph") {
      const p = el("p"); p.append(renderInline(block.children)); fragment.append(p);
    } else if (block.type === "blockquote") {
      const quote = el("blockquote", "message-quote"); quote.append(renderBlocks(block.children)); fragment.append(quote);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) { const li = el("li"); li.append(renderBlocks(item)); list.append(li); }
      fragment.append(list);
    } else if (block.type === "codeBlock") {
      const pre = el("pre", "code-block"); const code = el("code"); code.textContent = block.value; pre.append(code); fragment.append(pre);
    } else if (block.type === "divider") fragment.append(el("hr", "message-divider"));
  }
  return fragment;
}
function validInline(value: unknown): value is InlineNode[] {
  if (!Array.isArray(value)) return false;
  return value.every((node) => {
    if (!node || typeof node !== "object") return false;
    const item = node as Record<string, unknown>;
    if (item.type === "text" || item.type === "code") return typeof item.value === "string";
    if (item.type === "break") return true;
    if (["strong", "em", "del"].includes(String(item.type))) return validInline(item.children);
    if (item.type === "link") return typeof item.href === "string" && safeHref(item.href) !== null && validInline(item.children);
    return false;
  });
}
function validBlocks(value: unknown): value is BlockNode[] {
  if (!Array.isArray(value)) return false;
  return value.every((node) => {
    if (!node || typeof node !== "object") return false;
    const item = node as Record<string, unknown>;
    if (item.type === "heading" || item.type === "paragraph") return validInline(item.children);
    if (item.type === "blockquote") return validBlocks(item.children);
    if (item.type === "list") return typeof item.ordered === "boolean" && Array.isArray(item.items) && item.items.every(validBlocks);
    if (item.type === "codeBlock") return typeof item.value === "string";
    return item.type === "divider";
  });
}
function validMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Message>;
  return typeof item.id === "string" && typeof item.author === "string" && item.author.length > 0
    && typeof item.github === "string" && USERNAME.test(item.github) && typeof item.url === "string"
    && item.url === `https://github.com/${item.github}` && validBlocks(item.body);
}
function makeMessageCard(message: Message): HTMLElement {
  const article = el("article", "message-card");
  const top = el("div", "message-card__top");
  const avatar = el("span", "avatar", message.author.trim().slice(0, 1).toLocaleUpperCase()); avatar.setAttribute("aria-hidden", "true");
  const author = el("div", "message-card__identity");
  author.append(el("h3", "message-card__author", message.author));
  const profileUrl = safeHref(message.url);
  if (profileUrl) {
    const github = el("a", "message-card__handle", `@${message.github}`); github.href = profileUrl;
    github.target = "_blank"; github.rel = "noopener noreferrer"; github.append(icon("arrow", "tiny-arrow")); author.append(github);
  }
  const achievement = el("span", "achievement"); achievement.append(icon("spark", "achievement__icon"), document.createTextNode("首次贡献"));
  top.append(avatar, author, achievement);
  const body = el("div", "message-card__body"); body.append(renderBlocks(message.body));
  const footer = el("div", "message-card__footer"); footer.append(el("span", "message-card__id", `# ${message.id}`), el("span", "merged-state", "已合并 · 公会成员"));
  article.append(top, body, footer); return article;
}
function contributionStep(number: string, title: string, description: string, command?: string): HTMLElement {
  const step = el("li", "flow-step");
  const numberNode = el("span", "flow-step__number", number); numberNode.setAttribute("aria-hidden", "true");
  const content = el("div", "flow-step__content"); content.append(el("h3", "flow-step__title", title), el("p", "flow-step__description", description));
  if (command) { const code = el("code", "flow-step__command", command); content.append(code); }
  step.append(numberNode, content); return step;
}
function createApp(): HTMLElement {
  const shell = el("div", "site-shell");
  const grid = el("div", "site-grid");
  const rail = el("aside", "side-rail"); rail.setAttribute("aria-label", "公会导航");
  const brandMark = el("a", "brand-mark", "G"); brandMark.href = "#top"; brandMark.setAttribute("aria-label", "返回公会大厅");
  const railLine = el("span", "rail-line", "01 / 03");
  rail.append(brandMark, railLine);
  const main = el("main", "main-content"); main.id = "top";

  const topbar = el("header", "topbar");
  const breadcrumb = el("div", "breadcrumb"); breadcrumb.append(el("span", "breadcrumb__dot"), el("span", undefined, "冒险者公会"), el("span", "breadcrumb__slash", "/"), el("span", "breadcrumb__current", "新手大厅"));
  const status = el("div", "online-status"); status.append(el("span", "online-status__dot"), el("span", undefined, "公会开放中"));
  topbar.append(breadcrumb, status);

  const hero = el("section", "hero"); hero.setAttribute("aria-labelledby", "hero-title");
  const heroText = el("div", "hero__copy");
  const eyebrow = el("div", "eyebrow"); eyebrow.append(icon("spark", "eyebrow__icon"), document.createTextNode("COMPUTER SCIENCE · GUILD BOARD"));
  const title = el("h1", "hero__title"); title.id = "hero-title"; title.append(document.createTextNode("Git 冒险者公会"), el("span", "hero__title-sub", "留言墙"));
  heroText.append(eyebrow, title, el("p", "hero__intro", "每一次提交，都是一次冒险。把你的第一条留言，留在新生公会的任务公告板上。"));
  const heroActions = el("div", "hero__actions");
  const primary = el("a", "button button--gold", "查看留言墙"); primary.href = "#wall"; primary.append(icon("arrow", "button__icon"));
  const secondary = el("a", "text-link", "如何加入公会"); secondary.href = "#guild-guide"; secondary.append(icon("arrow", "text-link__icon"));
  heroActions.append(primary, secondary); heroText.append(heroActions);
  const heroArt = el("div", "hero__art"); heroArt.setAttribute("aria-hidden", "true");
  const artFrame = el("div", "pixel-art-frame");
  const pixelSun = el("div", "pixel-sun");
  const pixelMountain = el("div", "pixel-mountain pixel-mountain--back");
  const pixelMountainFront = el("div", "pixel-mountain pixel-mountain--front");
  const artFlag = el("div", "pixel-flag");
  const artCaption = el("div", "pixel-art-caption"); artCaption.append(el("span", "caption-square"), document.createTextNode("QUEST BOARD · EST. 2026"));
  artFrame.append(pixelSun, pixelMountain, pixelMountainFront, artFlag, artCaption); heroArt.append(artFrame);
  hero.append(heroText, heroArt);

  const stats = el("section", "guild-stats"); stats.setAttribute("aria-label", "公会数据");
  const statA = el("div", "stat"); statA.append(el("span", "stat__label", "QUEST TYPE"), el("strong", "stat__value", "协作任务"));
  const statB = el("div", "stat"); statB.append(el("span", "stat__label", "YOUR FIRST STEP"), el("strong", "stat__value", "提交一条留言"));
  const statC = el("div", "stat stat--right"); statC.append(el("span", "stat__label", "BUILT WITH"), el("strong", "stat__value", "Git · Markdown · 你"));
  stats.append(statA, statB, statC);

  const wall = el("section", "wall-section"); wall.id = "wall"; wall.setAttribute("aria-labelledby", "wall-title");
  const sectionHead = el("div", "section-heading");
  const sectionLabel = el("div", "section-label"); sectionLabel.append(icon("sword", "section-label__icon"), document.createTextNode("GUILD MESSAGE BOARD"));
  const wallTitle = el("h2", "section-title", "冒险者留言"); wallTitle.id = "wall-title";
  const wallDescription = el("p", "section-description", "已完成的新手任务都会在这里留下记录。搜索昵称，认识同伴。" );
  sectionHead.append(sectionLabel, wallTitle, wallDescription);
  const wallTools = el("div", "wall-tools");
  const searchWrap = el("label", "search-box");
  const searchIcon = icon("search", "search-box__icon");
  const search = el("input", "search-box__input"); search.type = "search"; search.placeholder = "搜索昵称或 GitHub 用户名"; search.autocomplete = "off"; search.setAttribute("aria-label", "搜索昵称或 GitHub 用户名");
  searchWrap.append(searchIcon, search);
  const filters = el("div", "filter-tabs"); filters.setAttribute("role", "group"); filters.setAttribute("aria-label", "留言筛选");
  const allButton = el("button", "filter-tab is-active", "全部留言"); allButton.type = "button"; allButton.dataset.filter = "all"; allButton.setAttribute("aria-pressed", "true");
  const firstButton = el("button", "filter-tab", "首次贡献"); firstButton.type = "button"; firstButton.dataset.filter = "first"; firstButton.setAttribute("aria-pressed", "false");
  filters.append(allButton, firstButton); wallTools.append(searchWrap, filters);
  const resultsMeta = el("div", "results-meta");
  const resultCount = el("span", "results-count", "正在读取公会留言…"); resultCount.setAttribute("aria-live", "polite");
  const boardTag = el("span", "board-tag", "PUBLIC QUEST LOG"); resultsMeta.append(resultCount, boardTag);
  const messageGrid = el("div", "message-grid"); messageGrid.setAttribute("aria-live", "polite"); messageGrid.setAttribute("aria-busy", "true");
  const loading = el("div", "state-panel state-panel--loading"); loading.append(el("span", "loading-mark"), el("p", undefined, "正在整理公会任务记录…")); messageGrid.append(loading);
  wall.append(sectionHead, wallTools, resultsMeta, messageGrid);

  const guide = el("section", "guide-section"); guide.id = "guild-guide"; guide.setAttribute("aria-labelledby", "guide-title");
  const guideIntro = el("div", "guide-intro");
  const guideLabel = el("div", "section-label"); guideLabel.append(icon("book", "section-label__icon"), document.createTextNode("YOUR FIRST QUEST"));
  const guideTitle = el("h2", "section-title", "加入公会，只需几步"); guideTitle.id = "guide-title";
  guideIntro.append(guideLabel, guideTitle, el("p", "section-description", "从复制仓库到发起 Pull Request，完成你的第一次开源协作。"));
  const flow = el("ol", "flow-list");
  flow.append(
    contributionStep("01", "Fork 仓库", "在 GitHub 上复制一份公会仓库到自己的账号。"),
    contributionStep("02", "Clone 到本地", "把你的仓库下载到电脑，开始准备留言。", "git clone <你的仓库地址>"),
    contributionStep("03", "Commit 并 Push", "添加 Markdown 留言文件，再提交并推送改动。", "git add .  ·  git commit  ·  git push"),
    contributionStep("04", "发起 Pull Request", "向公会提交申请，等待审核合并，解锁首次贡献成就。"),
  );
  guide.append(guideIntro, flow);

  const footer = el("footer", "site-footer");
  const footerBrand = el("span", "footer-brand", "GUILD / 001");
  const footerNote = el("span", "footer-note", "用协作写下你的第一段 Git 故事。没有表单，只有一次真实的开源贡献。" );
  const footerTop = el("a", "footer-top", "回到顶部 ↑"); footerTop.href = "#top";
  footer.append(footerBrand, footerNote, footerTop);

  main.append(topbar, hero, stats, wall, guide, footer); grid.append(rail, main); shell.append(grid);
  return shell;
}

const mount = document.querySelector<HTMLDivElement>("#app");
if (mount) {
  const app = createApp(); mount.replaceChildren(app);
  const messageGrid = app.querySelector<HTMLDivElement>(".message-grid")!;
  const resultCount = app.querySelector<HTMLSpanElement>(".results-count")!;
  const search = app.querySelector<HTMLInputElement>(".search-box__input")!;
  const tabs = [...app.querySelectorAll<HTMLButtonElement>(".filter-tab")];
  let messages: Message[] = [];
  let activeFilter: "all" | "first" = "all";

  function showState(title: string, description: string, kind: "empty" | "error" | "no-results") {
    messageGrid.replaceChildren(); messageGrid.setAttribute("aria-busy", "false");
    const panel = el("div", `state-panel state-panel--${kind}`);
    panel.append(el("span", "state-panel__icon", kind === "error" ? "!" : kind === "no-results" ? "⌕" : "＋"));
    panel.append(el("h3", undefined, title), el("p", undefined, description));
    if (kind === "error") {
      const retry = el("button", "button button--outline", "重新读取"); retry.type = "button"; retry.addEventListener("click", loadMessages); panel.append(retry);
    }
    messageGrid.append(panel);
  }
  function renderMessages() {
    const term = search.value.trim().toLocaleLowerCase();
    const filtered = messages.filter((message) => {
      const matchesTerm = `${message.author} ${message.github}`.toLocaleLowerCase().includes(term);
      const matchesFilter = activeFilter === "all" || Boolean(message.github);
      return matchesTerm && matchesFilter;
    });
    resultCount.textContent = `${filtered.length} 位冒险者`;
    messageGrid.setAttribute("aria-busy", "false"); messageGrid.replaceChildren();
    if (messages.length === 0) { showState("公告板正在等待第一位冒险者", "提交并合并你的第一条留言，让公会任务记录从这里开始。", "empty"); return; }
    if (filtered.length === 0) { showState("没有找到这位冒险者", "试试其他昵称或 GitHub 用户名。", "no-results"); return; }
    for (const message of filtered) messageGrid.append(makeMessageCard(message));
  }
  async function loadMessages() {
    messageGrid.setAttribute("aria-busy", "true");
    const panel = el("div", "state-panel state-panel--loading"); panel.append(el("span", "loading-mark"), el("p", undefined, "正在整理公会任务记录…")); messageGrid.replaceChildren(panel);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}messages.json`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`留言数据读取失败（${response.status}）`);
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.every(validMessage)) throw new Error("留言数据格式异常，请稍后重试。");
      messages = data; renderMessages();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "网络暂时不可用。";
      resultCount.textContent = "暂时无法读取留言"; showState("公会记录暂时没有加载", `${detail} 请检查网络后重试。`, "error");
    }
  }
  search.addEventListener("input", renderMessages);
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    activeFilter = tab.dataset.filter === "first" ? "first" : "all";
    tabs.forEach((item) => { const selected = item === tab; item.classList.toggle("is-active", selected); item.setAttribute("aria-pressed", String(selected)); });
    renderMessages();
  }));
  void loadMessages();
}
