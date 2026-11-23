/**
 * HYDERABAD CHAI COMPANY — 0% MDR UPI WEBHOOK & NIGHTLY PURGE ENGINE (v4)
 * Developed by @syedzeeshaanali07
 */
const FIREBASE_URL    = "https://hyderabadchaicompany-c245a-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_SECRET = "PASTE_YOUR_FIREBASE_DATABASE_SECRET_HERE";
const GOOGLE_SHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
const BRIDGE_SECRET   = "HCC_SECURE_KEY_0786";

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : "";
    let data = {};
    try { data = JSON.parse(raw || "{}"); }
    catch (err) { data = { text: raw, secret: raw.indexOf(BRIDGE_SECRET) !== -1 ? BRIDGE_SECRET : "" }; }

    if (data.secret === BRIDGE_SECRET) {
      let paidAmount = parseFloat(data.amount || 0);
      if (!paidAmount && data.text) {
        const match = String(data.text).replace(/,/g, "").match(/(?:₹|Rs\.?|INR)\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
        if (match) paidAmount = parseFloat(match[1]);
      }
      if (paidAmount > 0) {
        const matchedOrderId = findPendingOrderByAmount(paidAmount);
        if (matchedOrderId) {
          markOrderPaid(matchedOrderId, "PPB-" + Date.now().toString().slice(-8));
          return jsonOut({ ok: true, matchedOrderId: matchedOrderId, amount: paidAmount });
        }
        return jsonOut({ ok: false, reason: "No pending order matched ₹" + paidAmount });
      }
    }
    return jsonOut({ ok: false, error: "Invalid secret or no rupee amount found" });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function doGet() {
  return jsonOut({ status: "HCC Webhook Active (asia-southeast1)", developer: "@syedzeeshaanali07" });
}

function findPendingOrderByAmount(paidAmount) {
  const res = UrlFetchApp.fetch(`${FIREBASE_URL}/orders.json?auth=${FIREBASE_SECRET}`, { muteHttpExceptions: true });
  const orders = JSON.parse(res.getContentText() || "{}");
  if (!orders) return null;
  const now = Date.now();
  let bestId = null, oldest = Infinity;
  Object.keys(orders).forEach(id => {
    const o = orders[id];
    if (o && o.status === "PENDING_PAYMENT" && Math.abs(parseFloat(o.total) - paidAmount) < 0.01 && (now - (o.createdAt || 0)) <= 180000) {
      if ((o.createdAt || 0) < oldest) { oldest = o.createdAt || 0; bestId = id; }
    }
  });
  return bestId;
}

function markOrderPaid(orderId, utr) {
  const tokenUrl = `${FIREBASE_URL}/config/tokenCounter.json?auth=${FIREBASE_SECRET}`;
  const cur = parseInt(UrlFetchApp.fetch(tokenUrl).getContentText() || "101", 10);
  const next = isNaN(cur) ? 101 : cur;
  UrlFetchApp.fetch(tokenUrl, { method: "put", contentType: "application/json", payload: JSON.stringify(next + 1) });
  UrlFetchApp.fetch(`${FIREBASE_URL}/orders/${orderId}.json?auth=${FIREBASE_SECRET}`, {
    method: "patch", contentType: "application/json",
    payload: JSON.stringify({ status: "PAID", kdsStatus: "PREPARING", token: next, utr: utr, paidAt: new Date().toISOString() })
  });
}

function nightlyBackupAndPurgeFirebase() {
  const res = UrlFetchApp.fetch(`${FIREBASE_URL}/orders.json?auth=${FIREBASE_SECRET}`);
  const orders = JSON.parse(res.getContentText() || "{}");
  const ss = SpreadsheetApp.openById(GOOGLE_SHEET_ID);
  let sheet = ss.getSheetByName("Daily_Sales") || ss.insertSheet("Daily_Sales");
  if (sheet.getLastRow() === 0) sheet.appendRow(["Date", "Time", "Token", "Order ID", "Type", "Items", "Total", "Fee", "UTR"]);
  if (orders) {
    Object.keys(orders).forEach(id => {
      const o = orders[id];
      if (o && o.status === "PAID") {
        const itemsText = Array.isArray(o.items) ? o.items.map(i => `${i.qty}x ${i.name}`).join(", ") : "";
        sheet.appendRow([o.date || "", o.time || "", o.token || "", id, o.type || "", itemsText, o.total || 0, 0, o.utr || ""]);
      }
    });
  }
  UrlFetchApp.fetch(`${FIREBASE_URL}/orders.json?auth=${FIREBASE_SECRET}`, { method: "delete" });
  UrlFetchApp.fetch(`${FIREBASE_URL}/config/tokenCounter.json?auth=${FIREBASE_SECRET}`, { method: "put", contentType: "application/json", payload: JSON.stringify(101) });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
