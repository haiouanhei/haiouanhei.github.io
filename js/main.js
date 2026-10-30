/* =========================================================
   生日祝福网站 · 交互主逻辑
   ---------------------------------------------------------
   1. 读取 config.js，把内容渲染到页面
   2. 入场页 → 撒花 + 开启音乐
   3. 粒子 / 撒花 / 烟花 粒子引擎（Canvas）
   4. 吹蜡烛：点一下吹灭，全灭后放烟花
   5. 那封信的打字机效果
   6. 滚动浮现、卡片 3D 倾斜、鼠标光斑、进度条
   ========================================================= */

(function () {
  "use strict";

  var cfg = window.BIRTHDAY_CONFIG || {};
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* =========================================================
     1. 把 config 渲染进页面
     ========================================================= */

  var NAME = String(cfg.name || "你").trim() || "你";
  document.title = NAME + " · 生日快乐 🎂";
  $$("[data-name]").forEach(function (el) { el.textContent = NAME; });

  if (cfg.subtitle) {
    $$("[data-subtitle]").forEach(function (el) { el.textContent = cfg.subtitle; });
  }
  if (cfg.signature) {
    var signEl = $("[data-sign]");
    if (signEl) signEl.textContent = cfg.signature;
  }

  /* --- 背景图 --- */
  if (cfg.backgroundImage) {
    var probe = new Image();
    probe.onload = function () {
      document.documentElement.style.setProperty(
        "--bg-img",
        'url("' + String(cfg.backgroundImage) + '")'
      );
      document.body.classList.add("has-bg");
    };
    probe.src = cfg.backgroundImage;
  }

  /* --- 生日日期 / 倒计时 --- */
  function parseDate(str) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || "").trim());
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  }

  (function initDateChips() {
    var dateChip = $("#dateChip");
    var countChip = $("#countChip");
    var bd = parseDate(cfg.date);
    if (!bd) {
      if (dateChip) dateChip.textContent = "🎂 生日快乐";
      if (countChip) {
        countChip.textContent = cfg.age ? ("👑 第 " + cfg.age + " 个生日") : "✨ 今天最特别";
      }
      return;
    }

    if (dateChip) {
      dateChip.textContent = "🎂 " + (bd.m + 1) + " 月 " + bd.d + " 日";
    }

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var next = new Date(today.getFullYear(), bd.m, bd.d);
    if (next.getTime() < today.getTime()) {
      next = new Date(today.getFullYear() + 1, bd.m, bd.d);
    }
    var days = Math.round((next.getTime() - today.getTime()) / 86400000);

    if (countChip) {
      if (days === 0) {
        countChip.textContent = "🎉 今天就是你的生日";
      } else if (cfg.age) {
        countChip.textContent = "👑 第 " + cfg.age + " 个生日 · 还有 " + days + " 天";
      } else {
        countChip.textContent = "✨ 距离生日还有 " + days + " 天";
      }
    }
  })();

  /* --- 祝福卡片 --- */
  (function initWishes() {
    var grid = $("#wishesGrid");
    if (!grid) return;
    var list = Array.isArray(cfg.wishes) && cfg.wishes.length ? cfg.wishes : [
      { icon: "🌟", title: "星光不负", text: "愿你所有认真努力的日子，都被世界温柔地回报。" },
      { icon: "🎂", title: "甜到心里", text: "愿你的生活像生日蛋糕一样，每一层都藏着惊喜。" },
      { icon: "🍀", title: "好运常在", text: "愿你想要的都能拥有，得不到的都能释怀。" },
      { icon: "🎈", title: "自由自在", text: "愿你永远有说走就走的底气，也永远有随时回家的路。" },
      { icon: "💫", title: "前程似锦", text: "愿你走过千山万水，归来仍是少年。" },
      { icon: "❤️", title: "被爱包围", text: "愿你被这个世界温柔以待，也永远值得被爱。" }
    ];

    list.forEach(function (item, i) {
      var card = document.createElement("article");
      card.className = "wish reveal";
      card.style.transitionDelay = (i * 80) + "ms";

      var icon = document.createElement("div");
      icon.className = "wish-icon";
      icon.textContent = item.icon || "✨";
      icon.setAttribute("aria-hidden", "true");

      var h3 = document.createElement("h3");
      h3.textContent = item.title || "";

      var p = document.createElement("p");
      p.textContent = item.text || "";

      card.appendChild(icon);
      card.appendChild(h3);
      card.appendChild(p);
      grid.appendChild(card);
    });
  })();

  /* =========================================================
     2. 粒子引擎：星尘 / 撒花 / 烟花
     ========================================================= */

  var FX = (function () {
    var canvas = $("#fx");
    if (!canvas) return { cannon: noop, finale: noop, burst: noop, rocket: noop, resize: noop };

    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, dpr = 1;
    var sparkles = [], confetti = [], rockets = [], sparks = [];
    var COLORS = ["#ffd76e", "#ff8fbf", "#a78bfa", "#7ee8dd", "#fff3c9", "#ff6b9d", "#ffe6a7", "#c7a3ff"];
    var running = false;
    var last = 0;

    function noop() {}

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedSparkles();
    }

    function seedSparkles() {
      sparkles.length = 0;
      var count = reduce ? 10 : clamp(Math.round(W / 24), 22, 64);
      for (var i = 0; i < count; i++) {
        sparkles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: rand(0.7, 2.3),
          vx: rand(-0.12, 0.12),
          vy: rand(-0.35, -0.08),
          a: rand(0.18, 0.75),
          tw: Math.random() * Math.PI * 2,
          ts: rand(0.008, 0.03)
        });
      }
    }

    /* --- 撒花 --- */
    function burst(n, origin) {
      if (reduce) n = Math.round(n * 0.35);
      for (var i = 0; i < n; i++) {
        var ox = origin ? origin.x : rand(0.15, 0.85) * W;
        var oy = origin ? origin.y : rand(0.1, 0.4) * H;
        var ang = origin ? rand(0, Math.PI * 2) : rand(-Math.PI * 0.85, -Math.PI * 0.15);
        var spd = rand(2.4, 9.5);
        confetti.push({
          x: ox, y: oy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          w: rand(5, 10),
          h: rand(8, 17),
          rot: rand(0, 6.28),
          vr: rand(-0.22, 0.22),
          color: pick(COLORS),
          round: Math.random() < 0.3,
          life: 1,
          decay: rand(0.0035, 0.0075)
        });
      }
      start();
    }

    /* --- 从底部两侧打礼花 --- */
    function cannon() {
      var shots = reduce ? 40 : 90;
      [-1, 1].forEach(function (dir) {
        for (var i = 0; i < shots / 2; i++) {
          var ang = dir > 0 ? rand(-1.35, -0.75) : rand(-2.4, -1.8);
          var spd = rand(9, 18);
          confetti.push({
            x: dir > 0 ? W * 0.08 : W * 0.92,
            y: H + 12,
            vx: Math.cos(ang) * spd * (dir > 0 ? 1 : 1),
            vy: Math.sin(ang) * spd,
            w: rand(5, 11),
            h: rand(9, 18),
            rot: rand(0, 6.28),
            vr: rand(-0.25, 0.25),
            color: pick(COLORS),
            round: Math.random() < 0.28,
            life: 1,
            decay: rand(0.003, 0.006)
          });
        }
      });
      start();
    }

    /* --- 烟花 --- */
    function rocket() {
      rockets.push({
        x: rand(0.15, 0.85) * W,
        y: H + 10,
        vx: rand(-0.9, 0.9),
        vy: rand(-13, -10),
        color: pick(COLORS),
        targetY: rand(0.12, 0.42) * H
      });
      start();
    }

    function explode(x, y, color) {
      var n = reduce ? 26 : 78;
      for (var i = 0; i < n; i++) {
        var ang = (Math.PI * 2 * i) / n + rand(-0.06, 0.06);
        var spd = rand(1.6, 7.2);
        sparks.push({
          x: x, y: y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1,
          decay: rand(0.008, 0.02),
          color: Math.random() < 0.22 ? "#fff6d8" : color,
          size: rand(1.1, 2.6)
        });
      }
    }

    function finale() {
      cannon();
      var n = reduce ? 2 : 4;
      for (var i = 0; i < n; i++) {
        (function (k) {
          setTimeout(function () { rocket(); }, 220 * k + rand(0, 180));
        })(i);
      }
    }

    /* --- 主循环 --- */
    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }

    function frame(now) {
      if (!running) return;
      var dt = clamp((now - last) / 16.667, 0.2, 3);
      last = now;

      ctx.clearRect(0, 0, W, H);

      /* 星尘 */
      ctx.globalCompositeOperation = "lighter";
      for (var s = 0; s < sparkles.length; s++) {
        var sp = sparkles[s];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.tw += sp.ts * dt;
        if (sp.y < -10) { sp.y = H + 10; sp.x = Math.random() * W; }
        if (sp.x < -10) sp.x = W + 10;
        if (sp.x > W + 10) sp.x = -10;

        var alpha = sp.a * (0.55 + 0.45 * Math.sin(sp.tw));
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r, 0, 6.2832);
        ctx.fillStyle = "rgba(255, 244, 214, " + alpha.toFixed(3) + ")";
        ctx.fill();
      }

      /* 烟花拖尾 */
      for (var r = rockets.length - 1; r >= 0; r--) {
        var rk = rockets[r];
        rk.x += rk.vx * dt;
        rk.y += rk.vy * dt;
        rk.vy += 0.14 * dt;

        ctx.beginPath();
        ctx.arc(rk.x, rk.y, 2, 0, 6.2832);
        ctx.fillStyle = rk.color;
        ctx.fill();

        sparks.push({
          x: rk.x, y: rk.y,
          vx: rand(-0.3, 0.3),
          vy: rand(0.2, 0.9),
          life: 0.8,
          decay: 0.06,
          color: rk.color,
          size: rand(0.8, 1.8)
        });

        if (rk.y <= rk.targetY || rk.vy >= 0) {
          explode(rk.x, rk.y, rk.color);
          rockets.splice(r, 1);
        }
      }

      /* 烟花火星 */
      for (var k = sparks.length - 1; k >= 0; k--) {
        var sk = sparks[k];
        sk.x += sk.vx * dt;
        sk.y += sk.vy * dt;
        sk.vy += 0.055 * dt;
        sk.vx *= 0.985;
        sk.vy *= 0.985;
        sk.life -= sk.decay * dt;
        if (sk.life <= 0) { sparks.splice(k, 1); continue; }

        ctx.beginPath();
        ctx.arc(sk.x, sk.y, sk.size * sk.life, 0, 6.2832);
        ctx.fillStyle = hexToRgba(sk.color, sk.life);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";

      /* 撒花 */
      for (var c = confetti.length - 1; c >= 0; c--) {
        var p = confetti[c];
        p.vy += 0.115 * dt;
        p.vx *= 0.992;
        p.vy *= 0.998;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= p.decay * dt;

        if (p.life <= 0 || p.y > H + 60) { confetti.splice(c, 1); continue; }

        var alpha2 = clamp(p.life * 1.8, 0, 1);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = alpha2;
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, 6.2832);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.55 + Math.abs(Math.cos(p.rot)) * 0.45));
        }
        ctx.restore();
      }

      // 星尘常驻，所以循环不会自行停止
      requestAnimationFrame(frame);
    }

    function hexToRgba(hex, a) {
      var h = hex.replace("#", "");
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    start();

    return {
      burst: burst,
      cannon: cannon,
      rocket: rocket,
      finale: finale,
      resize: resize
    };
  })();

  /* 给合成小游戏（js/craft.js）用：合出蛋糕时放烟花 */
  window.BIRTHDAY_FX = FX;

  /* =========================================================
     3. 音乐
     ========================================================= */

  var music = (typeof window.BirthdayMusic === "function") ? window.BirthdayMusic(cfg) : null;
  var fab = $("#musicFab");
  var fabBars = $$("#musicFab .bars i");
  var musicBtn2 = $("#musicBtn2");

  function syncMusicUI(playing) {
    if (fab) {
      fab.classList.toggle("playing", playing);
      fab.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    if (musicBtn2) {
      musicBtn2.textContent = playing ? "♪ 暂停音乐" : "♪ 播放音乐";
    }
  }

  if (music) {
    music.onState = syncMusicUI;
  }

  function toggleMusic() {
    if (!music) return;
    if (music.playing) {
      music.stop();
      syncMusicUI(false);
    } else {
      music.start().then(function () { syncMusicUI(true); });
    }
  }

  if (fab) fab.addEventListener("click", toggleMusic);
  if (musicBtn2) musicBtn2.addEventListener("click", toggleMusic);

  /* 音乐律动条 */
  (function visualize() {
    var data = null;
    var bands = [[2, 7], [8, 15], [16, 24], [25, 38]];

    // 拿不到频谱时（本地直接播放的 mp3 等）用一条柔和的假波形顶上
    function fakeWave() {
      var t = performance.now() / 320;
      for (var q = 0; q < fabBars.length; q++) {
        var fv = 0.28 + 0.42 * Math.abs(Math.sin(t + q * 1.15));
        fabBars[q].style.height = Math.round(14 + fv * 86) + "%";
      }
    }

    function loop() {
      requestAnimationFrame(loop);
      if (!music || !music.playing || !fabBars.length) return;

      var analyser = music.analyser;
      if (!analyser) { fakeWave(); return; }

      if (!data || data.length !== analyser.frequencyBinCount) {
        data = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(data);

      var peak = 0;
      for (var p = 0; p < data.length; p += 6) {
        if (data[p] > peak) peak = data[p];
      }
      if (peak < 4) { fakeWave(); return; }

      for (var i = 0; i < fabBars.length; i++) {
        var a = bands[i][0], b = bands[i][1], sum = 0, n = 0;
        for (var j = a; j < b && j < data.length; j++) { sum += data[j]; n++; }
        var v = n ? (sum / n) / 255 : 0;
        fabBars[i].style.height = Math.round(14 + v * 86) + "%";
      }
    }
    loop();
  })();

  /* =========================================================
     4. 入场
     ========================================================= */

  var gate = $("#gate");
  var entered = false;

  function restartHeroAnim() {
    if (reduce) return;
    $$(".hero-eyebrow, .title-cn, .title-name, .hero-sub, .hero-meta, .hero-actions, .scroll-hint").forEach(function (el) {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    });
  }

  function enter() {
    if (entered) return;
    entered = true;

    document.body.classList.remove("locked");

    if (gate) {
      gate.classList.add("gone");
      setTimeout(function () {
        if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
      }, 1000);
    }

    if (music) {
      music.start().then(function () { syncMusicUI(true); });
    }

    setTimeout(function () { FX.cannon(); }, 320);
    setTimeout(function () { FX.rocket(); }, 700);
    setTimeout(function () { FX.rocket(); }, 1150);
    setTimeout(restartHeroAnim, 120);

    if (typeRequested) setTimeout(typeLetter, 700);
  }

  /* ---------- 密码锁 ---------- */
  (function initLock() {
    var lock = $("#lock");

    // 万一没有锁（旧结构），退回"点击进入"
    if (!lock) {
      if ($("#enterBtn")) $("#enterBtn").addEventListener("click", enter);
      return;
    }

    var PASS = String(cfg.password || "1031").replace(/\D/g, "") || "1031";
    var dotsBox = $("#lockDots");
    var msg = $("#lockMsg");
    var keypad = $("#keypad");
    var hintEl = $("[data-pass-hint]");

    var value = "";
    var busy = false;    // 校验中，暂时不接受输入
    var solved = false;  // 已解锁
    var primed = false;  // 音频上下文是否已预热

    if (hintEl && cfg.passwordHint) hintEl.textContent = cfg.passwordHint;

    // 按密码位数调整圆点数量（默认 4 个，改密码位数也能对上）
    while (dotsBox.children.length > PASS.length) {
      dotsBox.removeChild(dotsBox.lastElementChild);
    }
    while (dotsBox.children.length < PASS.length) {
      dotsBox.appendChild(document.createElement("span"));
    }

    function idleText() { return "请输入 " + PASS.length + " 位数字密码"; }

    function setMsg(text, cls) {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.remove("error", "ok");
      if (cls) msg.classList.add(cls);
    }

    setMsg(idleText());

    function render() {
      var dots = dotsBox.children;
      for (var d = 0; d < dots.length; d++) {
        dots[d].classList.toggle("on", d < value.length);
      }
    }

    function press(d) {
      if (busy || solved || value.length >= PASS.length) return;

      // 第一次按键时借这个"真实手势"把音频上下文预热，
      // 免得稍后自动播放被浏览器拦下来
      if (!primed && music) {
        primed = true;
        if (music.prime) music.prime();
      }

      value += d;
      render();
      if (value.length === PASS.length) setTimeout(check, 150);
    }

    function backspace() {
      if (busy || solved) return;
      value = value.slice(0, -1);
      render();
      setMsg(idleText());
    }

    function buzz(pattern) {
      if (navigator.vibrate) {
        try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
      }
    }

    function check() {
      if (solved || busy) return;

      if (value === PASS) {
        solved = true;
        lock.classList.add("unlocked");
        dotsBox.classList.add("ok");
        setMsg("密码正确 · 正在为你打开…", "ok");
        buzz(30);
        FX.burst(120);
        setTimeout(enter, 680);
        return;
      }

      busy = true;
      lock.classList.add("shake");
      setMsg("密码不对，再想想 🙂", "error");
      buzz([40, 60, 40]);
      FX.burst(8, { x: window.innerWidth / 2, y: window.innerHeight * 0.64 });

      setTimeout(function () {
        lock.classList.remove("shake");
        value = "";
        render();
        busy = false;
        setMsg(idleText());
      }, 640);
    }

    // 绑定数字键盘（按钮写在 HTML 里，脚本挂了也有样子）
    $$("[data-key]", keypad).forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-key");
        if (k === "back") backspace();
        else press(k);
      });
    });

    // 支持电脑键盘直接输入
    document.addEventListener("keydown", function (e) {
      if (solved || busy) return;
      if (!document.body.contains(lock)) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter" && value.length === PASS.length) {
        e.preventDefault();
        check();
      }
    });

    render();
  })();

  /* =========================================================
     5. 蜡烛
     ========================================================= */

  (function initCandles() {
    var box = $("#candles");
    var cakeBox = $("#cakeBox");
    var hint = $("#cakeHint");
    var doneEl = $("#cakeDone");
    var againCraftBtn = $("#againCraftBtn");
    if (!box) return;

    var total = clamp(parseInt(cfg.candles, 10) || 6, 1, 8);
    var lit = 0;
    var candles = [];

    function build() {
      box.innerHTML = "";
      candles = [];
      lit = 0;
      for (var i = 0; i < total; i++) {
        var c = document.createElement("div");
        c.className = "candle";

        var flame = document.createElement("i");
        flame.className = "flame";
        var smoke = document.createElement("i");
        smoke.className = "smoke";

        c.appendChild(flame);
        c.appendChild(smoke);
        c.setAttribute("role", "button");
        c.setAttribute("tabindex", "0");
        c.setAttribute("aria-label", "吹灭这根蜡烛");
        c.addEventListener("click", onCandle);
        c.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCandle(e);
          }
        });

        box.appendChild(c);
        candles.push(c);
        lit++;
      }
      if (cakeBox) cakeBox.classList.remove("dark");
      if (doneEl) { doneEl.classList.remove("show"); doneEl.textContent = ""; }
      if (againCraftBtn) againCraftBtn.hidden = true;
      if (hint) {
        hint.style.opacity = "1";
        hint.textContent = "🕯️ 点一下烛火，把它们吹灭";
      }
    }

    function onCandle(e) {
      var el = e.currentTarget;
      if (el.classList.contains("out")) {
        if (lit === 0) { build(); FX.burst(40); }
        return;
      }

      el.classList.add("out");
      lit--;

      var flame = el.querySelector(".flame");
      var rect = (flame || el).getBoundingClientRect();
      FX.burst(12, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

      if (lit === 0) {
        if (cakeBox) cakeBox.classList.add("dark");
        if (hint) hint.style.opacity = "0";
        if (doneEl) {
          doneEl.textContent = "愿望已送达 · 生日快乐， " + NAME + " 🎂";
          setTimeout(function () { doneEl.classList.add("show"); }, 120);
        }
        if (againCraftBtn) againCraftBtn.hidden = false;
        setTimeout(function () { FX.finale(); }, 200);
        setTimeout(function () { FX.rocket(); }, 1400);
      }
    }

    build();

    /* 给合成小游戏用：重新点亮蜡烛 */
    window.BirthdayWish = { reset: build };
  })();

  /* =========================================================
     6. 信（打字机）
     ========================================================= */

  var typeStarted = false;
  var typeRequested = false;

  /* 入场页还没点开时，先把打字的请求记下来，等进场后再打 */
  function requestType() {
    if (entered) typeLetter();
    else typeRequested = true;
  }

  function typeLetter() {
    if (typeStarted) return;
    typeStarted = true;

    var body = $("#letterBody");
    var sign = $("#letterSign");
    if (!body) return;

    var text = String(cfg.letter || "生日快乐，愿你岁岁欢愉，年年胜意。");
    var parts = text.split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) parts = ["生日快乐！"];

    var ps = parts.map(function (t) {
      var p = document.createElement("p");
      p.dataset.full = t;
      body.appendChild(p);
      return p;
    });

    var idx = 0;

    function nextParagraph() {
      if (idx >= ps.length) {
        if (sign) sign.classList.add("show");
        return;
      }

      var el = ps[idx];
      var full = el.dataset.full || "";

      if (reduce) {
        el.textContent = full;
        idx++;
        setTimeout(nextParagraph, 60);
        return;
      }

      el.classList.add("typing");
      var pos = 0;

      (function step() {
        pos++;
        el.textContent = full.slice(0, pos);

        if (pos < full.length) {
          var ch = full.charAt(pos - 1);
          var delay = 24;
          if (ch === "，" || ch === "、" || ch === "；") delay = 130;
          else if (ch === "。" || ch === "！" || ch === "？" || ch === "…") delay = 240;
          else if (ch === "\n") delay = 90;
          setTimeout(step, delay);
        } else {
          el.classList.remove("typing");
          idx++;
          setTimeout(nextParagraph, 340);
        }
      })();
    }

    nextParagraph();
  }

  /* =========================================================
     7. 滚动浮现 / 倾斜 / 光斑 / 进度条
     ========================================================= */

  (function initReveal() {
    var targets = $$(".reveal");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("in"); });
      typeLetter();
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });

    targets.forEach(function (el) { io.observe(el); });

    var letterCard = $("#letterCard");
    if (letterCard) {
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            requestType();
            io2.disconnect();
          }
        });
      }, { threshold: 0.25 });
      io2.observe(letterCard);
    }
  })();

  (function initTilt() {
    if (reduce) return;
    var cards = $$(".wish");
    cards.forEach(function (card) {
      var raf = 0, nx = 0, ny = 0;

      card.addEventListener("pointermove", function (e) {
        if (e.pointerType === "touch") return;
        var rect = card.getBoundingClientRect();
        nx = (e.clientX - rect.left) / rect.width - 0.5;
        ny = (e.clientY - rect.top) / rect.height - 0.5;
        if (!raf) {
          raf = requestAnimationFrame(function () {
            raf = 0;
            card.style.transform =
              "perspective(900px) rotateX(" + (-ny * 9).toFixed(2) + "deg) rotateY(" +
              (nx * 11).toFixed(2) + "deg) translateY(-6px)";
          });
        }
      });

      card.addEventListener("pointerleave", function () {
        card.style.transform = "";
      });
    });
  })();

  (function initGlow() {
    var glow = $("#cursorGlow");
    if (!glow || reduce) return;

    var tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    var cx = tx, cy = ty, shown = false;

    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      tx = e.clientX;
      ty = e.clientY;
      if (!shown) {
        shown = true;
        glow.style.opacity = "1";
      }
    }, { passive: true });

    (function loop() {
      requestAnimationFrame(loop);
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      glow.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";
    })();
  })();

  (function initProgress() {
    var bar = $("#progressBar");
    if (!bar) return;

    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? clamp(window.pageYOffset / max, 0, 1) : 0;
      bar.style.width = (p * 100).toFixed(2) + "%";
    }

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  })();

  /* =========================================================
     8. 页脚按钮
     ========================================================= */

  var replay = $("#replayBtn");
  if (replay) {
    replay.addEventListener("click", function () {
      FX.finale();
      setTimeout(function () { FX.finale(); }, 900);
    });
  }

  var topBtn = $("#topBtn");
  if (topBtn) {
    topBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

})();
