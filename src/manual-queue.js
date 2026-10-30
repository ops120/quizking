// 需人工处理队列：按题号去重、可增删、可排序输出。
// 为什么单独成文件：这段语义（同题覆盖理由、已处理要移除、清空要能收起气泡）
// 曾经因为写在 autoAnswerInner 的闭包里而完全没有测试保护，出过"用户后续点选的
// 题永远进不了清单"的真 bug。抽成纯函数后可在 jsdom/Node 里直接断言。
// 约定：零 DOM、零 chrome API，只做数据。
(function () {
  'use strict';

  function createQueue() {
    let items = [];   // [{ index:Number, reason:String }]

    function findPos(index) {
      for (let i = 0; i < items.length; i++) if (items[i].index === index) return i;
      return -1;
    }

    return {
      // 加入/更新：同一题重复加入只保留一条，理由用最新的
      // 返回 true = 这是一条新增（清单条数变了）；false = 只是更新了理由
      add: function (index, reason) {
        const n = Number(index);
        if (!Number.isFinite(n)) return false;
        const pos = findPos(n);
        if (pos >= 0) { items[pos].reason = String(reason == null ? '' : reason); return false; }
        items.push({ index: n, reason: String(reason == null ? '' : reason) });
        return true;
      },

      // 移出队列（比如用户点了「采用 LLM 答案」且点击成功）
      // 返回 true = 确实移除了一条
      remove: function (index) {
        const pos = findPos(Number(index));
        if (pos < 0) return false;
        items.splice(pos, 1);
        return true;
      },

      has: function (index) { return findPos(Number(index)) >= 0; },

      // 给渲染用：题号升序（用户按顺序处理更顺手），返回副本，外部改不动内部
      list: function () {
        return items
          .slice()
          .sort(function (a, b) { return a.index - b.index; })
          .map(function (x) { return { index: x.index, reason: x.reason }; });
      },

      get size() { return items.length; },

      isEmpty: function () { return items.length === 0; },

      clear: function () { items = []; },

      // 给渲染方用的题号数组（"需手动处理（N 题）"里的按钮顺序）
      indices: function () { return this.list().map(function (x) { return x.index; }); }
    };
  }

  const api = { createQueue: createQueue };
  if (typeof window !== 'undefined') window.ManualQueue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
