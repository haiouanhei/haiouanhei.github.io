/* =========================================================
   生日祝福网站 · 音乐引擎
   ---------------------------------------------------------
   两种模式：
   1) 内置模式（默认）：用 Web Audio 现场合成一首八音盒版
      《生日快乐》（钢琴般的音色 + 弦乐铺底 + 琶音 + 混响），
      不需要任何音频文件，离线也能听。
   2) 文件模式：config.js 里 music 填了地址就走文件模式。
   ========================================================= */

(function (global) {
  "use strict";

  /* ---------- 音名 → 频率 ---------- */
  var SEMI = {
    C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
    "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11
  };

  function midiOf(name) {
    var m = /^([A-G][#b]?)(-?\d+)$/.exec(name);
    if (!m) return 69;
    return (parseInt(m[2], 10) + 1) * 12 + SEMI[m[1]];
  }

  function freqOf(name) {
    return 440 * Math.pow(2, (midiOf(name) - 69) / 12);
  }

  function transpose(name, octaves) {
    return name.replace(/(-?\d+)$/, function (d) {
      return String(parseInt(d, 10) + octaves);
    });
  }

  /* ---------- 乐谱 ---------- */
  var BPM = 96;
  var BEAT = 60 / BPM;                 // 一拍 0.625s
  var BAR = BEAT * 3;                  // 3/4 拍
  var LOOP_BEATS = 24;                 // 8 小节
  var LOOP_DUR = LOOP_BEATS * BEAT;    // 15s

  // 《生日快乐》主旋律：[音名, 拍数]
  var MELODY = [
    ["G4", 0.5], ["G4", 0.5], ["A4", 1], ["G4", 1], ["C5", 1], ["B4", 2],
    ["G4", 0.5], ["G4", 0.5], ["A4", 1], ["G4", 1], ["D5", 1], ["C5", 2],
    ["G4", 0.5], ["G4", 0.5], ["G5", 1], ["E5", 1], ["C5", 1], ["B4", 0.5], ["A4", 1.5],
    ["F5", 0.5], ["F5", 0.5], ["E5", 1], ["C5", 1], ["D5", 1], ["C5", 2]
  ];

  // 每小节的和弦铺底：C - C - C - G - C - Am - F - G
  var CHORDS = [
    ["C3", "E3", "G3", "C4"],
    ["C3", "E3", "G3", "C4"],
    ["C3", "E3", "G3", "C4"],
    ["G2", "B2", "D3", "G3"],
    ["C3", "E3", "G3", "C4"],
    ["A2", "C3", "E3", "A3"],
    ["F2", "A2", "C3", "F3"],
    ["G2", "B2", "D3", "G3"]
  ];

  var ARP_ORDER = [1, 2, 3, 2, 1, 3];

  /* ---------- 引擎 ---------- */
  function MusicEngine(config) {
    config = config || {};
    this.cfg = config;
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.analyser = null;
    this.convolver = null;
    this.playing = false;
    this.loopTimer = null;
    this.nextLoopTime = 0;
    this.sources = [];
    this.audio = null;
    this.audioEl = null;
    this.useFile = !!(config.music && String(config.music).trim());
    this.onState = null;
    this._killTimer = null;
    this._synthStarted = false;
    this._ready = null;
  }

  /* 混响：程序生成的噪声脉冲响应 */
  MusicEngine.prototype._impulse = function (duration, decay) {
    var ctx = this.ctx;
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * duration));
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var ch = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  };

  /* 建立音频节点图 */
  MusicEngine.prototype.init = function () {
    var self = this;
    if (this._ready) return this._ready;

    this._ready = new Promise(function (resolve, reject) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { reject(new Error("当前浏览器不支持 Web Audio")); return; }

      var ctx;
      try { ctx = new AC(); } catch (e) { reject(e); return; }
      self.ctx = ctx;

      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      analyser.connect(ctx.destination);

      // 总音量 + 限幅，避免叠加音色时爆音
      var master = ctx.createGain();
      master.gain.value = 0.0001;

      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;

      master.connect(comp);
      comp.connect(analyser);

      var bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(master);

      // 混响支路
      var conv = ctx.createConvolver();
      conv.buffer = self._impulse(2.8, 2.6);
      var send = ctx.createGain();
      send.gain.value = 0.55;
      bus.connect(send);
      send.connect(conv);
      var wetGain = ctx.createGain();
      wetGain.gain.value = 0.85;
      conv.connect(wetGain);
      wetGain.connect(master);

      self.master = master;
      self.bus = bus;
      self.analyser = analyser;
      self.convolver = conv;

      // 外部音频文件
      if (self.useFile) {
        var el = new Audio();
        el.src = self.cfg.music;
        el.loop = true;
        el.preload = "auto";
        el.volume = 1;
        self.audioEl = el;

        el.addEventListener("error", function () {
          // 文件读不到就自动退回内置音乐
          self.useFile = false;
          self.audio = null;
          self.audioEl = null;
          if (self.playing) self._beginSynth();
        });

        // 本地 file:// 打开时，媒体元素接 Web Audio 会被判为跨域而静音，
        // 所以本地直接播放；只有 http(s) 才走音频图（这样才有频谱可视化）。
        var isFileProto = /^file:/i.test(String(
          (global.location && global.location.protocol) || ""
        ));

        if (!isFileProto) {
          el.crossOrigin = "anonymous";
          try {
            var msrc = ctx.createMediaElementSource(el);
            msrc.connect(master);
            self.audio = msrc;
          } catch (e) {
            self.audio = null;
          }
        }
      }
      resolve();
    });

    return this._ready;
  };

  /* ---------- 单个音色 ---------- */

  // 八音盒 / 钢片琴
  MusicEngine.prototype._bell = function (t, freq, dur, vol) {
    var ctx = this.ctx;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    var o1 = ctx.createOscillator();
    o1.type = "triangle";
    o1.frequency.setValueAtTime(freq, t);

    var o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(freq * 2.002, t);
    var g2 = ctx.createGain();
    g2.gain.value = 0.16;

    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.bus);

    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
    this._track(o1, o2);
  };

  // 弦乐 / 合成器铺底
  MusicEngine.prototype._pad = function (t, dur, notes, vol) {
    var ctx = this.ctx;
    var filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 1150;
    filt.Q.value = 0.5;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.75);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);

    filt.connect(g);
    g.connect(this.bus);

    for (var i = 0; i < notes.length; i++) {
      var f = freqOf(notes[i]);
      var detunes = [-5, 5];
      for (var d = 0; d < detunes.length; d++) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        o.detune.value = detunes[d];
        o.connect(filt);
        o.start(t);
        o.stop(t + dur + 1.6);
        this._track(o);
      }
    }
  };

  // 低音
  MusicEngine.prototype._bass = function (t, dur, note, vol) {
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freqOf(note), t);

    var filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 420;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);

    o.connect(filt);
    filt.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.4);
    this._track(o);
  };

  MusicEngine.prototype._track = function () {
    for (var i = 0; i < arguments.length; i++) {
      this.sources.push(arguments[i]);
    }
    var list = this.sources;
    if (list.length > 420) list.splice(0, list.length - 420);
  };

  /* ---------- 排谱 ---------- */
  MusicEngine.prototype._scheduleLoop = function (t0) {
    var bar, i, t, chord;

    for (bar = 0; bar < CHORDS.length; bar++) {
      t = t0 + bar * BAR;
      chord = CHORDS[bar];

      this._pad(t, BAR, chord, 0.05);
      this._bass(t, BAR, transpose(chord[0], -1), 0.075);

      for (i = 0; i < 6; i++) {
        var tone = chord[ARP_ORDER[i]] || chord[2];
        this._bell(t + i * (BEAT / 2), freqOf(transpose(tone, 1)) , 1.0, 0.028);
      }
    }

    var beat = 0;
    for (i = 0; i < MELODY.length; i++) {
      var item = MELODY[i];
      if (item[0]) {
        this._bell(
          t0 + beat * BEAT,
          freqOf(item[0]),
          Math.max(0.5, item[1] * BEAT * 1.15),
          0.075
        );
      }
      beat += item[1];
    }
  };

  /* 预先排下一轮，避免间隙 */
  MusicEngine.prototype._tick = function () {
    if (!this.playing || !this.ctx) return;
    var now = this.ctx.currentTime;
    var guard = 0;
    while (this.nextLoopTime < now + 2.5 && guard < 8) {
      this._scheduleLoop(this.nextLoopTime);
      this.nextLoopTime += LOOP_DUR;
      guard++;
    }
  };

  MusicEngine.prototype._beginSynth = function () {
    if (this.loopTimer) return;          // 已经在播，不要重复排谱
    this._killSources();                 // 清掉上一轮残留的音符，避免叠音
    this._synthStarted = true;
    this.nextLoopTime = this.ctx.currentTime + 0.25;
    this._scheduleLoop(this.nextLoopTime);
    this.nextLoopTime += LOOP_DUR;
    var self = this;
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(function () { self._tick(); }, 500);
  };

  MusicEngine.prototype._killSources = function () {
    for (var i = 0; i < this.sources.length; i++) {
      try { this.sources[i].stop(0); } catch (e) { /* 已停止 */ }
    }
    this.sources.length = 0;
    this._synthStarted = false;
  };

  /* ---------- 对外接口 ---------- */
  MusicEngine.prototype.start = function () {
    var self = this;
    return this.init().then(function () {
      if (self.ctx.state === "suspended") {
        return self.ctx.resume();
      }
    }).then(function () {
      if (self.playing) return;

      if (self._killTimer) {
        clearTimeout(self._killTimer);
        self._killTimer = null;
      }

      self.playing = true;

      var now = self.ctx.currentTime;
      var g = self.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, 0.0001), now);
      g.exponentialRampToValueAtTime(0.8, now + 1.4);

      if (self.useFile && self.audioEl) {
        var p = self.audioEl.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () {
            self.useFile = false;
            self._beginSynth();
          });
        }
      } else {
        self._beginSynth();
      }

      if (self.onState) self.onState(true);
    }).catch(function (err) {
      if (global.console) console.warn("[music]", err);
    });
  };

  /* 预热：在用户手势里先把音频上下文建好并 resume，
     这样稍后（例如密码校验通过后）再 start 就不会被自动播放策略拦下 */
  MusicEngine.prototype.prime = function () {
    var self = this;
    return this.init().then(function () {
      if (self.ctx.state === "suspended") return self.ctx.resume();
    }).catch(function () { /* ignore */ });
  };

  MusicEngine.prototype.stop = function () {
    if (!this.playing || !this.ctx) return;
    this.playing = false;

    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }

    var now = this.ctx.currentTime;
    var g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.exponentialRampToValueAtTime(0.0001, now + 0.45);

    if (this.audioEl) {
      try { this.audioEl.pause(); } catch (e) { /* ignore */ }
    }

    var self = this;
    this._killTimer = setTimeout(function () {
      if (!self.playing) self._killSources();
    }, 600);

    if (this.onState) this.onState(false);
  };

  MusicEngine.prototype.toggle = function () {
    return this.playing ? (this.stop(), Promise.resolve()) : this.start();
  };

  /* ---------- 导出 ---------- */
  global.BirthdayMusic = function (config) {
    return new MusicEngine(config);
  };
  global.BirthdayMusic.Engine = MusicEngine;
  global.BirthdayMusic.freqOf = freqOf;

})(window);
