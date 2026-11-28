/* ============================================================================
 * 포코쿠지 (POKO KUJI) · Supabase 백엔드 어댑터 v1
 * ----------------------------------------------------------------------------
 * 이 파일 하나로 데모(index.html)와 실제 Supabase 를 잇습니다.
 *   · config.js 에 SUPABASE_URL / SUPABASE_ANON_KEY 가 비어 있으면  → 데모 모드(어댑터 꺼짐)
 *   · 두 값을 넣으면                                              → 실DB 모드 자동 전환
 *
 * 외부 라이브러리(supabase-js) 없이 fetch 만 사용합니다.
 * (데모 페이지의 "외부 CDN 의존 없음" 원칙 유지 · GitHub Pages 그대로 배포 가능)
 *
 * 쓰는 법
 *   CHII_BACKEND.enabled        실DB 모드인가
 *   await CHII_BACKEND.init()   세션 복원
 *   CHII_BACKEND.signIn / signUp / convertGuest / signInAnonymous / signOut / currentUser
 *   CHII_BACKEND.isGuest() / isMember()
 *   await CHII_BACKEND.updateProfile({nickname, phone})  내 닉네임·연락처 저장
 *   await CHII_BACKEND.setStarter('poko'|'leo'|'pet')   스타팅 DB 저장
 *   await CHII_BACKEND.catalog()          시리즈·박스·등급 (index.html 의 state.series 모양)
 *   await CHII_BACKEND.draw(boxId, n)     원자적 뽑기 RPC
 *   await CHII_BACKEND.shelf()            내 진열장
 *   await CHII_BACKEND.shipments()        내 배송 신청 내역
 *   await CHII_BACKEND.requestShipment(ids, {name, phone, address, memo})
 *   await CHII_BACKEND.refreshBox(boxId)  박스 1개 최신화 (다른 사람 뽑기 반영)
 *   await CHII_BACKEND.refreshBoxes()     전체 박스 잔여 최신화
 *   await CHII_BACKEND.stats()            사장님 집계 (관리자)
 *   await CHII_BACKEND.resetSeries(sid)   재고 리셋 (관리자)
 *
 * 보안: 여기에 들어가는 것은 anon key 뿐입니다. service_role key 는 절대 넣지 마세요.
 * ==========================================================================*/
(function (global) {
  "use strict";

  var CFG = global.CHII_BACKEND_CONFIG || {};
  var URL_BASE = String(CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var ANON_KEY = String(CFG.SUPABASE_ANON_KEY || "");
  var STORE_KEY = "chiishop.session.v1";

  var enabled =
    /^https?:\/\/.+/.test(URL_BASE) &&
    ANON_KEY.length > 20 &&
    ANON_KEY.indexOf("여기에") < 0;

  /* ---------------------------------------------------------------- 상태 */
  var session = null;          // { access_token, refresh_token, expires_at, user }
  var refreshing = null;
  var listeners = [];

  function ApiError(message, code, status) {
    var e = new Error(message || "요청에 실패했어요");
    e.name = "ApiError";
    e.code = code || null;
    e.status = status || 0;
    return e;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.access_token) return null;
      return s;
    } catch (e) { return null; }
  }
  function writeStore(s) {
    try {
      if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) {}
  }
  function emit() {
    listeners.forEach(function (fn) {
      try { fn(currentUser()); } catch (e) {}
    });
  }

  function currentUser() {
    return session && session.user ? session.user : null;
  }

  /* 익명(게스트) 세션인가 — app_metadata.provider === 'anonymous' 또는 is_anonymous */
  function isGuest() {
    var u = currentUser();
    if (!u) return false;
    return !!(u.is_anonymous || u.isAnonymous ||
              (u.app_metadata && u.app_metadata.provider === "anonymous"));
  }
  function isMember() {
    return !!currentUser() && !isGuest();
  }

  /* ---------------------------------------------------------------- HTTP */
  function headers(extra) {
    var h = {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    h.Authorization = "Bearer " + (session && session.access_token ? session.access_token : ANON_KEY);
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  function parseError(res, body) {
    var msg = "요청에 실패했어요 (" + res.status + ")";
    var code = null;
    if (body) {
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) {}
      }
      if (body && typeof body === "object") {
        msg = body.message || body.error_description || body.msg || body.error || msg;
        code = body.code || null;
      }
    }
    if (res.status === 401 && !code) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    return ApiError(msg, code, res.status);
  }

  function request(path, opts) {
    opts = opts || {};
    return fetch(URL_BASE + path, {
      method: opts.method || "GET",
      headers: headers(opts.headers),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
        if (!res.ok) throw parseError(res, body);
        return body;
      });
    });
  }

  /* ---------------------------------------------------------------- 인증 */
  function saveAuth(payload) {
    if (!payload || !payload.access_token) return null;
    session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || (session && session.refresh_token) || null,
      expires_at: payload.expires_at || (payload.expires_in ? Math.floor(Date.now() / 1000) + payload.expires_in : 0),
      user: payload.user || (session && session.user) || null
    };
    writeStore(session);
    emit();
    return session;
  }

  function authPost(path, body) {
    return fetch(URL_BASE + path, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) throw parseError(res, data);
        return data;
      });
    });
  }

  function signIn(email, password) {
    return authPost("/auth/v1/token?grant_type=password", { email: email, password: password })
      .then(function (data) {
        saveAuth(data);
        return currentUser();
      });
  }

  function signUp(email, password, nickname, phone) {
    return authPost("/auth/v1/signup", {
      email: email,
      password: password,
      data: { nickname: nickname || "", phone: phone || "" }
    }).then(function (data) {
      if (data && data.access_token) { saveAuth(data); return currentUser(); }
      throw ApiError("가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.", "email_confirm", 200);
    });
  }

  /* 게스트(익명) 계정 → 정식 이메일 회원으로 전환.
     같은 user.id 를 그대로 쓰기 때문에 포인트·진열장·뽑기 기록이 유지된다. */
  function convertGuest(email, password, nickname, phone) {
    if (!session || !session.access_token) {
      return Promise.reject(ApiError("게스트 세션이 없어요. 새로고침 후 다시 시도해 주세요.", "no_session", 401));
    }
    return fetch(URL_BASE + "/auth/v1/user", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        email: email,
        password: password,
        data: { nickname: nickname || "", phone: phone || "" }
      })
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) throw parseError(res, data);
        return data;
      });
    }).then(function (data) {
      if (data && data.id) {
        if (session) {
          session.user = Object.assign({}, session.user || {}, data);
          session.expires_at = 0;          /* 토큰 claim(is_anonymous)을 새로 받는다 */
          writeStore(session);
        }
        return refreshIfNeeded().catch(function () { return session; })
          .then(function () {
            /* 전환된 계정의 프로필(닉네임·연락처)도 맞춰 둔다 */
            var body = {};
            if (nickname) body.nickname = nickname;
            if (phone) body.phone = phone;
            if (!Object.keys(body).length) return null;
            return updateProfile(body).catch(function () { return null; });
          })
          .then(function () { emit(); return currentUser(); });
      }
      throw ApiError("회원 전환에 실패했어요.", "convert_failed", 200);
    });
  }

  /* 익명 로그인 — Supabase Auth 설정에서 Anonymous sign-in 을 켜야 동작합니다. */
  function signInAnonymous() {
    return authPost("/auth/v1/signup", { data: {}, gotrue_meta_security: {} })
      .then(function (data) {
        if (data && data.access_token) { saveAuth(data); return currentUser(); }
        throw ApiError("익명 로그인이 꺼져 있어요. (Supabase → Authentication → Sign In / Providers → Anonymous)", "anon_disabled", 200);
      });
  }

  function signOut() {
    var token = session && session.access_token;
    session = null;
    writeStore(null);
    emit();
    if (!token) return Promise.resolve();
    return fetch(URL_BASE + "/auth/v1/logout", {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: "Bearer " + token }
    }).catch(function () {});
  }

  function refreshIfNeeded() {
    if (!session || !session.refresh_token) return Promise.resolve(session);
    var now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at - 60 > now) return Promise.resolve(session);
    if (refreshing) return refreshing;
    refreshing = authPost("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (data) { saveAuth(data); refreshing = null; return session; })
      .catch(function (err) { refreshing = null; session = null; writeStore(null); emit(); throw err; });
    return refreshing;
  }

  function init() {
    session = readStore();
    if (!enabled) return Promise.resolve(null);
    return refreshIfNeeded().catch(function () { return null; });
  }

  /* ---------------------------------------------------------- 데이터 조회 */
  var SELECT_SERIES = [
    "id", "title", "short_title", "price", "badge", "active", "featured_grade",
    "palette", "seed", "sort_no",
    "boxes(id,box_no,total_tickets,remaining_tickets,status," +
      "box_prizes(grade,name,value_p,total_qty,remaining_qty,is_last,sort_no))"
  ].join(",");

  var KIND_KEYS = [
    ["인형", "plush"], ["피규어", "plush"], ["쿠션", "cushion"], ["키링", "keyring"],
    ["스탠드", "stand"], ["머그", "mug"], ["파우치", "pouch"], ["스티커", "sticker"],
    ["타월", "towel"], ["파일", "file"], ["카드팩", "pack"],
    ["접시", "plate"], ["트레이", "plate"], ["코스터", "plate"]
  ];
  function kindOf(name, grade) {
    if (grade === "last") return "crown";
    for (var i = 0; i < KIND_KEYS.length; i++) {
      if (String(name || "").indexOf(KIND_KEYS[i][0]) >= 0) return KIND_KEYS[i][1];
    }
    return "pack";
  }

  function mapGrades(prizes) {
    return (prizes || [])
      .slice()
      .sort(function (a, b) { return (a.sort_no || 0) - (b.sort_no || 0); })
      .map(function (p) {
        return { k: p.grade, n: p.name, t: p.total_qty, v: p.value_p, r: p.remaining_qty };
      });
  }

  function mapBox(b) {
    var grades = mapGrades(b.box_prizes);
    var live = grades.filter(function (g) { return g.k !== "last"; });
    var remain = live.reduce(function (a, g) { return a + g.r; }, 0);
    var total = live.reduce(function (a, g) { return a + g.t; }, 0);
    var best = grades
      .filter(function (g) { return g.k !== "last" && g.r > 0; })
      .sort(function (a, b2) { return b2.v - a.v; })[0];
    return {
      id: b.id,
      no: b.box_no,
      grades: grades,
      featured: (best || grades[0] || { k: "J" }).k,
      drawn: Math.max(0, total - remain),
      logs: null,
      status: b.status,
      remain: remain,
      total: total
    };
  }

  function mapSeries(rows) {
    return (rows || []).map(function (s, i) {
      var boxes = (s.boxes || []).slice()
        .sort(function (a, b) { return a.box_no - b.box_no; })
        .map(mapBox);
      var firstOpen = boxes.filter(function (b) { return b.remain > 0; })[0] || boxes[0];
      return {
        id: s.id,
        def: {
          id: s.id,
          name: s.title,
          short: s.short_title,
          price: s.price,
          tag: s.badge || "",
          hot: i < 2,
          cur: firstOpen ? firstOpen.no : 1,
          featured: s.featured_grade,
          seed: s.seed,
          pal: (s.palette && s.palette.length === 2) ? s.palette : ["#ffe0ef", "#e0559a"],
          grades: (boxes[0] ? boxes[0].grades : []).map(function (g) {
            return { k: g.k, n: g.n, t: g.t, v: g.v };
          })
        },
        boxes: boxes,
        rev: 0,
        sold: 0
      };
    });
  }

  function catalog() {
    return request("/rest/v1/series?select=" + encodeURIComponent(SELECT_SERIES) +
      "&active=eq.true&order=sort_no.asc")
      .then(mapSeries);
  }

  function profile() {
    var u = currentUser();
    if (!u) return Promise.resolve(null);
    return request("/rest/v1/profiles?select=id,nickname,points,is_admin," +
      "total_spent,starter_id,welcome_discount_used,app_bonus_claimed,phone&id=eq." + u.id)
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  }

  /* 홈 화면 앱 설치 보너스 +1,000P — 계정당 1회.
     응답: { ok, code:'claimed'|'already_claimed'|'guest'|'no_auth', granted, points } */
  function appBonus() {
    return request("/rest/v1/rpc/claim_app_install_bonus", { method: "POST", body: {} });
  }

  function updateProfile(patch) {
    var u = currentUser();
    if (!u) return Promise.reject(ApiError("로그인이 필요합니다.", "28000", 401));
    var body = {};
    if (patch && typeof patch.nickname === "string") body.nickname = patch.nickname;
    if (patch && typeof patch.phone === "string") body.phone = patch.phone;
    if (!Object.keys(body).length) return Promise.resolve(null);
    return request("/rest/v1/profiles?id=eq." + u.id, { method: "PATCH", body: body });
  }

  function setStarter(key) {
    return request("/rest/v1/rpc/set_starter", {
      method: "POST",
      body: { p_starter: key }
    });
  }

  function refreshBox(boxId) {
    var sel = "id,box_no,total_tickets,remaining_tickets,status," +
      "box_prizes(grade,name,value_p,total_qty,remaining_qty,is_last,sort_no)";
    return request("/rest/v1/boxes?select=" + encodeURIComponent(sel) + "&id=eq." + boxId)
      .then(function (rows) { return rows && rows[0] ? mapBox(rows[0]) : null; });
  }

  function refreshBoxes() {
    return request("/rest/v1/boxes?select=id,series_id,box_no,total_tickets,remaining_tickets,status&order=series_id.asc,box_no.asc");
  }

  function draw(boxId, count) {
    return request("/rest/v1/rpc/draw_kuji", {
      method: "POST",
      body: { p_box_id: boxId, p_count: count }
    });
  }

  var SELECT_SHELF = "id,grade,prize_name,value_p,status,created_at,shipment_id," +
    "draw:draws(box:boxes(id,box_no,series_id))";

  function mapShelfItem(it) {
    var box = it.draw && it.draw.box ? it.draw.box : null;
    return {
      id: it.id,
      sid: box ? box.series_id : "beach",
      boxNo: box ? box.box_no : 0,
      g: it.grade,
      k: it.grade,
      n: it.prize_name,
      kind: kindOf(it.prize_name, it.grade),
      ch: "chii",
      name: it.prize_name,
      value: it.value_p,
      shipped: it.status !== "stored",
      status: it.status,
      shipmentId: it.shipment_id,
      at: new Date(it.created_at)
    };
  }

  function shelf() {
    return request("/rest/v1/shelf_items?select=" + encodeURIComponent(SELECT_SHELF) +
      "&user_id=eq." + (currentUser() ? currentUser().id : "00000000-0000-0000-0000-000000000000") +
      "&order=created_at.desc&limit=500")
      .then(function (rows) { return (rows || []).map(mapShelfItem); });
  }

  function shipments() {
    return request("/rest/v1/shipments?select=id,receipt_no,item_count,receiver_name,status,created_at" +
      "&user_id=eq." + (currentUser() ? currentUser().id : "00000000-0000-0000-0000-000000000000") +
      "&order=created_at.desc&limit=100")
      .then(function (rows) {
        return (rows || []).map(function (s) {
          var d = new Date(s.created_at);
          return {
            id: s.id,
            no: s.receipt_no,
            count: s.item_count,
            date: (d.getMonth() + 1) + "/" + d.getDate(),
            name: s.receiver_name,
            status: s.status
          };
        });
      });
  }

  function requestShipment(ids, receiver) {
    return request("/rest/v1/rpc/request_shipment", {
      method: "POST",
      body: {
        p_item_ids: ids,
        p_receiver_name: receiver.name,
        p_phone: receiver.phone,
        p_address: receiver.address,
        p_memo: receiver.memo || null
      }
    });
  }

  function stats() {
    return request("/rest/v1/rpc/admin_stats", { method: "POST", body: {} });
  }

  function resetSeries(seriesId) {
    return request("/rest/v1/rpc/admin_reset_series", {
      method: "POST",
      body: { p_series_id: seriesId }
    });
  }

  function adjustPoints(userId, delta, memo) {
    return request("/rest/v1/rpc/admin_adjust_points", {
      method: "POST",
      body: { p_user_id: userId, p_delta: delta, p_memo: memo || null }
    });
  }

  /* ---------------------------------------------------------------- 공개 */
  global.CHII_BACKEND = {
    enabled: enabled,
    mode: enabled ? "live" : "demo",
    url: URL_BASE,
    init: init,
    signIn: signIn,
    signUp: signUp,
    convertGuest: convertGuest,
    signInAnonymous: signInAnonymous,
    signOut: signOut,
    currentUser: currentUser,
    isGuest: isGuest,
    isMember: isMember,
    updateProfile: updateProfile,
    setStarter: setStarter,
    refresh: function () { return refreshIfNeeded(); },
    onAuth: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    catalog: catalog,
    profile: profile,
    appBonus: appBonus,
    draw: draw,
    shelf: shelf,
    shipments: shipments,
    requestShipment: requestShipment,
    refreshBox: refreshBox,
    refreshBoxes: refreshBoxes,
    stats: stats,
    resetSeries: resetSeries,
    adjustPoints: adjustPoints
  };
})(window);
