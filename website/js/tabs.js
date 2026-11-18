// タブの並び（role="tablist"）のキーボード操作。←→・Home・End でタブのあいだを移る（layout.js の画面のタブ、plan.js の今いる場所）
// ブラウザが focusgroup を持っていればそれに任せ（index.html の focusgroup="tablist nomemory"）、
// 持っていなければ同じ動きを数行で作る（ポリフィルは読み込まない。読み込みを軽くするため）
const native = Object.hasOwn(HTMLElement.prototype, "focusGroup");

const tabsOf = ($list) => [...$list.querySelectorAll('[role="tab"]')];

// 選んだタブに印を付ける。並びに入ったときは、選んだタブにフォーカスが来るようにする
export function selectTab($list, $selected) {
  for (const $t of tabsOf($list)) {
    $t.setAttribute("aria-selected", String($t === $selected));
    $t.toggleAttribute("focusgroupstart", $t === $selected);
    if (!native) $t.tabIndex = $t === $selected ? 0 : -1;
  }
}

// onFocus：フォーカスが移っただけで選ぶとき（選ぶと保存などが起きるタブは渡さず、Enter・スペースで選ぶ）
export function initTablist($list, onFocus) {
  if (onFocus) $list.addEventListener("focusin", (ev) => ev.target.matches('[role="tab"]') && onFocus(ev.target));
  if (native) return;
  $list.addEventListener("keydown", (ev) => {
    const $tabs = tabsOf($list);
    const i = $tabs.indexOf(ev.target);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: $tabs.length - 1 }[ev.key];
    if (to === undefined) return;
    ev.preventDefault();
    $tabs.at(to % $tabs.length).focus();
  });
}
