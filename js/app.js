/* ============================================================
   Chi Tiêu Ver 1.1.01
   Quản lý thu chi cá nhân theo nhiều Ví — lưu dữ liệu cục bộ
   trên máy (localStorage), hoạt động offline dưới dạng PWA.
   ============================================================ */

(function () {
  "use strict";

  var APP_VERSION = "1.1.01";

  var LS_WALLETS = "ct_wallets";
  var LS_TX = "ct_transactions";
  var LS_PWHASH = "ct_pwhash";

  var MONTH_NAMES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

  /* ---------------- Storage helpers ---------------- */

  function loadWallets() {
    try { return JSON.parse(localStorage.getItem(LS_WALLETS)) || []; }
    catch (e) { return []; }
  }
  function saveWallets(list) { localStorage.setItem(LS_WALLETS, JSON.stringify(list)); }

  function loadTx() {
    try { return JSON.parse(localStorage.getItem(LS_TX)) || []; }
    catch (e) { return []; }
  }
  function saveTx(list) { localStorage.setItem(LS_TX, JSON.stringify(list)); }

  function getPwHash() { return localStorage.getItem(LS_PWHASH) || ""; }
  function setPwHash(h) { localStorage.setItem(LS_PWHASH, h); }

  /* ---------------- Utilities ---------------- */

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function formatDateDisplay(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var yy = parts[0].slice(2);
    return parts[2] + "/" + parts[1] + "/" + yy;
  }

  function formatMoney(n) {
    var v = Math.round(n || 0);
    var neg = v < 0;
    v = Math.abs(v);
    var s = v.toLocaleString("vi-VN");
    return (neg ? "-" : "") + s + " đ";
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function sha256Hex(text) {
    try {
      if (window.crypto && window.crypto.subtle) {
        var enc = new TextEncoder().encode(text);
        var buf = await window.crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      }
    } catch (e) { /* fall through to fallback */ }
    // Fallback (very old WebViews without crypto.subtle in insecure context)
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return "fb" + Math.abs(hash).toString(16);
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* ---------------- Domain helpers ---------------- */

  function walletById(id) {
    return loadWallets().filter(function (w) { return w.id === id; })[0];
  }

  function walletBalance(walletId, txList) {
    var list = txList || loadTx();
    var bal = 0;
    list.forEach(function (t) {
      if (t.walletId !== walletId) return;
      bal += t.type === "thu" ? t.amount : -t.amount;
    });
    return bal;
  }

  function overallBalance() {
    var list = loadTx();
    var bal = 0;
    list.forEach(function (t) { bal += t.type === "thu" ? t.amount : -t.amount; });
    return bal;
  }

  function walletTxSortedDesc(walletId) {
    var list = loadTx().filter(function (t) { return t.walletId === walletId; });
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
    var running = 0;
    var withBalance = list.map(function (t) {
      running += t.type === "thu" ? t.amount : -t.amount;
      return Object.assign({}, t, { runningBalance: running });
    });
    withBalance.reverse();
    return withBalance;
  }

  function periodRange(type, month, quarter, year) {
    year = parseInt(year, 10);
    if (type === "thang") {
      var m = parseInt(month, 10);
      var start = year + "-" + pad2(m) + "-01";
      var lastDay = new Date(year, m, 0).getDate();
      var end = year + "-" + pad2(m) + "-" + pad2(lastDay);
      return [start, end];
    }
    if (type === "quy") {
      var q = parseInt(quarter, 10);
      var startMonth = (q - 1) * 3 + 1;
      var endMonth = startMonth + 2;
      var lastDayQ = new Date(year, endMonth, 0).getDate();
      return [year + "-" + pad2(startMonth) + "-01", year + "-" + pad2(endMonth) + "-" + pad2(lastDayQ)];
    }
    // nam
    return [year + "-01-01", year + "-12-31"];
  }

  function sumInRange(start, end, walletId) {
    var list = loadTx();
    var thu = 0, chi = 0;
    list.forEach(function (t) {
      if (t.date < start || t.date > end) return;
      if (walletId && t.walletId !== walletId) return;
      if (t.type === "thu") thu += t.amount; else chi += t.amount;
    });
    return { thu: thu, chi: chi, net: thu - chi };
  }

  /* ---------------- Router ---------------- */

  function currentRoute() {
    var hash = location.hash || "#/home";
    var parts = hash.replace(/^#\//, "").split("/");
    return parts;
  }

  function navigate(hash) { location.hash = hash; }

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", function () {
    if (!location.hash) location.hash = "#/home";
    render();
    registerSW();
  });

  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
  }

  /* ---------------- Rendering ---------------- */

  var els = {};

  function render() {
    els.app = document.getElementById("app");
    var route = currentRoute();
    var page = route[0];

    if (page === "wallets") {
      renderWalletsPage();
    } else if (page === "wallet" && route[1]) {
      renderWalletDetailPage(route[1]);
    } else {
      renderHomePage();
    }
    updateNav(page === "wallet" ? "wallets" : page || "home");
  }

  function shellHeader(title, opts) {
    opts = opts || {};
    var backBtn = opts.back
      ? '<button class="back-btn" data-action="go-back" aria-label="Quay lại">&#8592;</button>'
      : "";
    return (
      '<header class="app-header">' +
      backBtn +
      "<h1>" + escapeHtml(title) + "</h1>" +
      '<span class="version-tag">v' + APP_VERSION + "</span>" +
      "</header>"
    );
  }

  function bottomNavHtml(active) {
    return (
      '<nav class="bottom-nav">' +
      '<a href="#/home" class="' + (active === "home" ? "active" : "") + '"><span class="icon">&#127968;</span>Trang chủ</a>' +
      '<a href="#/wallets" class="' + (active === "wallets" ? "active" : "") + '"><span class="icon">&#128179;</span>Ví</a>' +
      "</nav>"
    );
  }

  function updateNav(active) {
    document.querySelectorAll(".bottom-nav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#/" + active);
    });
  }

  /* ------------- Home Page ------------- */

  function renderHomePage() {
    var wallets = loadWallets();
    var now = new Date();
    var st = renderHomePage._state || {
      type: "thang",
      month: now.getMonth() + 1,
      quarter: Math.floor(now.getMonth() / 3) + 1,
      year: now.getFullYear()
    };
    renderHomePage._state = st;

    var range = periodRange(st.type, st.month, st.quarter, st.year);
    var totals = sumInRange(range[0], range[1]);

    var walletOptions = wallets.map(function (w) {
      return '<option value="' + w.id + '">' + escapeHtml(w.name) + "</option>";
    }).join("");

    var perWalletRows = wallets.map(function (w) {
      var t = sumInRange(range[0], range[1], w.id);
      if (t.thu === 0 && t.chi === 0) return "";
      return (
        "<tr>" +
        '<td class="reason">' + escapeHtml(w.name) + "</td>" +
        '<td class="amount thu">' + (t.thu ? "+" + formatMoney(t.thu) : "-") + "</td>" +
        '<td class="amount chi">' + (t.chi ? "-" + formatMoney(t.chi) : "-") + "</td>" +
        "</tr>"
      );
    }).join("");

    els.app.innerHTML =
      shellHeader("Chi Tiêu") +
      '<main>' +
      '<div class="overall-balance"><div class="label">Tổng số dư tất cả các ví</div><div class="value">' + formatMoney(overallBalance()) + "</div></div>" +

      '<div class="card">' +
      '<h2>Thêm giao dịch nhanh</h2>' +
      (wallets.length === 0
        ? '<p class="empty-state">Bạn chưa có ví nào. Hãy vào tab "Ví" để tạo ví trước.</p>'
        : renderTxFormHtml({ id: "home-tx-form", showWalletSelect: true, walletOptions: walletOptions })
      ) +
      "</div>" +

      '<div class="card">' +
      '<h2>Thống kê thu chi</h2>' +
      '<div class="stats-controls">' +
      selectHtml("stat-type", [
        ["thang", "Theo Tháng"], ["quy", "Theo Quý"], ["nam", "Theo Năm"]
      ], st.type) +
      (st.type === "thang" ? selectHtml("stat-month", monthOptions(), st.month) : "") +
      (st.type === "quy" ? selectHtml("stat-quarter", [["1","Quý 1"],["2","Quý 2"],["3","Quý 3"],["4","Quý 4"]], st.quarter) : "") +
      selectHtml("stat-year", yearOptions(), st.year) +
      "</div>" +
      '<div class="stats-grid">' +
      '<div class="stat-box income"><div class="label">Tổng Thu</div><div class="value">' + formatMoney(totals.thu) + "</div></div>" +
      '<div class="stat-box expense"><div class="label">Tổng Chi</div><div class="value">' + formatMoney(totals.chi) + "</div></div>" +
      '<div class="stat-box balance"><div class="label">Chênh lệch (Thu - Chi)</div><div class="value">' + formatMoney(totals.net) + "</div></div>" +
      "</div>" +
      (perWalletRows
        ? '<table class="tx-table"><thead><tr><th>Ví</th><th>Thu</th><th>Chi</th></tr></thead><tbody>' + perWalletRows + "</tbody></table>"
        : '<p class="empty-state">Chưa có giao dịch trong kỳ này.</p>') +
      "</div>" +
      "</main>" +
      bottomNavHtml("home");

    bindHomeStatControls(st);
  }

  function selectHtml(id, options, selected) {
    var opts = options.map(function (o) {
      var v = o[0], label = o[1];
      return '<option value="' + v + '"' + (String(v) === String(selected) ? " selected" : "") + ">" + label + "</option>";
    }).join("");
    return '<select id="' + id + '">' + opts + "</select>";
  }

  function monthOptions() {
    return MONTH_NAMES.map(function (m) { return [m, "Tháng " + m]; });
  }

  function yearOptions() {
    var curr = new Date().getFullYear();
    var arr = [];
    for (var y = curr - 5; y <= curr + 1; y++) arr.push([y, "Năm " + y]);
    return arr;
  }

  function bindHomeStatControls(st) {
    var typeSel = document.getElementById("stat-type");
    var yearSel = document.getElementById("stat-year");
    var monthSel = document.getElementById("stat-month");
    var quarterSel = document.getElementById("stat-quarter");

    if (typeSel) typeSel.addEventListener("change", function () {
      st.type = typeSel.value;
      renderHomePage();
    });
    if (yearSel) yearSel.addEventListener("change", function () {
      st.year = parseInt(yearSel.value, 10);
      renderHomePage();
    });
    if (monthSel) monthSel.addEventListener("change", function () {
      st.month = parseInt(monthSel.value, 10);
      renderHomePage();
    });
    if (quarterSel) quarterSel.addEventListener("change", function () {
      st.quarter = parseInt(quarterSel.value, 10);
      renderHomePage();
    });
  }

  /* ------------- Tx form (shared by Home + Wallet detail) ------------- */

  function renderTxFormHtml(opts) {
    var walletSelectHtml = opts.showWalletSelect
      ? '<div class="field"><label>Ví</label><select name="walletId" required><option value="">-- Chọn ví --</option>' + opts.walletOptions + "</select></div>"
      : "";
    return (
      '<form id="' + opts.id + '" data-action="add-tx" data-wallet-id="' + (opts.fixedWalletId || "") + '">' +
      walletSelectHtml +
      '<div class="field"><label>Ngày</label><input type="date" name="date" value="' + todayISO() + '" required></div>' +
      '<div class="field"><label>Lý do</label><input type="text" name="reason" placeholder="VD: Ăn trưa, Lương tháng 8..." required maxlength="120"></div>' +
      '<div class="field"><label>Số tiền</label><input type="number" name="amount" inputmode="numeric" min="0" step="1000" placeholder="0" required></div>' +
      '<div class="field"><label>Loại</label>' +
      '<div class="type-toggle" data-type-toggle>' +
      '<button type="button" class="active" data-type="chi">Chi</button>' +
      '<button type="button" data-type="thu">Thu</button>' +
      "</div>" +
      '<input type="hidden" name="type" value="chi">' +
      "</div>" +
      '<button type="submit" class="btn">Lưu giao dịch</button>' +
      "</form>"
    );
  }

  document.addEventListener("click", function (e) {
    var toggleBtn = e.target.closest("[data-type-toggle] button");
    if (toggleBtn) {
      var group = toggleBtn.closest("[data-type-toggle]");
      group.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      toggleBtn.classList.add("active");
      var hidden = group.parentElement.querySelector('input[name="type"]');
      if (hidden) hidden.value = toggleBtn.dataset.type;
    }
  });

  document.addEventListener("submit", function (e) {
    var form = e.target.closest('form[data-action="add-tx"]');
    if (!form) return;
    e.preventDefault();
    var fd = new FormData(form);
    var walletId = form.dataset.walletId || fd.get("walletId");
    var amount = parseFloat(fd.get("amount"));

    if (!walletId) { toast("Vui lòng chọn ví"); return; }
    if (!fd.get("reason") || !fd.get("reason").trim()) { toast("Vui lòng nhập lý do"); return; }
    if (!amount || amount <= 0) { toast("Số tiền phải lớn hơn 0"); return; }
    if (!fd.get("date")) { toast("Vui lòng chọn ngày"); return; }

    var tx = {
      id: uid("tx"),
      walletId: walletId,
      date: fd.get("date"),
      reason: fd.get("reason").trim(),
      type: fd.get("type") === "thu" ? "thu" : "chi",
      amount: amount,
      createdAt: Date.now()
    };
    var list = loadTx();
    list.push(tx);
    saveTx(list);
    toast("Đã lưu giao dịch");
    render();
  });

  /* ------------- Wallets Page ------------- */

  function renderWalletsPage() {
    var wallets = loadWallets();
    var txList = loadTx();

    var rows = wallets.length
      ? '<div class="wallet-list">' + wallets.map(function (w) {
          return (
            '<div class="wallet-card" data-action="open-wallet" data-id="' + w.id + '">' +
            '<div class="info"><div class="name">' + escapeHtml(w.name) + '</div><div class="balance">' + formatMoney(walletBalance(w.id, txList)) + "</div></div>" +
            '<button class="delete-btn" data-action="delete-wallet" data-id="' + w.id + '" aria-label="Xóa ví">&#128465;</button>' +
            "</div>"
          );
        }).join("") + "</div>"
      : '<p class="empty-state">Chưa có ví nào. Nhấn nút + để tạo ví mới.</p>';

    els.app.innerHTML =
      shellHeader("Danh sách Ví") +
      '<main>' + rows +
      '<p style="text-align:center;margin-top:18px;"><a href="#" data-action="change-password" style="color:#0288D1;font-size:13px;text-decoration:none;">Đổi mật khẩu quản lý ví</a></p>' +
      "</main>" +
      '<button class="fab" data-action="add-wallet" aria-label="Thêm ví">+</button>' +
      bottomNavHtml("wallets");
  }

  /* ------------- Wallet Detail Page ------------- */

  function renderWalletDetailPage(id) {
    var wallet = walletById(id);
    if (!wallet) {
      els.app.innerHTML = shellHeader("Không tìm thấy ví", { back: true }) +
        '<main><p class="empty-state">Ví không tồn tại hoặc đã bị xóa.</p></main>';
      return;
    }
    var txs = walletTxSortedDesc(id);
    var balance = txs.length ? txs[0].runningBalance : 0;

    var rows = txs.length
      ? txs.map(function (t) {
          var sign = t.type === "thu" ? "+" : "-";
          return (
            '<tr data-action="edit-tx" data-id="' + t.id + '">' +
            "<td>" + formatDateDisplay(t.date) + "</td>" +
            '<td class="reason">' + escapeHtml(t.reason) + "</td>" +
            '<td class="amount ' + t.type + '">' + sign + formatMoney(t.amount) + "</td>" +
            "<td>" + formatMoney(t.runningBalance) + "</td>" +
            "</tr>"
          );
        }).join("")
      : "";

    els.app.innerHTML =
      shellHeader(wallet.name, { back: true }) +
      '<main>' +
      '<div class="overall-balance"><div class="label">Tổng tiền còn lại</div><div class="value">' + formatMoney(balance) + "</div></div>" +
      '<div class="card"><h2>Thêm giao dịch</h2>' +
      renderTxFormHtml({ id: "wallet-tx-form", showWalletSelect: false, fixedWalletId: wallet.id }) +
      "</div>" +
      '<div class="card"><h2>Lịch sử giao dịch</h2>' +
      (rows
        ? '<table class="tx-table"><thead><tr><th>Ngày</th><th>Lý do</th><th>Thu/Chi</th><th>Tồn</th></tr></thead><tbody>' + rows + "</tbody></table>"
        : '<p class="empty-state">Chưa có giao dịch nào.</p>') +
      "</div>" +
      "</main>" +
      bottomNavHtml("wallets");
  }

  /* ---------------- Modals ---------------- */

  function openModal(innerHtml) {
    closeModal();
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-overlay";
    overlay.innerHTML = '<div class="modal-sheet">' + innerHtml + "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
  }

  function closeModal() {
    var existing = document.getElementById("modal-overlay");
    if (existing) existing.remove();
  }

  function confirmModal(message, onConfirm) {
    openModal(
      '<h3>Xác nhận</h3><p style="font-size:14px;color:#16323d;margin-bottom:18px;">' + escapeHtml(message) + "</p>" +
      '<div class="btn-row"><button class="btn secondary" data-action="modal-cancel">Hủy</button><button class="btn danger" id="modal-confirm-btn">Đồng ý</button></div>'
    );
    document.getElementById("modal-confirm-btn").addEventListener("click", function () {
      closeModal();
      onConfirm();
    });
  }

  function requirePassword(onSuccess) {
    var hash = getPwHash();
    if (!hash) {
      openModal(
        '<h3>Đặt mật khẩu quản lý ví</h3>' +
        '<p class="hint">Mật khẩu này dùng để xác nhận khi thêm hoặc xóa ví.</p>' +
        '<form id="pw-setup-form">' +
        '<div class="field"><label>Mật khẩu mới</label><input type="password" name="pw1" required minlength="4"></div>' +
        '<div class="field"><label>Xác nhận mật khẩu</label><input type="password" name="pw2" required minlength="4"></div>' +
        '<p id="pw-setup-error" style="color:#D32F2F;font-size:13px;display:none;">Mật khẩu xác nhận không khớp.</p>' +
        '<div class="btn-row"><button type="button" class="btn secondary" data-action="modal-cancel">Hủy</button><button type="submit" class="btn">Đặt mật khẩu</button></div>' +
        "</form>"
      );
      document.getElementById("pw-setup-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var pw1 = fd.get("pw1"), pw2 = fd.get("pw2");
        if (pw1 !== pw2) {
          document.getElementById("pw-setup-error").style.display = "block";
          return;
        }
        var h = await sha256Hex(pw1);
        setPwHash(h);
        closeModal();
        toast("Đã đặt mật khẩu");
        onSuccess();
      });
    } else {
      openModal(
        '<h3>Nhập mật khẩu</h3>' +
        '<form id="pw-check-form">' +
        '<div class="field"><label>Mật khẩu quản lý ví</label><input type="password" name="pw" required autofocus></div>' +
        '<p id="pw-check-error" style="color:#D32F2F;font-size:13px;display:none;">Mật khẩu không đúng.</p>' +
        '<div class="btn-row"><button type="button" class="btn secondary" data-action="modal-cancel">Hủy</button><button type="submit" class="btn">Xác nhận</button></div>' +
        "</form>"
      );
      document.getElementById("pw-check-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var h = await sha256Hex(fd.get("pw"));
        if (h !== hash) {
          document.getElementById("pw-check-error").style.display = "block";
          return;
        }
        closeModal();
        onSuccess();
      });
    }
  }

  function openAddWalletModal() {
    openModal(
      '<h3>Thêm ví mới</h3>' +
      '<form id="wallet-add-form">' +
      '<div class="field"><label>Tên ví</label><input type="text" name="name" required maxlength="40" placeholder="VD: Ví tiền mặt, Thẻ ngân hàng..."></div>' +
      '<div class="btn-row"><button type="button" class="btn secondary" data-action="modal-cancel">Hủy</button><button type="submit" class="btn">Tạo ví</button></div>' +
      "</form>"
    );
    document.getElementById("wallet-add-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var name = (fd.get("name") || "").trim();
      if (!name) return;
      closeModal();
      requirePassword(function () {
        var wallets = loadWallets();
        wallets.push({ id: uid("w"), name: name, createdAt: Date.now() });
        saveWallets(wallets);
        toast("Đã tạo ví \"" + name + "\"");
        render();
      });
    });
  }

  function openEditTxModal(tx) {
    openModal(
      '<h3>Sửa giao dịch</h3>' +
      '<form id="tx-edit-form">' +
      '<div class="field"><label>Ngày</label><input type="date" name="date" value="' + tx.date + '" required></div>' +
      '<div class="field"><label>Lý do</label><input type="text" name="reason" value="' + escapeHtml(tx.reason) + '" required maxlength="120"></div>' +
      '<div class="field"><label>Số tiền</label><input type="number" name="amount" min="0" step="1000" value="' + tx.amount + '" required></div>' +
      '<div class="field"><label>Loại</label><div class="type-toggle" data-type-toggle>' +
      '<button type="button" class="' + (tx.type === "chi" ? "active" : "") + '" data-type="chi">Chi</button>' +
      '<button type="button" class="' + (tx.type === "thu" ? "active" : "") + '" data-type="thu">Thu</button>' +
      "</div><input type=\"hidden\" name=\"type\" value=\"" + tx.type + "\"></div>" +
      '<div class="btn-row"><button type="button" class="btn danger" id="tx-delete-btn">Xóa</button><button type="submit" class="btn">Lưu</button></div>' +
      '<button type="button" class="btn secondary" style="margin-top:10px;" data-action="modal-cancel">Hủy</button>' +
      "</form>"
    );
    document.getElementById("tx-edit-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var amount = parseFloat(fd.get("amount"));
      if (!amount || amount <= 0) { toast("Số tiền phải lớn hơn 0"); return; }
      var list = loadTx();
      var idx = list.findIndex(function (t) { return t.id === tx.id; });
      if (idx > -1) {
        list[idx] = Object.assign({}, list[idx], {
          date: fd.get("date"),
          reason: fd.get("reason").trim(),
          amount: amount,
          type: fd.get("type") === "thu" ? "thu" : "chi"
        });
        saveTx(list);
      }
      closeModal();
      toast("Đã cập nhật giao dịch");
      render();
    });
    document.getElementById("tx-delete-btn").addEventListener("click", function () {
      confirmModal("Xóa giao dịch này?", function () {
        var list = loadTx().filter(function (t) { return t.id !== tx.id; });
        saveTx(list);
        toast("Đã xóa giao dịch");
        render();
      });
    });
  }

  function openChangePasswordFlow() {
    var hash = getPwHash();
    if (!hash) {
      requirePassword(function () { toast("Đã đặt mật khẩu"); });
      return;
    }
    openModal(
      '<h3>Đổi mật khẩu quản lý ví</h3>' +
      '<form id="pw-change-form">' +
      '<div class="field"><label>Mật khẩu hiện tại</label><input type="password" name="old" required></div>' +
      '<div class="field"><label>Mật khẩu mới</label><input type="password" name="pw1" required minlength="4"></div>' +
      '<div class="field"><label>Xác nhận mật khẩu mới</label><input type="password" name="pw2" required minlength="4"></div>' +
      '<p id="pw-change-error" style="color:#D32F2F;font-size:13px;display:none;"></p>' +
      '<div class="btn-row"><button type="button" class="btn secondary" data-action="modal-cancel">Hủy</button><button type="submit" class="btn">Đổi mật khẩu</button></div>' +
      "</form>"
    );
    document.getElementById("pw-change-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var errEl = document.getElementById("pw-change-error");
      var oldHash = await sha256Hex(fd.get("old"));
      if (oldHash !== hash) {
        errEl.textContent = "Mật khẩu hiện tại không đúng.";
        errEl.style.display = "block";
        return;
      }
      if (fd.get("pw1") !== fd.get("pw2")) {
        errEl.textContent = "Mật khẩu xác nhận không khớp.";
        errEl.style.display = "block";
        return;
      }
      var newHash = await sha256Hex(fd.get("pw1"));
      setPwHash(newHash);
      closeModal();
      toast("Đã đổi mật khẩu");
    });
  }

  /* ---------------- Global click delegation ---------------- */

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    if (action === "go-back") {
      e.preventDefault();
      navigate("#/wallets");
      return;
    }
    if (action === "open-wallet") {
      navigate("#/wallet/" + target.dataset.id);
      return;
    }
    if (action === "add-wallet") {
      openAddWalletModal();
      return;
    }
    if (action === "delete-wallet") {
      e.stopPropagation();
      var id = target.dataset.id;
      var w = walletById(id);
      if (!w) return;
      var bal = walletBalance(id);
      var msg = 'Xóa ví "' + w.name + '"? Toàn bộ ' +
        loadTx().filter(function (t) { return t.walletId === id; }).length +
        " giao dịch trong ví (số dư " + formatMoney(bal) + ") sẽ bị xóa vĩnh viễn.";
      requirePassword(function () {
        confirmModal(msg, function () {
          saveWallets(loadWallets().filter(function (x) { return x.id !== id; }));
          saveTx(loadTx().filter(function (t) { return t.walletId !== id; }));
          toast("Đã xóa ví");
          render();
        });
      });
      return;
    }
    if (action === "change-password") {
      e.preventDefault();
      openChangePasswordFlow();
      return;
    }
    if (action === "edit-tx") {
      var txId = target.dataset.id;
      var tx = loadTx().filter(function (t) { return t.id === txId; })[0];
      if (tx) openEditTxModal(tx);
      return;
    }
    if (action === "modal-cancel") {
      closeModal();
      return;
    }
  });

})();
