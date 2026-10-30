/* =========================================================
   生日站 · 许愿区的合成小游戏
   ---------------------------------------------------------
   流程：合成台摆出蛋糕配方 → 点成品格合出蛋糕
         → 合成台退场，生日蛋糕出现 → 吹蜡烛许愿
   ========================================================= */

(function () {
  "use strict";

  var gridEl = document.getElementById("craftGrid");
  if (!gridEl) return; // 这一页没有合成台

  /* ---------- 素材（相对站点根目录） ---------- */
  var SRC = {
    wheat: "Wheat_JE2_BE2.png",
    sugar: "Sugar_JE2_BE2.png",
    egg: "Egg_JE2_BE2.png",
    milk: "Milk_Bucket_JE2_BE2.png",
    cake: "Cake_JE2_BE2.png"
  };

  var NAME = {
    wheat: "小麦",
    sugar: "糖",
    egg: "鸡蛋",
    milk: "牛奶桶",
    cake: "蛋糕"
  };

  /* 原版配方：上排牛奶 / 中排糖·蛋·糖 / 下排小麦 */
  var RECIPE = [
    "milk", "milk", "milk",
    "sugar", "egg", "sugar",
    "wheat", "wheat", "wheat"
  ];

  var BAG_ORDER = ["milk", "sugar", "egg", "wheat"];
  var START_BAG = { milk: 3, sugar: 2, egg: 1, wheat: 3 };

  /* ---------- DOM ---------- */
  var invEl = document.getElementById("craftInv");
  var outEl = document.getElementById("craftOutput");
  var arrowEl = document.getElementById("craftArrow");
  var stageEl = document.getElementById("craftStage");
  var wishEl = document.getElementById("wishStage");
  var subEl = document.getElementById("cakeSub");
  var heldEl = document.getElementById("craftHeld");
  var toastEl = document.getElementById("craftToast");
  var hintBtn = document.getElementById("craftHint");
  var clearBtn = document.getElementById("craftClear");
  var againBtn = document.getElementById("againCraftBtn");

  /* ---------- 状态 ---------- */
  var grid = [null, null, null, null, null, null, null, null, null];
  var bag = { milk: 3, sugar: 2, egg: 1, wheat: 3 };
  var held = null;
  var gridEls = [];
  var invEls = {};
  var done = false;
  var wasReady = false;
  var hintOn = false;
  var lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var toastId = 0;

  /* =========================================================
     音效（Web Audio 现场合成）
     ========================================================= */
  var sfx = (function () {
    var ctx = null;

    function ac() {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        if (!ctx) ctx = new AC();
      } catch (e) { return null; }
      if (ctx.state === "suspended" && ctx.resume) {
        try { ctx.resume(); } catch (e) { }
      }
      return ctx;
    }

    function beep(freq, dur, type, vol, delay) {
      var c = ac();
      if (!c) return;
      var t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.04, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function slide(f1, f2, dur, vol) {
      var c = ac();
      if (!c) return;
      var t0 = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f1, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.035, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    return {
      unlock: function () { ac(); },
      click: function () { beep(700, 0.05, "square", 0.03); },
      place: function () { beep(175, 0.09, "triangle", 0.075); beep(520, 0.045, "square", 0.022); },
      pick: function () { beep(880, 0.05, "square", 0.028); },
      error: function () { slide(250, 120, 0.18, 0.038); },
      ready: function () { beep(660, 0.1, "sine", 0.045); beep(990, 0.14, "sine", 0.04, 0.1); },
      win: function () {
        var notes = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < notes.length; i++) {
          beep(notes[i], 0.3, "triangle", 0.06, i * 0.11);
        }
      }
    };
  })();

  /* =========================================================
     提示条
     ========================================================= */
  function toast(text, ms) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("on");
    clearTimeout(toastId);
    toastId = setTimeout(function () {
      toastEl.classList.remove("on");
    }, ms || 1800);
  }

  /* =========================================================
     建格子
     ========================================================= */
  function makeSlot() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "craft-slot";

    var img = document.createElement("img");
    img.alt = "";
    img.hidden = true;

    var cnt = document.createElement("span");
    cnt.className = "count";
    cnt.hidden = true;

    b.appendChild(img);
    b.appendChild(cnt);
    return b;
  }

  function buildGrid() {
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var s = makeSlot();
        s.setAttribute("aria-label", "合成格 " + (idx + 1));
        s.addEventListener("click", function () { onGrid(idx); });
        s.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          clearGrid();
        });
        gridEl.appendChild(s);
        gridEls.push(s);
      })(i);
    }
  }

  function buildInv() {
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var s = makeSlot();
        var id = BAG_ORDER[idx];

        if (!id) {
          s.classList.add("is-empty");
          s.disabled = true;
          s.tabIndex = -1;
          s.setAttribute("aria-hidden", "true");
          invEl.appendChild(s);
          return;
        }

        invEls[id] = s;
        s.setAttribute("aria-label", NAME[id]);
        s.addEventListener("click", function () { onBag(id); });
        invEl.appendChild(s);
      })(i);
    }
  }

  function buildOutput() {
    var img = document.createElement("img");
    img.alt = "";
    img.hidden = true;

    var cnt = document.createElement("span");
    cnt.className = "count";
    cnt.hidden = true;

    outEl.appendChild(img);
    outEl.appendChild(cnt);
  }

  /* =========================================================
     绘制
     ========================================================= */
  function paint(el, id, count, ghost) {
    var img = el.querySelector("img");
    var cnt = el.querySelector(".count");
    if (!img) return;

    el.classList.toggle("ghost", !!ghost);

    if (id) {
      var src = SRC[id];
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.alt = NAME[id];
      img.hidden = false;
    } else {
      img.hidden = true;
      img.removeAttribute("src");
    }

    if (!cnt) return;

    if (count && count > 1) {
      cnt.textContent = count;
      cnt.hidden = false;
    } else {
      cnt.hidden = true;
    }
  }

  function isMatch() {
    for (var i = 0; i < 9; i++) {
      if (grid[i] !== RECIPE[i]) return false;
    }
    return true;
  }

  function render() {
    for (var i = 0; i < 9; i++) {
      var need = (hintOn && !grid[i]) ? RECIPE[i] : null;
      paint(gridEls[i], grid[i] || need, 0, !!need);
    }

    for (var k = 0; k < BAG_ORDER.length; k++) {
      var id = BAG_ORDER[k];
      var n = bag[id] || 0;
      paint(invEls[id], id, n, false);
      invEls[id].classList.toggle("is-empty", n === 0);
    }

    paint(outEl, isMatch() ? "cake" : null, 0, false);
    syncHeld();
  }

  /* =========================================================
     手上的物品
     ========================================================= */
  function syncHeld() {
    if (!held) {
      heldEl.classList.remove("on");
      return;
    }
    var img = heldEl.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      heldEl.appendChild(img);
    }
    var src = SRC[held.id];
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);

    heldEl.classList.add("on");
    heldEl.style.transform =
      "translate3d(" + lastPointer.x + "px," + lastPointer.y + "px,0) translate(-50%,-50%) scale(1.15)";
  }

  /* =========================================================
     交互
     ========================================================= */
  function onBag(id) {
    if (done) return;

    if (held) {
      if (held.id === id) {
        bag[id] = (bag[id] || 0) + 1;
        held = null;
        sfx.click();
        render();
      } else {
        sfx.error();
        toast("手上还拿着" + NAME[held.id] + "，先放到合成格里");
      }
      return;
    }

    if (!bag[id]) {
      sfx.error();
      toast(NAME[id] + " 已经用完了");
      return;
    }

    bag[id] -= 1;
    held = { id: id };
    sfx.click();
    render();
  }

  function onGrid(i) {
    if (done) return;

    if (held) {
      if (grid[i]) {
        sfx.error();
        return;
      }
      grid[i] = held.id;
      held = null;
      sfx.place();
      afterChange();
      return;
    }

    if (!grid[i]) return;

    held = { id: grid[i] };
    grid[i] = null;
    sfx.pick();
    afterChange();
  }

  function afterChange() {
    var ok = isMatch();

    if (ok !== wasReady) {
      wasReady = ok;
      if (ok) sfx.ready();
      outEl.classList.toggle("ready", ok);
      arrowEl.classList.toggle("ready", ok);
    }

    render();
  }

  function clearGrid() {
    if (done) return;

    var moved = 0;
    for (var i = 0; i < 9; i++) {
      if (grid[i]) {
        bag[grid[i]] = (bag[grid[i]] || 0) + 1;
        grid[i] = null;
        moved++;
      }
    }
    if (held) {
      bag[held.id] = (bag[held.id] || 0) + 1;
      held = null;
      moved++;
    }

    if (moved) sfx.pick();
    else sfx.click();

    wasReady = false;
    outEl.classList.remove("ready");
    arrowEl.classList.remove("ready");
    render();
  }

  function shakeOutput() {
    if (!outEl.animate) return;
    outEl.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(0)" }
      ],
      { duration: 280, easing: "ease-in-out" }
    );
  }

  /* =========================================================
     合成 → 进入许愿
     ========================================================= */
  function craft() {
    if (done) return;

    if (!isMatch()) {
      sfx.error();
      shakeOutput();
      toast("材料还没摆对，点「看图解」看看配方");
      return;
    }

    done = true;
    sfx.win();
    outEl.classList.add("ready");
    toast("🎂 蛋糕合成成功，可以许愿了", 2200);

    // 用整站那套烟花庆祝
    if (window.BIRTHDAY_FX && window.BIRTHDAY_FX.finale) {
      window.BIRTHDAY_FX.finale();
    }

    setTimeout(function () {
      if (stageEl) stageEl.classList.add("is-out");
      setTimeout(function () {
        if (stageEl) stageEl.style.display = "none";
        showWish();
      }, 460);
    }, 1500);
  }

  function showWish() {
    if (!wishEl) return;

    if (againBtn) againBtn.hidden = true;
    wishEl.hidden = false;
    void wishEl.offsetWidth; // 让 transition 生效
    wishEl.classList.add("in");

    if (subEl) subEl.textContent = "闭上眼，把心愿放进心里，然后吹灭蜡烛";

    try {
      wishEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      if (wishEl.scrollIntoView) wishEl.scrollIntoView();
    }
  }

  function restart() {
    done = false;
    held = null;
    hintOn = false;
    wasReady = false;
    grid = [null, null, null, null, null, null, null, null, null];
    bag = {
      milk: START_BAG.milk,
      sugar: START_BAG.sugar,
      egg: START_BAG.egg,
      wheat: START_BAG.wheat
    };

    outEl.classList.remove("ready");
    arrowEl.classList.remove("ready");
    heldEl.classList.remove("on");

    if (hintBtn) {
      hintBtn.classList.remove("is-on");
      hintBtn.textContent = "看图解";
    }

    if (wishEl) {
      wishEl.hidden = true;
      wishEl.classList.remove("in"); // 下次合成再重新淡入
    }
    if (againBtn) againBtn.hidden = true;

    if (stageEl) {
      stageEl.style.display = "";
      stageEl.classList.remove("is-out");
      stageEl.classList.add("in");
    }

    if (subEl) subEl.textContent = "先用合成台，把生日蛋糕合出来";

    // 蜡烛重新点亮（main.js 里暴露出来的）
    if (window.BirthdayWish && window.BirthdayWish.reset) {
      window.BirthdayWish.reset();
    }

    render();

    try {
      var sec = document.getElementById("cake");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { }
  }

  /* =========================================================
     事件
     ========================================================= */
  buildGrid();
  buildInv();
  buildOutput();

  outEl.addEventListener("click", craft);

  if (hintBtn) {
    hintBtn.addEventListener("click", function () {
      hintOn = !hintOn;
      hintBtn.classList.toggle("is-on", hintOn);
      hintBtn.textContent = hintOn ? "收起图解" : "看图解";
      sfx.click();
      render();
    });
  }

  if (clearBtn) clearBtn.addEventListener("click", clearGrid);
  if (againBtn) againBtn.addEventListener("click", restart);

  document.addEventListener("pointerdown", function (e) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    sfx.unlock();
    syncHeld();
  }, { passive: true, capture: true });

  document.addEventListener("pointermove", function (e) {
    if (!held) return;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    syncHeld();
  }, { passive: true });

  /* 给外面的按钮用 */
  window.CakeCraft = {
    restart: restart,
    craft: craft
  };

  /* 开始 */
  render();
})();
